//! The sessions Claude Code and OpenCode keep on disk, every conversation's, from Acantha's agents and from their own
//! use. Claude Code trims its own (`cleanupPeriodDays` in ~/.claude/settings.json, 30 days unless set); OpenCode keeps
//! everything, so Acantha can delete its old ones. Here: how much each is keeping, Claude Code's period read and set,
//! and OpenCode's sessions deleted, one or all those older than so many days.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// What's in a folder, in bytes (and how many files end in `ext`), however deep.
fn size_of(dir: &Path, ext: &str) -> (u64, usize) {
    let mut total = (0, 0);
    let Ok(entries) = std::fs::read_dir(dir) else { return total };
    for e in entries.flatten() {
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            let (b, n) = size_of(&e.path(), ext);
            total = (total.0 + b, total.1 + n);
        } else {
            total.0 += meta.len();
            if e.path().extension().is_some_and(|x| x == ext) {
                total.1 += 1;
            }
        }
    }
    total
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Kept {
    bytes: u64,
    sessions: usize,
    /// Claude Code's: how many days it keeps a transcript unused, when its settings say.
    cleanup_days: Option<u64>,
    /// Installed, with somewhere it keeps sessions.
    present: bool,
}

#[derive(Serialize, Default)]
pub struct Storage {
    claude: Kept,
    opencode: Kept,
}

fn claude_settings() -> PathBuf {
    home().join(".claude/settings.json")
}

/// OpenCode's command, wherever it's installed.
fn opencode() -> Command {
    let mut cmd = Command::new("opencode");
    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env(
        "PATH",
        format!("{path}:{}/.opencode/bin:/opt/homebrew/bin:/usr/local/bin", home().display()),
    )
    .current_dir(home());
    cmd
}

/// OpenCode's sessions: `[{id, title, updated, …}]`.
fn opencode_sessions() -> Vec<Value> {
    let Ok(out) = opencode().args(["session", "list", "--format", "json"]).output() else {
        return Vec::new();
    };
    serde_json::from_slice::<Vec<Value>>(&out.stdout).unwrap_or_default()
}

/// How much each is keeping on disk.
#[tauri::command]
pub async fn agent_storage() -> Storage {
    tauri::async_runtime::spawn_blocking(|| {
        let projects = home().join(".claude/projects");
        let (bytes, sessions) = size_of(&projects, "jsonl");
        let cleanup_days = std::fs::read_to_string(claude_settings())
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v["cleanupPeriodDays"].as_u64());
        let claude = Kept {
            bytes,
            sessions,
            cleanup_days,
            present: projects.is_dir(),
        };
        // Its database and session files, not the program it keeps there too.
        let data = home().join(".local/share/opencode");
        let bytes = ["opencode.db", "opencode.db-wal", "opencode.db-shm"]
            .iter()
            .filter_map(|f| std::fs::metadata(data.join(f)).ok())
            .map(|m| m.len())
            .sum::<u64>()
            + size_of(&data.join("storage"), "").0
            + size_of(&data.join("snapshot"), "").0;
        let opencode = if data.is_dir() {
            Kept {
                bytes,
                sessions: opencode_sessions().len(),
                cleanup_days: None,
                present: true,
            }
        } else {
            Kept::default()
        };
        Storage { claude, opencode }
    })
    .await
    .unwrap_or_default()
}

/// Sets `cleanupPeriodDays` in Claude Code's settings, changing only that: the rest of the file stays as it is.
fn with_cleanup_days(text: &str, days: u64) -> Result<String, String> {
    let parsed: Value = if text.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(text).map_err(|_| "Claude Code's settings.json isn't valid JSON, so it's left alone")?
    };
    let next = if parsed.get("cleanupPeriodDays").is_some() {
        // Its value, wherever it is: the first `"cleanupPeriodDays": <number>`.
        let key = text.find("\"cleanupPeriodDays\"").ok_or("cleanupPeriodDays is nested oddly")?;
        let colon = key + text[key..].find(':').ok_or("cleanupPeriodDays has no value")?;
        let start = colon + 1 + text[colon + 1..].len() - text[colon + 1..].trim_start().len();
        let end = start + text[start..].find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len() - start);
        format!("{}{days}{}", &text[..start], &text[end..])
    } else if text.trim().is_empty() || parsed.as_object().is_some_and(|o| o.is_empty()) {
        format!("{{\n  \"cleanupPeriodDays\": {days}\n}}\n")
    } else {
        let brace = text.find('{').ok_or("settings.json isn't an object")?;
        format!("{}\n  \"cleanupPeriodDays\": {days},{}", &text[..=brace], &text[brace + 1..])
    };
    // Only written if it's still valid, and says what it should.
    let check: Value = serde_json::from_str(&next).map_err(|_| "Couldn't change settings.json safely")?;
    if check["cleanupPeriodDays"].as_u64() != Some(days) {
        return Err("Couldn't change settings.json safely".into());
    }
    Ok(next)
}

/// How many days Claude Code keeps a transcript it hasn't used, in its own settings.
#[tauri::command]
pub fn claude_set_cleanup_days(days: u64) -> Result<(), String> {
    if !(1..=3650).contains(&days) {
        return Err("Between a day and ten years".into());
    }
    let path = claude_settings();
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let next = with_cleanup_days(&text, days)?;
    std::fs::write(&path, next).map_err(|e| e.to_string())
}

fn session_ok(id: &str) -> bool {
    id.starts_with("ses_") && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn delete_opencode(id: &str) -> bool {
    session_ok(id) && opencode().args(["session", "delete", id]).output().is_ok_and(|o| o.status.success())
}

/// Deletes an OpenCode session for good.
#[tauri::command]
pub async fn opencode_delete_session(session: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_opencode(&session)
            .then_some(())
            .ok_or_else(|| "OpenCode couldn't delete it".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The sessions last used more than `days` ago, from OpenCode's list.
fn older_than(sessions: &[Value], days: u64, now_ms: u64) -> Vec<String> {
    let cutoff = now_ms.saturating_sub(days * 86_400_000);
    sessions
        .iter()
        .filter(|s| s["updated"].as_u64().is_some_and(|u| u < cutoff))
        .filter_map(|s| s["id"].as_str().map(String::from))
        .collect()
}

/// Deletes OpenCode's sessions last used more than `days` ago. Returns how many went.
#[tauri::command]
pub async fn opencode_prune(days: u64) -> usize {
    tauri::async_runtime::spawn_blocking(move || {
        if days == 0 {
            return 0;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        older_than(&opencode_sessions(), days, now)
            .iter()
            .filter(|id| delete_opencode(id))
            .count()
    })
    .await
    .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn changes_only_the_cleanup_period() {
        let text = "{\n  \"model\": \"opus\",\n  \"cleanupPeriodDays\": 30,\n  \"permissions\": { \"defaultMode\": \"auto\" }\n}\n";
        assert_eq!(with_cleanup_days(text, 7).unwrap(), text.replace("30", "7"));
        // Not there yet: added at the top, the rest untouched.
        let added = with_cleanup_days("{\n  \"model\": \"opus\"\n}\n", 14).unwrap();
        assert_eq!(added, "{\n  \"cleanupPeriodDays\": 14,\n  \"model\": \"opus\"\n}\n");
        assert!(with_cleanup_days("", 30).unwrap().contains("\"cleanupPeriodDays\": 30"));
        assert!(with_cleanup_days("{ not json", 30).is_err());
    }

    #[test]
    fn finds_sessions_unused_for_long_enough() {
        let day = 86_400_000;
        let sessions = vec![
            json!({ "id": "ses_old", "updated": 0 }),
            json!({ "id": "ses_new", "updated": 40 * day }),
            json!({ "id": "ses_none" }),
        ];
        assert_eq!(older_than(&sessions, 30, 50 * day), ["ses_old"]);
        assert!(session_ok("ses_fcd248d76ffeehEg4EeBTuaUGZ") && !session_ok("ses_x; rm -rf ~"));
    }
}
