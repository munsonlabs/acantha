//! GitHub, through the GitHub CLI (`gh`): pull requests, their checks and Actions runs, for the panel's GitHub tab. `gh`
//! keeps its own login in the Keychain, so the app never handles a token. Only reading commands are let through, plus
//! `pr create --web`, which just opens the browser.

use std::process::Command;

/// Commands the panel may run, by their first two words.
const ALLOWED: &[[&str; 2]] = &[["pr", "view"], ["pr", "list"], ["run", "list"], ["pr", "create"]];

/// `gh` is often in a place apps launched from Finder don't look.
fn gh() -> Command {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = std::env::var("PATH").unwrap_or_default();
    let mut cmd = Command::new("gh");
    cmd.env("PATH", format!("{path}:{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin"))
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1");
    cmd
}

fn allowed(args: &[String]) -> bool {
    let first = args.iter().take(2).map(String::as_str).collect::<Vec<_>>();
    let known = ALLOWED.iter().any(|a| first == a);
    // Creating a pull request only ever opens the browser's form.
    let create_ok = first != ["pr", "create"] || (args.len() == 3 && args[2] == "--web");
    known && create_ok
}

/// Runs `gh` in the repository and returns what it prints (JSON, for the reading commands).
#[tauri::command]
pub async fn run_gh(repo: String, args: Vec<String>) -> Result<String, String> {
    if !allowed(&args) {
        return Err("Unsupported gh command".into());
    }
    let out = gh().current_dir(&repo).args(&args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "GitHub CLI isn't installed. Install it (brew install gh), then run gh auth login.".to_string()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split(' ').map(String::from).collect()
    }

    #[test]
    fn lets_through_only_reading_commands() {
        assert!(allowed(&args("pr view --json number")));
        assert!(allowed(&args("run list --limit 5")));
        assert!(allowed(&args("pr create --web")));
        assert!(!allowed(&args("pr create --title x")));
        assert!(!allowed(&args("pr merge 3")));
        assert!(!allowed(&args("repo delete")));
        assert!(!allowed(&args("api -X DELETE /repos/x")));
    }
}
