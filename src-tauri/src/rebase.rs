use crate::git::{command, git, parse_commits, stderr_or_code, Commit, COMMIT_FORMAT};
use serde::Deserialize;

const TODO_ACTIONS: &[&str] = &["pick", "reword", "edit", "squash", "fixup", "drop"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    action: String,
    hash: String,
    /// New message for "reword".
    message: Option<String>,
}

/// The commits an interactive rebase onto `base` would replay, oldest first. Without a base, the whole history.
#[tauri::command]
pub async fn rebase_commits(repo: String, base: Option<String>) -> Result<Vec<Commit>, String> {
    let range = base.map(|b| format!("{b}..HEAD")).unwrap_or_else(|| "HEAD".into());
    Ok(parse_commits(&git(
        &repo,
        ["log", "--reverse", "--topo-order", COMMIT_FORMAT, range.as_str(), "--"],
    )?))
}

/// Builds the todo list git reads. Rewording happens through `exec` lines, since there is no editor to type into.
fn build_todo(todo: &[TodoItem], dir: &std::path::Path) -> Result<String, String> {
    let mut lines = Vec::new();
    for (i, item) in todo.iter().enumerate() {
        if !TODO_ACTIONS.contains(&item.action.as_str()) {
            return Err(format!("Unknown rebase action: {}", item.action));
        }
        if item.hash.is_empty() || !item.hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("Invalid commit: {}", item.hash));
        }
        match (item.action.as_str(), item.message.as_deref().map(str::trim)) {
            ("reword", Some(message)) if !message.is_empty() => {
                let file = dir.join(format!("message-{i}"));
                std::fs::write(&file, message).map_err(|e| e.to_string())?;
                lines.push(format!("pick {}", item.hash));
                lines.push(format!(
                    "exec git commit --amend --only --allow-empty --quiet --file '{}'",
                    file.display()
                ));
            }
            ("reword", _) => lines.push(format!("pick {}", item.hash)),
            (action, _) => lines.push(format!("{action} {}", item.hash)),
        }
    }
    Ok(lines.join("\n") + "\n")
}

#[tauri::command]
pub async fn interactive_rebase(repo: String, base: Option<String>, todo: Vec<TodoItem>) -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("git-graph-rebase-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let todo_path = dir.join("todo");
    std::fs::write(&todo_path, build_todo(&todo, &dir)?).map_err(|e| e.to_string())?;

    // Git hands the sequence editor its own todo file; replacing it with ours is the whole edit.
    let out = command(&repo)
        .args(["rebase", "--interactive", "--autostash", "--no-autosquash"])
        .arg(base.as_deref().unwrap_or("--root"))
        .env("GIT_SEQUENCE_EDITOR", format!("cp '{}'", todo_path.display()))
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !out.status.success() {
        // Leave the message files: a rebase that stopped on a conflict still needs them to continue.
        return Err(stderr_or_code(&out));
    }
    let _ = std::fs::remove_dir_all(&dir);
    let text = [out.stdout, out.stderr]
        .iter()
        .map(|b| String::from_utf8_lossy(b).trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    Ok(text.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::{blame_file, file_history, list_files, read_file, FileContent};
    use crate::git::{get_log, get_status};
    use tauri::async_runtime::block_on;

    fn sh(repo: &str, args: &[&str]) -> String {
        git(repo, args).unwrap_or_else(|e| panic!("git {args:?}: {e}"))
    }

    fn repo(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("git-graph-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        sh(&path, &["init", "-q", "-b", "main"]);
        sh(&path, &["config", "user.name", "Test"]);
        sh(&path, &["config", "user.email", "test@example.com"]);
        path
    }

    fn commit(repo: &str, file: &str, text: &str, message: &str) {
        std::fs::write(std::path::Path::new(repo).join(file), text).unwrap();
        sh(repo, &["add", "-A"]);
        sh(repo, &["commit", "-qm", message]);
    }

    fn subjects(repo: &str) -> Vec<String> {
        sh(repo, &["log", "--format=%s"]).lines().map(String::from).collect()
    }

    #[test]
    fn rewords_squashes_and_drops() {
        let repo = repo("rebase");
        commit(&repo, "a.txt", "1\n", "base");
        commit(&repo, "a.txt", "1\n2\n", "two");
        commit(&repo, "b.txt", "b\n", "three");
        commit(&repo, "c.txt", "c\n", "four");
        let base = sh(&repo, &["rev-parse", "HEAD~3"]).trim().to_string();

        let commits = block_on(rebase_commits(repo.clone(), Some(base.clone()))).unwrap();
        assert_eq!(commits.len(), 3);
        let item = |action: &str, i: usize, message: Option<&str>| TodoItem {
            action: action.into(),
            hash: commits[i].hash.clone(),
            message: message.map(String::from),
        };
        let todo = vec![item("reword", 0, Some("two, reworded")), item("squash", 2, None), item("drop", 1, None)];
        block_on(interactive_rebase(repo.clone(), Some(base), todo)).unwrap();

        assert_eq!(subjects(&repo), ["two, reworded", "base"]);
        assert!(std::path::Path::new(&repo).join("c.txt").exists());
        assert!(!std::path::Path::new(&repo).join("b.txt").exists());
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn reports_stashes_conflicts_blame_and_history() {
        let repo = repo("state");
        commit(&repo, "a.txt", "one\n", "first");
        commit(&repo, "a.txt", "one\ntwo\n", "second");

        let history = block_on(file_history(repo.clone(), None, "a.txt".into())).unwrap();
        assert_eq!(history.len(), 2);
        let blame = block_on(blame_file(repo.clone(), None, "a.txt".into())).unwrap();
        let blame = serde_json::to_value(blame).unwrap();
        assert_eq!(blame["lines"].as_array().unwrap().len(), 2);
        assert!(
            matches!(block_on(read_file(repo.clone(), Some("HEAD~1".into()), "a.txt".into())).unwrap(), FileContent::Text { ref text, .. } if text == "one\n")
        );
        assert_eq!(block_on(list_files(repo.clone(), Some("HEAD".into()))).unwrap(), ["a.txt"]);

        std::fs::write(std::path::Path::new(&repo).join("a.txt"), "stashed\n").unwrap();
        sh(&repo, &["stash", "push", "-q", "-m", "wip"]);
        let log = block_on(get_log(repo.clone(), 10, vec![], true)).unwrap();
        let log = serde_json::to_value(log).unwrap();
        assert_eq!(log["stashes"][0]["selector"], "stash@{0}");
        assert_eq!(log["stashes"][0]["base"], log["head"]);

        sh(&repo, &["checkout", "-q", "-b", "other", "HEAD~1"]);
        commit(&repo, "a.txt", "one\nconflict\n", "other");
        assert!(git(&repo, ["merge", "main"]).is_err());
        let status = serde_json::to_value(block_on(get_status(repo.clone())).unwrap()).unwrap();
        assert_eq!(status["operation"], "merge");
        assert_eq!(status["files"][0]["kind"], "conflict");
        let _ = std::fs::remove_dir_all(&repo);
    }
}
