//! OpenCode agents. One `opencode serve` runs on localhost for all of them (started when one first needs it, with a
//! password of its own), each agent a session of it in its folder. Its event stream is turned into the lines a Claude
//! Code conversation prints (see claude.rs), so the views, statuses and usage take an OpenCode agent as they do a
//! Claude one: streamed text and tool calls as Claude's stream events and messages, a permission request as a
//! `control_request`, and the end of a turn as a `result` with what the session's cost so far.
//!
//! Acantha's modes become OpenCode permission rules and answers: every session asks before editing files, running
//! commands or fetching from the web, and the mode decides which of those asks are answered here (Auto lets them all
//! through, Edit files lets edits through) and which come to you. Plan uses OpenCode's own plan agent.

use crate::claude::{broadcast, notify, Claudes, MODES};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

/// The running server: where it is, and how to talk to it.
struct Server {
    child: Child,
    base: String,
    password: String,
}

#[derive(Clone)]
struct Api {
    base: String,
    password: String,
    client: reqwest::blocking::Client,
}

impl Api {
    fn call(&self, method: reqwest::Method, path: &str, dir: Option<&str>, body: Option<Value>) -> Result<Value, String> {
        let query = dir.map(|d| format!("?directory={}", encode(d))).unwrap_or_default();
        let mut req = self
            .client
            .request(method, format!("{}{path}{query}", self.base))
            .basic_auth("opencode", Some(&self.password));
        if let Some(body) = body {
            req = req.json(&body);
        }
        let res = req.send().map_err(|e| format!("OpenCode didn't answer: {e}"))?;
        let status = res.status();
        let text = res.text().unwrap_or_default();
        if !status.is_success() {
            return Err(format!("OpenCode: {status} {}", text.chars().take(300).collect::<String>()));
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }
    fn get(&self, path: &str, dir: Option<&str>) -> Result<Value, String> {
        self.call(reqwest::Method::GET, path, dir, None)
    }
    fn post(&self, path: &str, dir: Option<&str>, body: Value) -> Result<Value, String> {
        self.call(reqwest::Method::POST, path, dir, Some(body))
    }
}

/// A query value, percent-encoded: everything but letters, digits and `-_.~/`.
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~/".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

#[derive(Default)]
pub struct OpenCode {
    server: Mutex<Option<Server>>,
    /// Which conversation each OpenCode session is, so its events reach it.
    sessions: Mutex<HashMap<String, String>>,
}

impl OpenCode {
    pub fn stop(&self) {
        if let Some(mut s) = self.server.lock().unwrap().take() {
            let _ = s.child.kill();
        }
    }

    fn api(server: &Server) -> Api {
        Api {
            base: server.base.clone(),
            password: server.password.clone(),
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }

    /// The server, started if it isn't running: once it says where it's listening and its event stream is open.
    fn ensure<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Api, String> {
        let mut server = self.server.lock().unwrap();
        if let Some(s) = server.as_mut() {
            if s.child.try_wait().ok().flatten().is_none() {
                return Ok(Self::api(s));
            }
        }
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map_err(|e| e.to_string())?
            .port();
        let password = secret();
        let home = std::env::var("HOME").unwrap_or_default();
        let path = std::env::var("PATH").unwrap_or_default();
        let mut child = Command::new("opencode")
            .args(["serve", "--hostname", "127.0.0.1", "--port", &port.to_string()])
            .env("OPENCODE_SERVER_PASSWORD", &password)
            // Apps opened from Finder get a short PATH; OpenCode installs to ~/.opencode/bin.
            .env(
                "PATH",
                format!("{path}:{home}/.opencode/bin:{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin"),
            )
            .current_dir(&home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "OpenCode isn't installed: see opencode.ai".to_string()
                } else {
                    e.to_string()
                }
            })?;
        // It says when it's listening; the rest of what it prints is drained so it never blocks.
        let stdout = child.stdout.take().ok_or("No output from opencode")?;
        let (ready, listening) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.contains("listening on") {
                    let _ = ready.send(());
                }
            }
        });
        if listening.recv_timeout(Duration::from_secs(30)).is_err() {
            let _ = child.kill();
            return Err("OpenCode's server didn't start".into());
        }
        let s = Server {
            child,
            base: format!("http://127.0.0.1:{port}"),
            password,
        };
        let api = Self::api(&s);
        *server = Some(s);
        drop(server);
        listen(app, api.clone())?;
        Ok(api)
    }
}

/// A password for the server, from what the system has to hand (no crate for it): only this app talks to it.
fn secret() -> String {
    use std::hash::{BuildHasher, Hasher};
    (0..4)
        .map(|i| {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(i ^ std::process::id() as u64);
            format!("{:016x}", h.finish())
        })
        .collect()
}

/// Follows the server's events (every folder's), passing each to its conversation, until the server goes.
fn listen<R: Runtime>(app: &AppHandle<R>, api: Api) -> Result<(), String> {
    // No timeout: the stream stays open for as long as the server runs.
    let client = reqwest::blocking::Client::builder().timeout(None).build().map_err(|e| e.to_string())?;
    let res = client
        .get(format!("{}/global/event", api.base))
        .basic_auth("opencode", Some(&api.password))
        .send()
        .map_err(|e| format!("OpenCode's events: {e}"))?;
    let app = app.clone();
    let (connected, opened) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(res).lines().map_while(Result::ok) {
            let Some(data) = line.strip_prefix("data:") else { continue };
            let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
                continue;
            };
            let event = if event["payload"].is_object() { &event["payload"] } else { &event };
            if event["type"] == "server.connected" {
                let _ = connected.send(());
            }
            handle(&app, &api, event);
        }
        // The stream's gone with the server: its turns end, and the next message starts it again.
        let oc = app.state::<OpenCode>();
        oc.stop();
        let ids: Vec<String> = oc.sessions.lock().unwrap().values().cloned().collect();
        let claudes = app.state::<Claudes>();
        let mut all = claudes.conversations.lock().unwrap();
        for id in ids {
            if let Some(c) = all.get_mut(&id) {
                if c.oc.as_ref().is_some_and(|s| s.busy) {
                    c.oc.as_mut().unwrap().busy = false;
                    broadcast(
                        c,
                        json!({ "type": "result", "is_error": true, "result": "OpenCode stopped." }).to_string(),
                    );
                }
            }
        }
    });
    // Subscribed before anything's sent, as the server doesn't replay what was missed.
    opened
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "OpenCode's events didn't start".to_string())
}

/// One event: turned into lines for its session's conversation, and any permission the mode lets through answered.
fn handle<R: Runtime>(app: &AppHandle<R>, api: &Api, event: &Value) {
    let p = &event["properties"];
    let Some(session) = p["sessionID"].as_str().or_else(|| p["info"]["sessionID"].as_str()) else {
        return;
    };
    let Some(id) = app.state::<OpenCode>().sessions.lock().unwrap().get(session).cloned() else {
        return;
    };
    let claudes = app.state::<Claudes>();
    let mut all = claudes.conversations.lock().unwrap();
    let Some(c) = all.get_mut(&id) else { return };
    let Some(s) = c.oc.as_mut() else { return };
    let name = s.cwd.rsplit('/').next().unwrap_or("").to_string();
    let out = s.translate(event);
    for o in out {
        match o {
            Out::Line(line) => {
                match line["type"].as_str() {
                    Some("control_request") => notify(
                        app,
                        &format!("OpenCode is waiting for you in {name}"),
                        line["request"]["description"].as_str().unwrap_or(""),
                    ),
                    Some("result") if line["is_error"] != true => notify(app, &format!("OpenCode is done in {name}"), "Its reply is waiting."),
                    _ => {}
                }
                broadcast(c, line.to_string());
            }
            Out::Allow(request) => {
                // Answered in its session's folder: OpenCode doesn't find the request otherwise.
                let (api, cwd) = (api.clone(), c.oc.as_ref().map(|s| s.cwd.clone()).unwrap_or_default());
                std::thread::spawn(move || api.post(&format!("/permission/{request}/reply"), Some(&cwd), json!({ "reply": "once" })));
            }
        }
    }
}

/// What an event comes to: a line for the conversation, or a permission to let through.
#[derive(Debug, PartialEq)]
enum Out {
    Line(Value),
    Allow(String),
}

#[derive(Default)]
struct Part {
    index: usize,
    /// "text", "reasoning" or "tool".
    kind: String,
    text: String,
    tool: Option<(String, String, Value)>,
    input_sent: bool,
    done: bool,
}

#[derive(Default)]
struct Message {
    user: bool,
    started: bool,
    parts: HashMap<String, Part>,
    order: Vec<String>,
    /// What it cost, and its tokens: in (with cache writes) and out.
    usage: (f64, u64, u64),
}

/// An OpenCode agent's session, and what's needed to turn its events into a Claude-like conversation.
#[derive(Default)]
pub struct Session {
    pub(crate) id: String,
    cwd: String,
    /// Acantha's mode: which asks are answered here.
    mode: String,
    pub(crate) busy: bool,
    error: Option<String>,
    messages: HashMap<String, Message>,
    /// The tokens already reported, so each turn reports its own.
    reported: (u64, u64),
}

/// OpenCode's tool names as Claude Code's, so they show with the same icons and summaries.
fn tool_name(tool: &str) -> String {
    match tool {
        "bash" => "Bash",
        "edit" | "patch" | "multiedit" => "Edit",
        "write" => "Write",
        "read" => "Read",
        "grep" => "Grep",
        "glob" => "Glob",
        "list" => "LS",
        "webfetch" => "WebFetch",
        "websearch" => "WebSearch",
        "todowrite" => "TodoWrite",
        "todoread" => "TodoRead",
        "task" => "Task",
        other => return other[..1].to_uppercase() + &other[1..],
    }
    .to_string()
}

/// A tool's input with Claude Code's names for its fields: `filePath` is `file_path`, and so on.
fn tool_input(input: &Value) -> Value {
    let Some(map) = input.as_object() else { return input.clone() };
    let snake = |k: &str| {
        let mut out = String::new();
        for ch in k.chars() {
            if ch.is_ascii_uppercase() {
                out.push('_');
                out.push(ch.to_ascii_lowercase());
            } else {
                out.push(ch);
            }
        }
        if out == "filepath" {
            "file_path".to_string()
        } else {
            out
        }
    };
    Value::Object(map.iter().map(|(k, v)| (snake(k), v.clone())).collect())
}

impl Session {
    fn new(id: String, cwd: String, mode: String) -> Self {
        Session {
            id,
            cwd,
            mode,
            ..Default::default()
        }
    }

    fn total(&self) -> (f64, u64, u64) {
        self.messages
            .values()
            .fold((0.0, 0, 0), |(c, i, o), m| (c + m.usage.0, i + m.usage.1, o + m.usage.2))
    }

    /// What an event comes to, for this session.
    fn translate(&mut self, event: &Value) -> Vec<Out> {
        let p = &event["properties"];
        let mut out = Vec::new();
        let stream = |mid: &str, ev: Value| Out::Line(json!({ "type": "stream_event", "event": ev, "api_message_id": mid }));
        match event["type"].as_str().unwrap_or("") {
            "message.updated" => {
                let info = &p["info"];
                let Some(mid) = info["id"].as_str() else { return out };
                let m = self.messages.entry(mid.into()).or_default();
                m.user = info["role"] == "user";
                if m.user {
                    return out;
                }
                let n = |k: &Value| k.as_u64().unwrap_or(0);
                m.usage = (
                    info["cost"].as_f64().unwrap_or(0.0),
                    n(&info["tokens"]["input"]) + n(&info["tokens"]["cache"]["write"]),
                    n(&info["tokens"]["output"]) + n(&info["tokens"]["reasoning"]),
                );
                // Done: the whole message, so a view that comes along later has it (stream events aren't kept).
                if info["time"]["completed"].is_number() && m.started {
                    let content: Vec<Value> = m
                        .order
                        .iter()
                        .filter_map(|id| m.parts.get(id))
                        .filter_map(|part| match (&part.kind[..], &part.tool) {
                            ("text", _) if !part.text.is_empty() => Some(json!({ "type": "text", "text": part.text })),
                            ("tool", Some((call, name, input))) => Some(json!({ "type": "tool_use", "id": call, "name": name, "input": input })),
                            _ => None,
                        })
                        .collect();
                    out.push(Out::Line(json!({ "type": "assistant", "message": { "id": mid, "content": content } })));
                }
            }
            "message.part.updated" | "message.part.delta" => {
                let delta = event["type"] == "message.part.delta";
                let part = &p["part"];
                let (mid, pid) = if delta {
                    (p["messageID"].as_str(), p["partID"].as_str())
                } else {
                    (part["messageID"].as_str(), part["id"].as_str())
                };
                let (Some(mid), Some(pid)) = (mid, pid) else { return out };
                let kind = if delta { "text" } else { part["type"].as_str().unwrap_or("") };
                if !matches!(kind, "text" | "reasoning" | "tool") {
                    return out;
                }
                let m = self.messages.entry(mid.into()).or_default();
                if m.user {
                    return out;
                }
                if !m.started {
                    m.started = true;
                    out.push(stream(mid, json!({ "type": "message_start", "message": { "id": mid } })));
                }
                let index = m.order.len();
                let fresh = !m.parts.contains_key(pid);
                let entry = m.parts.entry(pid.into()).or_insert_with(|| Part {
                    index,
                    kind: kind.into(),
                    ..Default::default()
                });
                if fresh {
                    m.order.push(pid.into());
                    let block = match kind {
                        "text" => json!({ "type": "text", "text": "" }),
                        "reasoning" => json!({ "type": "thinking", "thinking": "" }),
                        _ => {
                            let call = part["callID"].as_str().unwrap_or(pid).to_string();
                            let name = tool_name(part["tool"].as_str().unwrap_or("tool"));
                            entry.tool = Some((call.clone(), name.clone(), json!({})));
                            json!({ "type": "tool_use", "id": call, "name": name, "input": {} })
                        }
                    };
                    out.push(stream(
                        mid,
                        json!({ "type": "content_block_start", "index": entry.index, "content_block": block }),
                    ));
                }
                match &entry.kind[..] {
                    // Text arrives as deltas, or whole; either way only what's new is passed on.
                    "text" => {
                        let more = if delta {
                            p["delta"].as_str().unwrap_or("").to_string()
                        } else {
                            part["text"].as_str().unwrap_or("").get(entry.text.len()..).unwrap_or("").to_string()
                        };
                        if !more.is_empty() {
                            entry.text.push_str(&more);
                            out.push(stream(
                                mid,
                                json!({ "type": "content_block_delta", "index": entry.index, "delta": { "type": "text_delta", "text": more } }),
                            ));
                        }
                    }
                    "tool" if !delta => {
                        let state = &part["state"];
                        let input = &state["input"];
                        if let Some((call, name, sent)) = entry.tool.as_mut() {
                            if !entry.input_sent && input.as_object().is_some_and(|o| !o.is_empty()) {
                                entry.input_sent = true;
                                *sent = tool_input(input);
                                let block = json!({ "type": "tool_use", "id": call, "name": name, "input": sent });
                                out.push(Out::Line(json!({ "type": "assistant", "message": { "id": mid, "content": [block] } })));
                            }
                            let status = state["status"].as_str().unwrap_or("");
                            if !entry.done && (status == "completed" || status == "error") {
                                entry.done = true;
                                let error = status == "error";
                                let content = if error { state["error"].as_str() } else { state["output"].as_str() }.unwrap_or("");
                                let result = json!({ "type": "tool_result", "tool_use_id": call, "content": content, "is_error": error });
                                out.push(Out::Line(json!({ "type": "user", "message": { "content": [result] } })));
                            }
                        }
                    }
                    _ => {}
                }
            }
            "session.status" if p["status"]["type"] == "busy" => self.busy = true,
            "session.status" | "session.idle" => {
                if p["status"]["type"] == "busy" || !self.busy {
                    return out;
                }
                // The turn's over: what it came to, as Claude Code's `result` says it.
                self.busy = false;
                let (cost, tin, tout) = self.total();
                let usage = json!({ "input_tokens": tin.saturating_sub(self.reported.0), "output_tokens": tout.saturating_sub(self.reported.1) });
                self.reported = (tin, tout);
                let error = self.error.take();
                out.push(Out::Line(json!({
                    "type": "result",
                    "session_id": self.id,
                    "total_cost_usd": cost,
                    "usage": usage,
                    "is_error": error.is_some(),
                    "result": error,
                })));
            }
            "session.error" => {
                let e = &p["error"];
                if e["name"] != "MessageAbortedError" {
                    self.error = Some(
                        e["data"]["message"]
                            .as_str()
                            .or_else(|| e["name"].as_str())
                            .unwrap_or("OpenCode stopped with an error.")
                            .to_string(),
                    );
                }
            }
            "permission.asked" => {
                let Some(request) = p["id"].as_str() else { return out };
                let permission = p["permission"].as_str().unwrap_or("");
                // The asks every session makes, answered here when the mode lets them through.
                let let_through = match &self.mode[..] {
                    "auto" => matches!(permission, "edit" | "bash" | "webfetch"),
                    "acceptEdits" => permission == "edit",
                    _ => false,
                };
                if let_through {
                    out.push(Out::Allow(request.into()));
                    return out;
                }
                let meta = tool_input(&p["metadata"]);
                let patterns: Vec<&str> = p["patterns"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
                let description = meta["command"]
                    .as_str()
                    .or_else(|| meta["file_path"].as_str())
                    .map(String::from)
                    .unwrap_or_else(|| patterns.join(", "));
                out.push(Out::Line(json!({
                    "type": "control_request",
                    "request_id": request,
                    "request": {
                        "subtype": "can_use_tool",
                        "tool_name": tool_name(permission),
                        "display_name": tool_name(permission),
                        "input": meta,
                        "description": description,
                        "blocked_path": meta["file_path"],
                    },
                })));
            }
            "permission.replied" => {
                if let Some(request) = p["requestID"].as_str() {
                    out.push(Out::Line(
                        json!({ "type": "acantha_answered", "request_id": request, "allow": p["reply"] != "reject" }),
                    ));
                }
            }
            _ => {}
        }
        out
    }
}

/// The permission rules every session's made with: ask before editing, running commands or fetching from the web.
fn rules() -> Value {
    json!(["edit", "bash", "webfetch"].map(|p| json!({ "permission": p, "pattern": "*", "action": "ask" })))
}

/// A model chosen as `provider/model`, as OpenCode wants it in a prompt.
fn model_of(model: Option<&str>) -> Option<Value> {
    let (provider, id) = model?.split_once('/')?;
    Some(json!({ "providerID": provider, "modelID": id }))
}

/// The slash commands OpenCode has in a folder, as Claude Code's `commands_changed` line lists them.
fn commands(api: &Api, cwd: &str) -> Value {
    let list = api.get("/command", Some(cwd)).unwrap_or(Value::Null);
    let commands: Vec<Value> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| Some(json!({ "name": c["name"].as_str()?, "description": c["description"], "argumentHint": "" })))
        .collect();
    json!({ "type": "system", "subtype": "commands_changed", "commands": commands })
}

/// An OpenCode session id: `ses_` and letters and digits, so nothing else reaches a URL.
fn session_ok(id: &str) -> bool {
    id.starts_with("ses_") && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Sends an OpenCode agent a message, starting the server and its session if need be. A message starting with one
/// of OpenCode's slash commands runs that command.
#[tauri::command]
pub async fn opencode_send<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cwd: String,
    text: String,
    mode: String,
    model: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send(&app, &id, &cwd, &text, &mode, model.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

fn send<R: Runtime>(app: &AppHandle<R>, id: &str, cwd: &str, text: &str, mode: &str, model: Option<&str>) -> Result<(), String> {
    if !MODES.contains(&mode) {
        return Err(format!("Unknown permission mode {mode}"));
    }
    let api = app.state::<OpenCode>().ensure(app)?;
    let claudes = app.state::<Claudes>();
    // Its session: the one it has, the one it's carrying on from, or a new one.
    let existing = {
        let all = claudes.conversations.lock().unwrap();
        let c = all.get(id);
        c.and_then(|c| c.oc.as_ref().map(|s| s.id.clone()))
            .or_else(|| c.and_then(|c| c.session_id.clone()).filter(|s| session_ok(s)))
    };
    let session = match existing {
        Some(s) => s,
        None => {
            let made = api.post("/session", Some(cwd), json!({ "title": "Acantha agent", "permission": rules() }))?;
            made["id"]
                .as_str()
                .filter(|s| session_ok(s))
                .ok_or("OpenCode didn't make a session")?
                .to_string()
        }
    };
    app.state::<OpenCode>().sessions.lock().unwrap().insert(session.clone(), id.to_string());
    let commands = commands(&api, cwd);
    let known: Vec<String> = commands["commands"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["name"].as_str().map(String::from))
        .collect();
    {
        let mut all = claudes.conversations.lock().unwrap();
        let c = all.entry(id.to_string()).or_default();
        if c.oc.as_ref().is_none_or(|s| s.id != session) {
            c.oc = Some(Session::new(session.clone(), cwd.to_string(), mode.to_string()));
            c.session_id = Some(session.clone());
            broadcast(
                c,
                json!({ "type": "system", "subtype": "init", "session_id": session, "model": model }).to_string(),
            );
            broadcast(c, commands.to_string());
        }
        let s = c.oc.as_mut().unwrap();
        s.mode = mode.to_string();
        s.busy = true;
        broadcast(c, json!({ "type": "acantha_user", "text": text }).to_string());
    }
    let agent = if mode == "plan" { "plan" } else { "build" };
    let slash = text
        .strip_prefix('/')
        .map(|t| t.split_once(' ').unwrap_or((t, "")))
        .filter(|(name, _)| known.iter().any(|k| k == name));
    let session_path = format!("/session/{session}");
    let cwd = cwd.to_string();
    match slash {
        // A command's answer comes when it's done, so it's asked for on a thread of its own; its events say the rest.
        Some((name, args)) => {
            let body = json!({ "command": name, "arguments": args, "agent": agent, "model": model });
            std::thread::spawn(move || api.post(&format!("{session_path}/command"), Some(&cwd), body));
        }
        None => {
            let mut body = json!({ "parts": [{ "type": "text", "text": text }], "agent": agent });
            if let Some(m) = model_of(model) {
                body["model"] = m;
            }
            api.post(&format!("{session_path}/prompt_async"), Some(&cwd), body)?;
        }
    }
    Ok(())
}

/// Answers a permission request: allowed this once, or refused.
#[tauri::command]
pub async fn opencode_answer<R: Runtime>(app: AppHandle<R>, id: String, request_id: String, allow: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !request_id.starts_with("per_") || !request_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Err("That isn't a permission request".to_string());
        }
        let claudes = app.state::<Claudes>();
        let cwd = claudes
            .conversations
            .lock()
            .unwrap()
            .get(&id)
            .and_then(|c| c.oc.as_ref().map(|s| s.cwd.clone()))
            .ok_or("No conversation")?;
        let api = app.state::<OpenCode>().ensure(&app)?;
        // In its session's folder: OpenCode doesn't find the request otherwise.
        let reply = json!({ "reply": if allow { "once" } else { "reject" } });
        api.post(&format!("/permission/{request_id}/reply"), Some(&cwd), reply)?;
        if let Some(c) = claudes.conversations.lock().unwrap().get_mut(&id) {
            broadcast(
                c,
                json!({ "type": "acantha_answered", "request_id": request_id, "allow": allow }).to_string(),
            );
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the reply under way; the session carries on with the next message.
#[tauri::command]
pub async fn opencode_interrupt<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let claudes = app.state::<Claudes>();
        let (session, cwd) = {
            let mut all = claudes.conversations.lock().unwrap();
            let Some(c) = all.get_mut(&id) else { return Ok(()) };
            let Some(s) = c.oc.as_ref().filter(|s| s.busy) else { return Ok(()) };
            let found = (s.id.clone(), s.cwd.clone());
            broadcast(c, json!({ "type": "acantha_interrupted" }).to_string());
            found
        };
        let api = app.state::<OpenCode>().ensure(&app)?;
        api.post(&format!("/session/{session}/abort"), Some(&cwd), json!({})).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A model to pick: `provider/model`, and its name.
#[derive(serde::Serialize)]
pub struct Model {
    id: String,
    label: String,
}

/// The models OpenCode's set up with, its default first.
#[tauri::command]
pub async fn opencode_models<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Model>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let api = app.state::<OpenCode>().ensure(&app)?;
        let config = api.get("/config/providers", None)?;
        let defaults = &config["default"];
        let mut models = Vec::new();
        for provider in config["providers"].as_array().into_iter().flatten() {
            let pid = provider["id"].as_str().unwrap_or("");
            let pname = provider["name"].as_str().unwrap_or(pid);
            for (mid, m) in provider["models"].as_object().into_iter().flatten() {
                let label = format!("{pname} · {}", m["name"].as_str().unwrap_or(mid));
                let model = Model {
                    id: format!("{pid}/{mid}"),
                    label,
                };
                if defaults[pid] == mid.as_str() {
                    models.insert(0, model);
                } else {
                    models.push(model);
                }
            }
        }
        Ok(models)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Picks up an OpenCode agent's saved session: what was said in it, shown, and the next message carrying it on.
#[tauri::command]
pub async fn opencode_history<R: Runtime>(app: AppHandle<R>, id: String, session: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !session_ok(&session) {
            return Err("That isn't an OpenCode session".to_string());
        }
        let api = app.state::<OpenCode>().ensure(&app)?;
        let messages = api.get(&format!("/session/{session}/message"), None)?;
        let lines = history(&messages);
        let claudes = app.state::<Claudes>();
        let mut all = claudes.conversations.lock().unwrap();
        let c = all.entry(id.clone()).or_default();
        if !c.log.is_empty() {
            return Ok(());
        }
        c.session_id = Some(session.clone());
        app.state::<OpenCode>().sessions.lock().unwrap().insert(session, id);
        for line in lines {
            broadcast(c, line.to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A session's messages as a conversation's lines: what you said, then each reply with its tool calls and results.
fn history(messages: &Value) -> Vec<Value> {
    let mut lines = Vec::new();
    for m in messages.as_array().into_iter().flatten() {
        let info = &m["info"];
        let parts = m["parts"].as_array().cloned().unwrap_or_default();
        if info["role"] == "user" {
            let text: Vec<&str> = parts
                .iter()
                .filter(|p| p["type"] == "text" && p["synthetic"] != true)
                .filter_map(|p| p["text"].as_str())
                .collect();
            if !text.is_empty() {
                lines.push(json!({ "type": "acantha_user", "text": text.join("\n") }));
            }
            continue;
        }
        let mut content = Vec::new();
        let mut results = Vec::new();
        for p in &parts {
            match p["type"].as_str() {
                Some("text") => content.push(json!({ "type": "text", "text": p["text"] })),
                Some("tool") => {
                    let call = p["callID"].as_str().unwrap_or("");
                    let state = &p["state"];
                    content.push(json!({ "type": "tool_use", "id": call, "name": tool_name(p["tool"].as_str().unwrap_or("tool")), "input": tool_input(&state["input"]) }));
                    let error = state["status"] == "error";
                    let output = if error { &state["error"] } else { &state["output"] };
                    results.push(json!({ "type": "tool_result", "tool_use_id": call, "content": output.as_str().unwrap_or(""), "is_error": error }));
                }
                _ => {}
            }
        }
        lines.push(json!({ "type": "assistant", "message": { "id": info["id"], "content": content } }));
        if !results.is_empty() {
            lines.push(json!({ "type": "user", "message": { "content": results } }));
        }
    }
    // Shown, not working.
    lines.push(json!({ "type": "acantha_stopped" }));
    lines
}

/// Lets go of a closed agent's session here (OpenCode keeps it, to carry on later), stopping a reply under way. With
/// no OpenCode agent left, the server stops too, rather than sit there using memory: the next agent starts it again.
pub fn forget<R: Runtime>(app: &AppHandle<R>, session: Option<(String, String, bool)>) {
    let oc = app.state::<OpenCode>();
    if let Some((session, _, _)) = &session {
        oc.sessions.lock().unwrap().remove(session);
    }
    let any_left = app.state::<Claudes>().conversations.lock().unwrap().values().any(|c| c.oc.is_some());
    if !any_left {
        // Stopping it ends any reply under way, too.
        return oc.stop();
    }
    let Some((session, cwd, true)) = session else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok(api) = app.state::<OpenCode>().ensure(&app) {
            let _ = api.post(&format!("/session/{session}/abort"), Some(&cwd), json!({}));
        }
    });
}

/// What `forget` needs from a conversation that's going.
pub(crate) fn leaving(s: &Session) -> (String, String, bool) {
    (s.id.clone(), s.cwd.clone(), s.busy)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(out: Vec<Out>) -> Vec<Value> {
        out.into_iter()
            .filter_map(|o| match o {
                Out::Line(l) => Some(l),
                Out::Allow(_) => None,
            })
            .collect()
    }

    #[test]
    fn turns_a_turn_into_claude_lines() {
        let mut s = Session::new("ses_1".into(), "/r".into(), "default".into());
        let ev = |t: &str, p: Value| json!({ "type": t, "properties": p });
        s.translate(&ev("message.updated", json!({ "info": { "id": "u1", "role": "user" } })));
        // Your own message's text isn't Claude's.
        assert!(s
            .translate(&ev(
                "message.part.updated",
                json!({ "part": { "id": "p0", "messageID": "u1", "type": "text", "text": "hi" } })
            ))
            .is_empty());
        s.translate(&ev("session.status", json!({ "status": { "type": "busy" } })));
        s.translate(&ev("message.updated", json!({ "info": { "id": "m1", "role": "assistant" } })));
        let start = lines(s.translate(&ev("message.part.updated", json!({ "part": { "id": "t1", "messageID": "m1", "type": "tool", "tool": "bash", "callID": "c1", "state": { "status": "pending", "input": {} } } }))));
        assert_eq!(start[0]["event"]["type"], "message_start");
        assert_eq!(start[1]["event"]["content_block"]["name"], "Bash");
        let running = lines(s.translate(&ev("message.part.updated", json!({ "part": { "id": "t1", "messageID": "m1", "type": "tool", "tool": "bash", "callID": "c1", "state": { "status": "running", "input": { "command": "ls" } } } }))));
        assert_eq!(running[0]["message"]["content"][0]["input"]["command"], "ls");
        let done = lines(s.translate(&ev("message.part.updated", json!({ "part": { "id": "t1", "messageID": "m1", "type": "tool", "tool": "bash", "callID": "c1", "state": { "status": "completed", "input": { "command": "ls" }, "output": "a.txt" } } }))));
        assert_eq!(done[0]["message"]["content"][0]["content"], "a.txt");
        let text = lines(s.translate(&ev(
            "message.part.delta",
            json!({ "messageID": "m1", "partID": "x1", "field": "text", "delta": "do" }),
        )));
        assert_eq!(text.last().unwrap()["event"]["delta"]["text"], "do");
        // The whole text after deltas passes on only what's new.
        let rest = lines(s.translate(&ev(
            "message.part.updated",
            json!({ "part": { "id": "x1", "messageID": "m1", "type": "text", "text": "done" } }),
        )));
        assert_eq!(rest[0]["event"]["delta"]["text"], "ne");
        let finished = lines(s.translate(&ev("message.updated", json!({ "info": { "id": "m1", "role": "assistant", "cost": 0.5, "tokens": { "input": 10, "output": 3, "cache": { "write": 2 } }, "time": { "completed": 1 } } }))));
        assert_eq!(finished[0]["message"]["content"][1]["text"], "done");
        let result = lines(s.translate(&ev("session.idle", json!({}))));
        assert_eq!(result[0]["type"], "result");
        assert_eq!(result[0]["total_cost_usd"], 0.5);
        assert_eq!(result[0]["usage"]["input_tokens"], 12);
        // Once per turn.
        assert!(s.translate(&ev("session.status", json!({ "status": { "type": "idle" } }))).is_empty());
    }

    #[test]
    fn answers_what_the_mode_lets_through() {
        let ask = |mode: &str, permission: &str| {
            let mut s = Session::new("ses_1".into(), "/r".into(), mode.into());
            s.translate(
                &json!({ "type": "permission.asked", "properties": { "id": "per_1", "permission": permission, "metadata": { "command": "ls" } } }),
            )
        };
        assert_eq!(ask("auto", "bash"), vec![Out::Allow("per_1".into())]);
        assert_eq!(ask("acceptEdits", "edit"), vec![Out::Allow("per_1".into())]);
        let asked = lines(ask("acceptEdits", "bash"));
        assert_eq!(asked[0]["type"], "control_request");
        assert_eq!(asked[0]["request"]["tool_name"], "Bash");
        assert!(matches!(ask("auto", "external_directory")[0], Out::Line(_)));
    }

    #[test]
    fn names_tools_and_their_fields_as_claude_does() {
        assert_eq!(tool_name("webfetch"), "WebFetch");
        assert_eq!(
            tool_input(&json!({ "filePath": "a", "oldString": "b" })),
            json!({ "file_path": "a", "old_string": "b" })
        );
        assert!(session_ok("ses_e912fb285ffe98rpBZZgZrXqvi") && !session_ok("../x") && !session_ok("ses_a/b"));
        assert_eq!(encode("/Users/me/my repo&x"), "/Users/me/my%20repo%26x");
    }
}
