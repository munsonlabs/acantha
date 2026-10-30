//! How much of their plans the agents have used: Claude Code's limits (its `/usage`, run headless, which costs nothing
//! as no model answers it) and OpenCode's totals (`opencode stats`: its providers don't report limits to it).

use serde::Serialize;
use serde_json::Value;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// `/usage` answers at once; past this, something's wrong.
const LIMIT: Duration = Duration::from_secs(30);

/// Runs a command in the home folder, giving its output, or an error if it fails or takes too long.
fn output(mut cmd: Command, missing: &str) -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let child = cmd
        .current_dir(&home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                missing.to_string()
            } else {
                e.to_string()
            }
        })?;
    let id = child.id();
    let (done, out) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(child.wait_with_output());
    });
    match out.recv_timeout(LIMIT) {
        Ok(Ok(o)) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).into_owned()),
        Ok(Ok(_)) => Err("It stopped with an error".into()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => {
            let _ = Command::new("kill").arg(id.to_string()).status();
            Err("It took too long to answer".into())
        }
    }
}

/// The usage report in `/usage`'s stream-json output: its limits, and extra usage.
fn report_in(out: &str) -> Option<Value> {
    out.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find_map(|e| e.get("usage_report").map(|r| r["rate_limits"].clone()))
        .filter(|r| !r.is_null())
}

/// Claude Code's plan limits: each one's percent used and when it resets.
#[tauri::command]
pub async fn claude_usage() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = Command::new("claude");
        cmd.args(["-p", "/usage", "--output-format", "stream-json", "--verbose", "--no-session-persistence"])
            .env("PATH", crate::claude::cli_path());
        let out = output(cmd, "Claude Code isn't installed: see claude.com/claude-code")?;
        report_in(&out).ok_or_else(|| "Claude Code didn't say: it may not be signed in to a plan".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeStats {
    days: u32,
    sessions: String,
    messages: String,
    cost: String,
    input: String,
    output: String,
    cache_read: String,
}

/// The overview and cost tables `opencode stats` draws: each row a label and a value between box lines.
fn parse_stats(out: &str, days: u32) -> OpenCodeStats {
    let mut s = OpenCodeStats { days, ..Default::default() };
    for line in out.lines() {
        let row = line.trim().trim_matches(|c| c == '│').trim();
        let Some((label, value)) = row.rsplit_once(char::is_whitespace) else {
            continue;
        };
        let value = value.to_string();
        match label.trim() {
            "Sessions" => s.sessions = value,
            "Messages" if s.messages.is_empty() => s.messages = value,
            "Total Cost" => s.cost = value,
            "Input" => s.input = value,
            "Output" => s.output = value,
            "Cache Read" if s.cache_read.is_empty() => s.cache_read = value,
            _ => {}
        }
    }
    s
}

/// What OpenCode's used over the last week: sessions, messages, tokens and what it says they cost.
#[tauri::command]
pub async fn opencode_usage() -> Result<OpenCodeStats, String> {
    const DAYS: u32 = 7;
    tauri::async_runtime::spawn_blocking(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        let path = std::env::var("PATH").unwrap_or_default();
        let mut cmd = Command::new("opencode");
        cmd.args(["stats", "--days", &DAYS.to_string(), "--tools", "0"]).env(
            "PATH",
            format!("{path}:{home}/.opencode/bin:{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin"),
        );
        let out = output(cmd, "OpenCode isn't installed: see opencode.ai")?;
        Ok(parse_stats(&out, DAYS))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_limits_in_usage_output() {
        let out = r#"{"type":"system","subtype":"init"}
{"type":"assistant","usage_report":{"rate_limits":{"limits":[{"kind":"session","percent":20}]}}}
{"type":"result"}"#;
        assert_eq!(report_in(out).unwrap()["limits"][0]["percent"], 20);
        assert!(report_in(r#"{"type":"result"}"#).is_none());
    }

    #[test]
    fn reads_opencode_stats_tables() {
        let out = "┌──┐\n│Sessions                    8 │\n│Messages                   82 │\n│Total Cost              $0.00 │\n│Input                  245.3K │\n│Output                   9.4K │\n│Cache Read               1.7M │\n│ opencode/big-pickle        │\n│  Messages                 69 │\n";
        let s = parse_stats(out, 7);
        assert_eq!(
            s,
            OpenCodeStats {
                days: 7,
                sessions: "8".into(),
                messages: "82".into(),
                cost: "$0.00".into(),
                input: "245.3K".into(),
                output: "9.4K".into(),
                cache_read: "1.7M".into(),
            }
        );
    }
}
