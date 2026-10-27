//! Asking Claude Code something once, headless: the editor's ⌘I (change the selected code, or ask about it), and the
//! repository tours (src/tour.rs). Claude works in plan mode, so it can read the repository for context but changes
//! nothing itself: an edit comes back as text, for the editor to apply and you to keep or undo.

use serde_json::Value;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// An edit or a question is about a few lines: if it isn't back by then, it isn't coming.
const EDIT_LIMIT: Duration = Duration::from_secs(3 * 60);

/// Runs Claude Code once on `prompt` in `repo`, returning its answer. `doing` finishes "Claude Code couldn't …", for
/// the errors.
pub(crate) fn run_once(repo: &str, prompt: &str, model: Option<&str>, limit: Duration, doing: &str) -> Result<String, String> {
    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "json", "--permission-mode", "plan"]);
    if let Some(m) = model.filter(|m| !m.is_empty() && m.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._[]".contains(&b))) {
        cmd.args(["--model", m]);
    }
    let mut child = cmd
        .current_dir(repo)
        .env("PATH", crate::claude::cli_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Claude Code isn't installed: see claude.com/claude-code".to_string()
            } else {
                e.to_string()
            }
        })?;
    let mut stdin = child.stdin.take().ok_or("No input to claude")?;
    stdin.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    drop(stdin);
    let mut stdout = child.stdout.take().ok_or("No output from claude")?;
    let (done, out) = mpsc::channel();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        let _ = done.send(s);
    });
    let Ok(text) = out.recv_timeout(limit) else {
        crate::claude::end(child);
        return Err(format!("Claude Code took too long to {doing}"));
    };
    let _ = child.wait();
    let reply: Value = serde_json::from_str(&text).map_err(|_| "Claude Code didn't answer as expected".to_string())?;
    let result = reply["result"].as_str().unwrap_or("").to_string();
    if reply["is_error"] == true {
        return Err(if result.is_empty() {
            format!("Claude Code couldn't {doing}")
        } else {
            result
        });
    }
    Ok(result)
}

/// What Claude's asked for ⌘I: the file with the selection marked, and the request, answered in one of two shapes the
/// editor can tell apart (see src/lib/editAsk.ts).
fn edit_prompt(path: &str, before: &str, selected: &str, after: &str, ask: &str) -> String {
    let what = if selected.is_empty() {
        "The cursor is at ⟦SELECTION⟧⟦/SELECTION⟧ below: anything new goes there."
    } else {
        "The code in question is between ⟦SELECTION⟧ and ⟦/SELECTION⟧ below."
    };
    format!(
        "You're helping edit {path} in this repository, as it is in the editor (maybe unsaved, so it can differ from the \
         file on disk). {what} Read other files if you need them to understand it, but don't change any.\n\n\
         The request: {ask}\n\n\
         If it asks for a change, reply with a line saying only EDIT, then one fenced code block holding everything that \
         replaces the selection, with its indentation as it should be in the file, and nothing after it. Otherwise (a \
         question), reply with a line saying only ANSWER, then a short answer.\n\n\
         {path}:\n{before}⟦SELECTION⟧{selected}⟦/SELECTION⟧{after}"
    )
}

/// ⌘I in the editor: asks Claude Code to change the selected code (or what's at the cursor), or about it. Returns its
/// answer as text, EDIT or ANSWER first.
#[tauri::command]
pub async fn edit_ask(
    repo: String,
    path: String,
    before: String,
    selected: String,
    after: String,
    ask: String,
    model: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = edit_prompt(&path, &before, &selected, &after, &ask);
        run_once(&repo, &prompt, model.as_deref(), EDIT_LIMIT, "answer")
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_the_selection_and_asks_for_edit_or_answer() {
        let p = edit_prompt("src/a.ts", "const a = 1\n", "function f() {}", "\n", "add jsdoc");
        assert!(p.contains("The request: add jsdoc"));
        assert!(p.contains("EDIT") && p.contains("ANSWER"));
        assert!(p.ends_with("src/a.ts:\nconst a = 1\n⟦SELECTION⟧function f() {}⟦/SELECTION⟧\n"));
        assert!(edit_prompt("a", "", "", "", "x").contains("The cursor is at"));
    }
}
