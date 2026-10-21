//! A package's README, for the panel: the copy installed in `node_modules` when there is one (the version actually in
//! use, and no network), otherwise the latest from npm, fetched with the system `curl`.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readme {
    name: String,
    version: Option<String>,
    /// "installed" or "npm".
    source: &'static str,
    text: String,
}

/// npm's rules for a package name, scoped or not. Anything else never reaches a URL.
fn valid_name(name: &str) -> bool {
    let part = |p: &str| {
        !p.is_empty()
            && !p.starts_with('.')
            && !p.starts_with('_')
            && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-._~".contains(&b))
    };
    match name.strip_prefix('@') {
        Some(scoped) => matches!(scoped.split_once('/'), Some((scope, pkg)) if part(scope) && part(pkg)),
        None => part(name),
    }
}

fn installed(dir: &Path) -> Option<(Option<String>, String)> {
    let readme = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.is_file() && p.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with("readme")))?;
    let text = std::fs::read_to_string(readme).ok()?;
    let version = std::fs::read_to_string(dir.join("package.json"))
        .ok()
        .and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok())
        .and_then(|v| v["version"].as_str().map(String::from));
    Some((version, text))
}

fn curl(url: &str) -> Option<String> {
    let out = Command::new("curl").args(["-fsSL", "--max-time", "15", url]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

#[tauri::command]
pub async fn package_readme(repo: String, name: String) -> Result<Readme, String> {
    if !valid_name(&name) {
        return Err(format!("{name} isn't a package name"));
    }
    if let Some((version, text)) = installed(&Path::new(&repo).join("node_modules").join(&name)) {
        return Ok(Readme {
            name,
            version,
            source: "installed",
            text,
        });
    }
    let latest = curl(&format!("https://registry.npmjs.org/{name}/latest"))
        .and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok())
        .and_then(|v| v["version"].as_str().map(String::from))
        .ok_or_else(|| format!("Couldn't find {name} on npm"))?;
    // The published files, through jsDelivr's npm mirror; READMEs come in a few spellings.
    let text = ["README.md", "readme.md", "Readme.md", "README.markdown", "README"]
        .iter()
        .find_map(|f| curl(&format!("https://cdn.jsdelivr.net/npm/{name}@{latest}/{f}")))
        .ok_or_else(|| format!("{name}@{latest} has no README"))?;
    Ok(Readme {
        name,
        version: Some(latest),
        source: "npm",
        text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_package_names() {
        for ok in ["vue", "@vue/runtime-core", "lodash.merge", "a-b_c~d"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", "Vue", "../etc", "@scope", "@/x", "a b", "x?y=1", ".hidden", "a/b"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn reads_an_installed_readme() {
        let dir = std::env::temp_dir().join(format!("acantha-readme-{}", std::process::id()));
        let pkg = dir.join("node_modules/@x/y");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(pkg.join("Readme.md"), "# y").unwrap();
        std::fs::write(pkg.join("package.json"), r#"{"version":"1.2.3"}"#).unwrap();
        let r = tauri::async_runtime::block_on(package_readme(dir.to_string_lossy().into(), "@x/y".into())).unwrap();
        assert_eq!((r.source, r.version.as_deref(), r.text.as_str()), ("installed", Some("1.2.3"), "# y"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
