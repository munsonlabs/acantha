//! Reading Slack messages and canvases with the user's own token, kept in the macOS Keychain (never in the app's
//! files or the webview). Requests go through the system `curl`, with the token on its stdin so it never shows in a
//! process listing.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;

const KEYCHAIN_SERVICE: &str = "com.munsonlabs.acantha.slack";

fn token() -> Result<String, String> {
    let out = Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
        .output()
        .map_err(|e| format!("Couldn't read the Keychain: {e}"))?;
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || token.is_empty() {
        return Err(format!(
            "No Slack token in the Keychain. Add your user token (xoxp-…) in Terminal with: security add-generic-password -a \"$USER\" -s {KEYCHAIN_SERVICE} -w"
        ));
    }
    Ok(token)
}

fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let token = token()?;
    let mut child = Command::new("curl")
        .args(["-sS", "--location", "--max-time", "20", "-H", "@-", url])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run curl: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("Couldn't talk to curl")?
        .write_all(format!("Authorization: Bearer {token}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Couldn't reach Slack: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout)
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Slack's error codes, said plainly.
fn explain(code: &str) -> String {
    match code {
        "channel_not_found" => "Slack can't find that channel, or you aren't in it.".into(),
        "thread_not_found" | "message_not_found" => "That message doesn't exist any more, or you can't see it.".into(),
        "file_not_found" | "file_deleted" => "That canvas doesn't exist any more, or you can't see it.".into(),
        "missing_scope" => "The Slack app is missing a permission this needs (see the Slack section of Settings).".into(),
        "not_authed" | "invalid_auth" | "token_revoked" | "token_expired" | "account_inactive" => {
            "The Slack token in the Keychain was rejected. Copy a fresh User OAuth Token from the app's settings.".into()
        }
        "ratelimited" => "Slack asked to slow down. Try again in a minute.".into(),
        other => format!("Slack said: {other}"),
    }
}

fn api(method: &str, params: &[(&str, &str)]) -> Result<Value, String> {
    let query: Vec<String> = params.iter().map(|(k, v)| format!("{k}={}", encode(v))).collect();
    let body = fetch(&format!("https://slack.com/api/{method}?{}", query.join("&")))?;
    let json: Value = serde_json::from_slice(&body).map_err(|_| "Slack sent back something unexpected.".to_string())?;
    if json["ok"].as_bool() != Some(true) {
        return Err(explain(json["error"].as_str().unwrap_or("unknown_error")));
    }
    Ok(json)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SlackUser {
    id: String,
    name: String,
    avatar: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackFile {
    name: String,
    permalink: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackMessage {
    ts: String,
    /// A person's id, for `users`. Bots and integrations have `author` instead.
    user: Option<String>,
    author: Option<String>,
    text: String,
    files: Vec<SlackFile>,
    edited: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackThread {
    channel: String,
    messages: Vec<SlackMessage>,
    /// Everyone who wrote or was mentioned, by id.
    users: HashMap<String, SlackUser>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackCanvas {
    title: String,
    html: String,
    /// Channels it's shared in.
    channels: Vec<String>,
    permalink: Option<String>,
}

static USERS: Mutex<Option<HashMap<String, SlackUser>>> = Mutex::new(None);

fn user(id: &str) -> SlackUser {
    if let Some(u) = USERS.lock().unwrap().get_or_insert_with(HashMap::new).get(id) {
        return u.clone();
    }
    let found = api("users.info", &[("user", id)]).ok().map(|json| {
        let u = &json["user"];
        let profile = &u["profile"];
        let pick = |v: &Value| v.as_str().filter(|s| !s.is_empty()).map(String::from);
        SlackUser {
            id: id.to_string(),
            name: pick(&profile["display_name"])
                .or(pick(&profile["real_name"]))
                .or(pick(&u["name"]))
                .unwrap_or_else(|| id.to_string()),
            avatar: pick(&profile["image_48"]),
        }
    });
    // Without users:read, or for someone who's gone, show the id rather than failing the whole thread.
    let user = found.unwrap_or_else(|| SlackUser {
        id: id.to_string(),
        name: id.to_string(),
        avatar: None,
    });
    USERS
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .insert(id.to_string(), user.clone());
    user
}

/// The user ids mentioned in a message's text, as `<@U123>` or `<@U123|name>`.
fn mentions(text: &str) -> Vec<String> {
    text.split("<@")
        .skip(1)
        .filter_map(|rest| rest.split(['>', '|']).next())
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(String::from)
        .collect()
}

fn parse_message(m: &Value) -> SlackMessage {
    let mut text = m["text"].as_str().unwrap_or_default().to_string();
    // Integrations often put everything in legacy attachments.
    for a in m["attachments"].as_array().into_iter().flatten() {
        let part = a["text"].as_str().or(a["fallback"].as_str()).unwrap_or_default();
        if !part.is_empty() {
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            if let Some(title) = a["title"].as_str() {
                text.push_str(&format!("*{title}*\n"));
            }
            text.push_str(part);
        }
    }
    SlackMessage {
        ts: m["ts"].as_str().unwrap_or_default().to_string(),
        user: m["user"].as_str().map(String::from),
        author: m["username"].as_str().or(m["bot_profile"]["name"].as_str()).map(String::from),
        text,
        files: m["files"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|f| SlackFile {
                name: f["title"].as_str().or(f["name"].as_str()).unwrap_or("file").to_string(),
                permalink: f["permalink"].as_str().map(String::from),
            })
            .collect(),
        edited: m["edited"].is_object(),
    }
}

const NOT_ALLOWED: &str = "That's from a channel Acantha isn't allowed to read. Add its channel ID under Slack in Settings.";

/// A message and its thread. `ts` is the message from the link; `thread_ts` is its thread's parent when the link
/// points at a reply. `allowed` limits which channels may be read (empty: any the token can see).
#[tauri::command]
pub async fn slack_thread(channel: String, ts: String, thread_ts: Option<String>, allowed: Vec<String>) -> Result<SlackThread, String> {
    if !allowed.is_empty() && !allowed.contains(&channel) {
        return Err(NOT_ALLOWED.into());
    }
    let parent = thread_ts.unwrap_or(ts);
    let json = api(
        "conversations.replies",
        &[("channel", &channel), ("ts", &parent), ("limit", "200"), ("inclusive", "true")],
    )?;
    let messages: Vec<SlackMessage> = json["messages"].as_array().into_iter().flatten().map(parse_message).collect();
    let mut users = HashMap::new();
    for id in messages.iter().flat_map(|m| m.user.clone().into_iter().chain(mentions(&m.text))) {
        if !users.contains_key(&id) {
            users.insert(id.clone(), user(&id));
        }
    }
    Ok(SlackThread { channel, messages, users })
}

/// A canvas, as the HTML Slack exports it as. With `allowed`, only one shared in one of those channels, checked before
/// its content is downloaded.
#[tauri::command]
pub async fn slack_canvas(file: String, allowed: Vec<String>) -> Result<SlackCanvas, String> {
    let json = api("files.info", &[("file", &file)])?;
    let f = &json["file"];
    let mut channels: Vec<String> = ["channels", "groups"]
        .iter()
        .flat_map(|k| f[k].as_array().into_iter().flatten().filter_map(|c| c.as_str().map(String::from)))
        .collect();
    for scope in ["public", "private"] {
        if let Some(shared) = f["shares"][scope].as_object() {
            channels.extend(shared.keys().cloned());
        }
    }
    channels.sort();
    channels.dedup();
    if !allowed.is_empty() && !channels.iter().any(|c| allowed.contains(c)) {
        return Err(NOT_ALLOWED.into());
    }
    let url = f["url_private_download"]
        .as_str()
        .or(f["url_private"].as_str())
        .ok_or("Slack didn't say where that canvas's content is.")?;
    let html = String::from_utf8_lossy(&fetch(url)?).into_owned();
    Ok(SlackCanvas {
        title: f["title"].as_str().or(f["name"].as_str()).unwrap_or("Canvas").to_string(),
        html,
        channels,
        permalink: f["permalink"].as_str().map(String::from),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_query_values() {
        assert_eq!(encode("1729.0001"), "1729.0001");
        assert_eq!(encode("a b&c"), "a%20b%26c");
    }

    #[test]
    fn finds_mentions() {
        assert_eq!(mentions("hi <@U1> and <@U2|ann>, not <#C1> or <@bad id>"), ["U1", "U2"]);
    }

    #[test]
    fn folds_attachments_into_text() {
        let m = serde_json::json!({ "ts": "1.2", "text": "deploy", "attachments": [{ "title": "Build", "text": "passed" }], "edited": {} });
        let parsed = parse_message(&m);
        assert_eq!(parsed.text, "deploy\n\n*Build*\npassed");
        assert!(parsed.edited);
    }
}
