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
    /// Vite+: the package for `package#task`, None for the workspace root. npm: the package.json's folder, "" for
    /// the repository root.
    package: Option<String>,
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

fn npm_scripts(repo: &str) -> Result<Vec<Script>, String> {
    let out = git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
    let mut manifests: Vec<&str> = out
        .split('\0')
        .filter(|p| (*p == "package.json" || p.ends_with("/package.json")) && !p.contains("node_modules/"))
        .collect();
    manifests.sort_by_key(|p| (p.matches('/').count(), p.to_string()));
    manifests.dedup();
    let mut scripts = Vec::new();
    for manifest in manifests {
        let Ok(text) = std::fs::read_to_string(Path::new(repo).join(manifest)) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let dir = manifest.strip_suffix("package.json").unwrap_or("").trim_end_matches('/');
        for (name, command) in json["scripts"].as_object().into_iter().flatten() {
            if let Some(command) = command.as_str() {
                scripts.push(Script {
                    package: Some(dir.to_string()),
                    name: name.clone(),
                    command: command.to_string(),
                });
            }
        }
    }
    Ok(scripts)
}

#[tauri::command]
pub async fn list_scripts(repo: String) -> Result<Scripts, String> {
    if Path::new(&repo).join("node_modules/.bin/vp").exists() {
        let scripts = parse_vp(&vp_list(&repo)?);
        if !scripts.is_empty() {
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
        let names: Vec<_> = s.iter().map(|s| format!("{}:{}", s.package.as_deref().unwrap(), s.name)).collect();
        assert_eq!(names, [":test", "web:build", "web:dev"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
