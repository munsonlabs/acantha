//! The scripts a repository can run: Vite+ tasks when it uses Vite+ (as `vp run` lists them, nested packages
//! included), otherwise the `scripts` of every package.json in it.

use crate::git::git;
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    /// Vite+ only: the package for `package#task`, None for the workspace root.
    package: Option<String>,
    /// The folder it belongs to, relative to the repository ("" for the root).
    dir: String,
    name: String,
    command: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scripts {
    /// "vp" or "npm"
    tool: &'static str,
    scripts: Vec<Script>,
}

/// `vp run` without a terminal prints `  task: command`, and `  package#task: command` for nested packages.
fn parse_vp(out: &str) -> Vec<Script> {
    out.lines()
        .filter_map(|line| {
            let line = line.strip_prefix("  ")?;
            let (spec, command) = line.split_once(": ")?;
            if spec.contains(char::is_whitespace) {
                return None;
            }
            let (package, name) = match spec.split_once('#') {
                Some((p, n)) => (Some(p.to_string()), n),
                None => (None, spec),
            };
            Some(Script {
                package,
                dir: String::new(),
                name: name.to_string(),
                command: command.to_string(),
            })
        })
        .collect()
}

/// Runs `vp run` through your login shell (an app started from the Dock doesn't have node on its PATH), giving up
/// after a few seconds rather than hanging.
fn vp_list(repo: &str) -> Result<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-lc", "node_modules/.bin/vp run"])
        .current_dir(repo)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Couldn't run vp: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("Couldn't read vp's output")?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err("vp took too long to list its tasks".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    reader.join().map_err(|_| "Couldn't read vp's output".to_string())
}

/// Every package.json in the repository (tracked or new, not ignored, not in node_modules): its folder and contents.
fn manifests(repo: &str) -> Result<Vec<(String, serde_json::Value)>, String> {
    let out = git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
    let mut paths: Vec<&str> = out
        .split('\0')
        .filter(|p| (*p == "package.json" || p.ends_with("/package.json")) && !p.contains("node_modules/"))
        .collect();
    paths.sort_by_key(|p| (p.matches('/').count(), p.to_string()));
    paths.dedup();
    Ok(paths
        .into_iter()
        .filter_map(|path| {
            let json = serde_json::from_str(&std::fs::read_to_string(Path::new(repo).join(path)).ok()?).ok()?;
            let dir = path.strip_suffix("package.json").unwrap_or("").trim_end_matches('/').to_string();
            Some((dir, json))
        })
        .collect())
}

fn npm_scripts(repo: &str) -> Result<Vec<Script>, String> {
    let mut scripts = Vec::new();
    for (dir, json) in manifests(repo)? {
        for (name, command) in json["scripts"].as_object().into_iter().flatten() {
            if let Some(command) = command.as_str() {
                scripts.push(Script {
                    package: None,
                    dir: dir.clone(),
                    name: name.clone(),
                    command: command.to_string(),
                });
            }
        }
    }
    Ok(scripts)
}

/// `vp run` names packages, not folders: find each one's folder from the `name` in its package.json.
fn place_vp_packages(repo: &str, scripts: &mut [Script]) {
    let Ok(found) = manifests(repo) else { return };
    let dirs: std::collections::HashMap<String, String> = found
        .into_iter()
        .filter_map(|(dir, json)| Some((json["name"].as_str()?.to_string(), dir)))
        .collect();
    for s in scripts.iter_mut() {
        if let Some(pkg) = &s.package {
            s.dir = dirs.get(pkg).cloned().unwrap_or_else(|| pkg.clone());
        }
    }
}

#[tauri::command]
pub async fn list_scripts(repo: String) -> Result<Scripts, String> {
    if Path::new(&repo).join("node_modules/.bin/vp").exists() {
        let mut scripts = parse_vp(&vp_list(&repo)?);
        if !scripts.is_empty() {
            place_vp_packages(&repo, &mut scripts);
            return Ok(Scripts { tool: "vp", scripts });
        }
    }
    Ok(Scripts {
        tool: "npm",
        scripts: npm_scripts(&repo)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vp_task_list() {
        let out = "  build: vp run -r build\n  sim:shots: vp run --filter app sim:shots\n  app#upload: sh tools/pio.sh run -e ${ENV:-x} -t upload\nSome footer: text\n";
        let s = parse_vp(out);
        assert_eq!(s.len(), 3);
        assert_eq!(
            s[1],
            Script {
                package: None,
                dir: String::new(),
                name: "sim:shots".into(),
                command: "vp run --filter app sim:shots".into()
            }
        );
        assert_eq!(s[2].package.as_deref(), Some("app"));
        assert_eq!(s[2].name, "upload");
    }

    #[test]
    fn finds_nested_package_scripts() {
        let dir = std::env::temp_dir().join(format!("acantha-scripts-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("web/node_modules/x")).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, ["init", "-q"]).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"test":"vitest"}}"#).unwrap();
        std::fs::write(dir.join("web/package.json"), r#"{"scripts":{"dev":"vite","build":"vite build"}}"#).unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules\n").unwrap();
        std::fs::write(dir.join("web/node_modules/x/package.json"), r#"{"scripts":{"no":"x"}}"#).unwrap();
        let s = npm_scripts(&repo).unwrap();
        let names: Vec<_> = s.iter().map(|s| format!("{}:{}", s.dir, s.name)).collect();
        assert_eq!(names, [":test", "web:build", "web:dev"]);
        // Vite+ packages land in the folder whose package.json has their name.
        std::fs::write(dir.join("web/package.json"), r#"{"name":"site","scripts":{}}"#).unwrap();
        let mut vp = parse_vp("  site#dev: vite\n  check: vp check\n");
        place_vp_packages(&repo, &mut vp);
        assert_eq!((vp[0].dir.as_str(), vp[1].dir.as_str()), ("web", ""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
