//! Claude Code conversations, any number per repository (one per panel tab): runs `claude` headless in the repository
//! and keeps each conversation here, by the tab's id, so the panel in the main window and a popped-out window can both
//! show it. A view subscribes and gets what's been said so far, then each
//! line as it comes; sending, answering, stopping and clearing come back through here. It also tells you (a macOS
//! notification) when Claude wants you and no Acantha window is in front.
//!
//! The lines are Claude Code's own (`--output-format stream-json`), plus a few of Acantha's (`"type":"acantha_…"`) for
//! what happened from this side: a message sent, a request answered, a stop, a clear, the process ending.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_notification::NotificationExt;

struct Run {
    stdin: ChildStdin,
    child: Child,
    /// Which process this is, so one that's been replaced doesn't end the next one's session.
    gen: u64,
}

#[derive(Default)]
struct Conversation {
    /// Everything said, to bring a new view up to date. Text deltas are left out: the whole messages that follow them
    /// carry the same text.
    log: Vec<String>,
    views: Vec<(u32, Channel<String>)>,
    run: Option<Run>,
    session_id: Option<String>,
    /// What it's doing, for the list of conversations a popped-out window switches between.
    status: Status,
}

#[derive(Default, Clone, Copy, PartialEq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Idle,
    Working,
    /// Asking permission.
    Waiting,
}

impl Status {
    /// What a line says Claude's doing now, if it changes it.
    fn after(line: &str) -> Option<Status> {
        let is = |t: &str| line.contains(&format!(r#""type":"{t}""#));
        if is("acantha_user") || is("acantha_answered") {
            Some(Status::Working)
        } else if is("control_request") {
            Some(Status::Waiting)
        } else if ["result", "acantha_stopped", "acantha_exit", "acantha_interrupted", "acantha_cleared"]
            .into_iter()
            .any(is)
        {
            Some(Status::Idle)
        } else {
            None
        }
    }
}

#[derive(Default)]
pub struct Claudes {
    conversations: Mutex<HashMap<String, Conversation>>,
    next: Mutex<u64>,
}

impl Claudes {
    pub fn kill_all(&self) {
        for c in self.conversations.lock().unwrap().values_mut() {
            if let Some(mut r) = c.run.take() {
                let _ = r.child.kill();
            }
        }
    }

    fn next(&self) -> u64 {
        let mut n = self.next.lock().unwrap();
        *n += 1;
        *n
    }
}

/// Past this many lines the oldest go, so a long conversation can't grow without end.
const LOG_MAX: usize = 4000;

/// Passes a line to every view of a conversation, and keeps it for views to come.
fn broadcast(c: &mut Conversation, line: String) {
    let delta = line.contains(r#""type":"stream_event""#);
    c.views.retain(|(_, ch)| ch.send(line.clone()).is_ok());
    if !delta {
        if let Some(status) = Status::after(&line) {
            c.status = status;
        }
        c.log.push(line);
        if c.log.len() > LOG_MAX {
            c.log.drain(..c.log.len() - LOG_MAX);
        }
    }
}

/// A macOS notification, unless one of Acantha's windows is in front.
fn notify<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    if app.webview_windows().values().any(|w| w.is_focused().unwrap_or(false)) {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

/// The permission modes offered: Claude Code's auto mode (it judges what's safe to do without asking), read only, ask
/// before anything, or edit files without asking.
const MODES: &[&str] = &["auto", "plan", "default", "acceptEdits"];

/// A session id to resume: a UUID, so nothing else reaches the command line.
fn session_id_ok(id: &str) -> bool {
    id.len() <= 64 && id.bytes().next().is_some_and(|b| b.is_ascii_hexdigit()) && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

/// A model alias or name, starting with a letter or digit so it can't read as another option.
fn model_ok(model: &str) -> bool {
    model.len() <= 64
        && model.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && model.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._[]".contains(&b))
}

/// The arguments for a headless session: messages in and out as JSON lines, text as it's written, and every
/// permission question sent here (`--permission-prompt-tool stdio`) rather than refused.
fn args(mode: &str, resume: Option<&str>, model: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompts",
        "host",
        "--permission-prompt-tool",
        "stdio",
        "--permission-mode",
        mode,
    ]
    .map(String::from)
    .to_vec();
    if let Some(id) = resume {
        a.extend(["--resume".into(), id.into()]);
    }
    if let Some(m) = model {
        a.extend(["--model".into(), m.into()]);
    }
    a
}

/// What a permission request is about, for its notification: the command, the file, or the tool.
fn asking(request: &Value) -> String {
    let input = &request["input"];
    input["command"]
        .as_str()
        .or_else(|| input["file_path"].as_str())
        .map(String::from)
        .unwrap_or_else(|| request["display_name"].as_str().unwrap_or("a tool").to_string())
}

/// Starts `claude` for a conversation (`id`), in `repo`, reading what it says on its own thread.
fn spawn<R: Runtime>(app: &AppHandle<R>, id: &str, repo: &str, mode: &str, model: Option<&str>, resume: Option<&str>) -> Result<Run, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = std::env::var("PATH").unwrap_or_default();
    let mut child = Command::new("claude")
        .args(args(mode, resume, model))
        .current_dir(repo)
        // Apps opened from Finder get a short PATH; Claude Code usually lives in ~/.local/bin.
        .env("PATH", format!("{path}:{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Claude Code isn't installed: see claude.com/claude-code".to_string()
            } else {
                e.to_string()
            }
        })?;
    let stdout = child.stdout.take().ok_or("No output from claude")?;
    let mut stderr = child.stderr.take().ok_or("No errors from claude")?;
    let stdin = child.stdin.take().ok_or("No input to claude")?;
    let gen = app.state::<Claudes>().next();
    let name = repo.rsplit('/').next().unwrap_or(repo).to_string();

    // Errors are read alongside, so a chatty stderr can't block the process.
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let app = app.clone();
    let id = id.to_string();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let event: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
            match event["type"].as_str() {
                Some("control_request") if event["request"]["subtype"] == "can_use_tool" => {
                    notify(&app, &format!("Claude is waiting for you in {name}"), &asking(&event["request"]))
                }
                Some("result") if event["is_error"] != true => notify(&app, &format!("Claude is done in {name}"), "Its reply is waiting."),
                _ => {}
            }
            let claudes = app.state::<Claudes>();
            let mut all = claudes.conversations.lock().unwrap();
            // Closed meanwhile: nothing to keep it for.
            let Some(c) = all.get_mut(&id) else { continue };
            if let Some(session) = event["session_id"].as_str() {
                c.session_id = Some(session.to_string());
            }
            broadcast(c, line);
        }
        let stderr = errors.join().unwrap_or_default();
        let tail: String = stderr.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
        let claudes = app.state::<Claudes>();
        let mut all = claudes.conversations.lock().unwrap();
        let Some(c) = all.get_mut(&id) else { return };
        // A process stopped or replaced on purpose has already been accounted for.
        if c.run.as_ref().is_some_and(|r| r.gen == gen) {
            c.run = None;
            broadcast(c, json!({ "type": "acantha_exit", "stderr": tail.trim() }).to_string());
        }
    });
    Ok(Run { stdin, child, gen })
}

/// Where Claude Code keeps a session's transcript: `~/.claude/projects/<the folder, encoded>/<session>.jsonl`. Session
/// ids are unique, so the folder needn't be worked out: it's whichever has the file.
fn transcript(session: &str) -> Option<std::path::PathBuf> {
    let projects = std::path::PathBuf::from(std::env::var("HOME").ok()?).join(".claude/projects");
    std::fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|d| d.path().join(format!("{session}.jsonl")))
        .find(|p| p.is_file())
}

/// A transcript's lines, as the ones a running session prints: Claude's messages as they are, the results of its tools,
/// and what you said as Acantha's own lines. The rest (Claude Code's bookkeeping, commands' output) is left out.
fn history(transcript: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for line in transcript.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["isMeta"] == true || v["isSidechain"] == true {
            continue;
        }
        match (v["type"].as_str(), &v["message"]["content"]) {
            (Some("assistant"), _) => lines.push(json!({ "type": "assistant", "message": v["message"] }).to_string()),
            (Some("user"), Value::String(text)) if !text.starts_with('<') => lines.push(json!({ "type": "acantha_user", "text": text }).to_string()),
            (Some("user"), Value::Array(blocks)) => {
                let text: Vec<&str> = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
                if text.first().is_some_and(|t| t.starts_with("[Request interrupted")) {
                    lines.push(json!({ "type": "acantha_interrupted" }).to_string());
                } else if blocks.iter().any(|b| b["type"] == "tool_result") {
                    lines.push(json!({ "type": "user", "message": v["message"] }).to_string());
                } else if !text.is_empty() && !text[0].starts_with('<') {
                    lines.push(json!({ "type": "acantha_user", "text": text.join("\n") }).to_string());
                }
            }
            _ => {}
        }
    }
    // Shown, not working: the last message sent hasn't an answer running.
    lines.push(json!({ "type": "acantha_stopped" }).to_string());
    if lines.len() > LOG_MAX {
        lines.drain(..lines.len() - LOG_MAX);
    }
    lines
}

/// Shows a conversation (`id`): what's been said so far, then everything as it happens. One that's new here, with a
/// saved session to carry on (`resume`), starts with that session's history. Returns an id to stop with.
#[tauri::command]
pub fn claude_subscribe(state: State<'_, Claudes>, id: String, resume: Option<String>, on_event: Channel<String>) -> u32 {
    let view = state.next() as u32;
    let mut all = state.conversations.lock().unwrap();
    let c = all.entry(id).or_default();
    if c.log.is_empty() && c.run.is_none() && c.session_id.is_none() {
        if let Some(session) = resume.filter(|s| session_id_ok(s)) {
            if let Some(text) = transcript(&session).and_then(|p| std::fs::read_to_string(p).ok()) {
                c.log = history(&text);
            }
            c.session_id = Some(session);
        }
    }
    for line in &c.log {
        let _ = on_event.send(line.clone());
    }
    c.views.push((view, on_event));
    view
}

#[tauri::command]
pub fn claude_unsubscribe(state: State<'_, Claudes>, id: String, view: u32) {
    if let Some(c) = state.conversations.lock().unwrap().get_mut(&id) {
        c.views.retain(|(v, _)| *v != view);
    }
}

/// What each conversation running here is doing, by id: for a popped-out window's list to switch between.
#[tauri::command]
pub fn claude_statuses(state: State<'_, Claudes>) -> HashMap<String, Status> {
    state.conversations.lock().unwrap().iter().map(|(id, c)| (id.clone(), c.status)).collect()
}

/// Lets a conversation go here, stopping Claude: another's being picked up in its place. Claude Code keeps the
/// session, so it can be picked up again.
#[tauri::command]
pub fn claude_reset(state: State<'_, Claudes>, id: String) {
    if let Some(mut c) = state.conversations.lock().unwrap().remove(&id) {
        if let Some(mut run) = c.run.take() {
            let _ = run.child.kill();
        }
    }
}

/// Ends a conversation: its tab's closed. Its window, if it's popped out, closes too.
#[tauri::command]
pub fn claude_close<R: Runtime>(app: AppHandle<R>, state: State<'_, Claudes>, id: String) {
    claude_reset(state, id.clone());
    if let Some(w) = app.get_webview_window(&format!("claude-{id}")) {
        let _ = w.close();
    }
}

/// Interrupts what Claude's doing, as Esc does in the terminal: the reply stops, and Claude waits for the next message,
/// remembering everything so far.
#[tauri::command]
pub fn claude_interrupt(state: State<'_, Claudes>, id: String) -> Result<(), String> {
    let mut all = state.conversations.lock().unwrap();
    let Some(run) = all.get_mut(&id).and_then(|c| c.run.as_mut()) else {
        return Ok(());
    };
    let line = json!({ "type": "control_request", "request_id": format!("acantha-interrupt-{}", run.gen), "request": { "subtype": "interrupt" } });
    writeln!(run.stdin, "{line}").and_then(|_| run.stdin.flush()).map_err(|e| e.to_string())?;
    if let Some(c) = all.get_mut(&id) {
        broadcast(c, json!({ "type": "acantha_interrupted" }).to_string());
    }
    Ok(())
}

/// Sends Claude a message, starting it (resuming its session, if it has one) if it isn't running.
#[tauri::command]
pub fn claude_send<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Claudes>,
    id: String,
    repo: String,
    text: String,
    mode: String,
    model: Option<String>,
) -> Result<(), String> {
    if !MODES.contains(&mode.as_str()) {
        return Err(format!("Unknown permission mode {mode}"));
    }
    let model = model.filter(|m| !m.is_empty());
    if model.as_deref().is_some_and(|m| !model_ok(m)) {
        return Err("That isn't a model name".into());
    }
    let mut all = state.conversations.lock().unwrap();
    let c = all.entry(id.clone()).or_default();
    if c.run.is_none() {
        let resume = c.session_id.clone().filter(|s| session_id_ok(s));
        c.run = Some(spawn(&app, &id, &repo, &mode, model.as_deref(), resume.as_deref())?);
    }
    let line = json!({ "type": "user", "message": { "role": "user", "content": text } }).to_string();
    let run = c.run.as_mut().ok_or("Claude isn't running")?;
    writeln!(run.stdin, "{line}").and_then(|_| run.stdin.flush()).map_err(|e| e.to_string())?;
    broadcast(c, json!({ "type": "acantha_user", "text": text }).to_string());
    Ok(())
}

/// Answers a permission request: allowed as asked, or denied.
#[tauri::command]
pub fn claude_answer(state: State<'_, Claudes>, id: String, request_id: String, allow: bool, input: Value) -> Result<(), String> {
    let mut all = state.conversations.lock().unwrap();
    let c = all.get_mut(&id).ok_or("No conversation")?;
    let response = if allow {
        json!({ "behavior": "allow", "updatedInput": input })
    } else {
        json!({ "behavior": "deny", "message": "The user denied this in Acantha." })
    };
    let line = json!({ "type": "control_response", "response": { "subtype": "success", "request_id": request_id, "response": response } });
    let run = c.run.as_mut().ok_or("Claude has stopped")?;
    writeln!(run.stdin, "{line}").and_then(|_| run.stdin.flush()).map_err(|e| e.to_string())?;
    broadcast(
        c,
        json!({ "type": "acantha_answered", "request_id": request_id, "allow": allow }).to_string(),
    );
    Ok(())
}

/// Lets Claude go between messages, for a new mode or model: the next message starts it again, carrying on.
#[tauri::command]
pub fn claude_stop(state: State<'_, Claudes>, id: String) {
    let mut all = state.conversations.lock().unwrap();
    let Some(c) = all.get_mut(&id) else { return };
    if let Some(mut run) = c.run.take() {
        let _ = run.child.kill();
        let _ = run.child.wait();
        broadcast(c, json!({ "type": "acantha_stopped" }).to_string());
    }
}

/// Starts the conversation afresh.
#[tauri::command]
pub fn claude_clear(state: State<'_, Claudes>, id: String) {
    let mut all = state.conversations.lock().unwrap();
    let Some(c) = all.get_mut(&id) else { return };
    if let Some(mut run) = c.run.take() {
        let _ = run.child.kill();
    }
    c.log.clear();
    c.session_id = None;
    broadcast(c, json!({ "type": "acantha_cleared" }).to_string());
}

/// Shows a window on every Space, a full-screen app's included (`on`), or only its own. macOS needs it marked a
/// full-screen auxiliary for that, which Tauri's own "visible on all workspaces" doesn't do. Main thread only.
#[cfg(target_os = "macos")]
fn everywhere(ns: &objc2_app_kit::NSWindow, on: bool) {
    use objc2_app_kit::NSWindowCollectionBehavior as B;
    let all = B::CanJoinAllSpaces | B::FullScreenAuxiliary;
    let current = ns.collectionBehavior();
    ns.setCollectionBehavior(if on { current | all } else { current & !all });
}

/// A window's AppKit window, to use on the main thread.
#[cfg(target_os = "macos")]
fn ns_window<R: Runtime>(w: &tauri::WebviewWindow<R>) -> Result<usize, String> {
    w.ns_window().map(|p| p as usize).map_err(|e| e.to_string())
}

/// Pins the window it's called from (a popped-out Claude window) or lets it go. Pinned, it floats above other apps and
/// shows on every Space, a full-screen window's too.
#[tauri::command]
pub fn claude_window_pin<R: Runtime>(window: tauri::WebviewWindow<R>, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let ptr = ns_window(&window)?;
        window
            .run_on_main_thread(move || {
                // SAFETY: the pointer is the live NSWindow of this webview window, used on the main thread.
                everywhere(unsafe { &*(ptr as *const objc2_app_kit::NSWindow) }, on);
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The screen dimmed behind popped-out Claude windows: a plain AppKit window each (by Claude's window's label), black
/// and see-through, that clicks go through, kept for when it's next wanted. AppKit's, so all on the main thread.
#[cfg(target_os = "macos")]
mod dim {
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSAnimatablePropertyContainer, NSBackingStoreType, NSColor, NSWindow, NSWindowCollectionBehavior as B, NSWindowOrderingMode,
        NSWindowStyleMask,
    };
    use std::cell::RefCell;
    use std::collections::HashMap;

    thread_local! {
        static DIMS: RefCell<HashMap<String, Retained<NSWindow>>> = RefCell::default();
    }

    /// Dims the screen `claude` is on to `amount` (0 to 1), fading, just below it and on its level.
    pub fn show(label: &str, claude: &NSWindow, amount: f64) {
        let (Some(mtm), Some(screen)) = (MainThreadMarker::new(), claude.screen()) else {
            return;
        };
        let frame = screen.frame();
        DIMS.with_borrow_mut(|dims| {
            let w = dims.entry(label.to_string()).or_insert_with(|| {
                // SAFETY: a new borderless window, kept here rather than released when it's closed.
                let w = unsafe {
                    NSWindow::initWithContentRect_styleMask_backing_defer(
                        mtm.alloc(),
                        frame,
                        NSWindowStyleMask::Borderless,
                        NSBackingStoreType::Buffered,
                        false,
                    )
                };
                unsafe { w.setReleasedWhenClosed(false) };
                w.setOpaque(false);
                w.setHasShadow(false);
                w.setBackgroundColor(Some(&NSColor::blackColor()));
                w.setIgnoresMouseEvents(true);
                w.setAlphaValue(0.0);
                // On every Space, full-screen ones too, and left out of Mission Control and window cycling.
                w.setCollectionBehavior(B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::Transient | B::IgnoresCycle);
                w
            });
            w.setFrame_display(frame, false);
            w.setLevel(claude.level());
            w.orderWindow_relativeTo(NSWindowOrderingMode::Below, claude.windowNumber());
            w.animator().setAlphaValue(amount);
        });
    }

    /// Lifts it, fading out.
    pub fn hide(label: &str) {
        DIMS.with_borrow(|dims| {
            if let Some(w) = dims.get(label) {
                w.animator().setAlphaValue(0.0);
            }
        });
    }

    /// Once it's faded, takes it off the screen, unless it's been dimmed again meanwhile.
    pub fn put_away(label: &str) {
        DIMS.with_borrow(|dims| {
            if let Some(w) = dims.get(label).filter(|w| w.alphaValue() == 0.0) {
                w.orderOut(None);
            }
        });
    }

    /// Its Claude window's gone.
    pub fn remove(label: &str) {
        if let Some(w) = DIMS.with_borrow_mut(|dims| dims.remove(label)) {
            w.orderOut(None);
            w.close();
        }
    }
}

/// Dims the screen behind the popped-out Claude window it's called from (`on`, to `amount`, 0 to 1), so it's easier to
/// read, or lifts it. Clicks go straight through to what's underneath.
#[tauri::command]
pub fn claude_dim<R: Runtime>(window: tauri::WebviewWindow<R>, on: bool, amount: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let label = window.label().to_string();
        let ptr = ns_window(&window)?;
        let amount = amount.clamp(0.0, 0.9);
        let shown = label.clone();
        window
            .run_on_main_thread(move || {
                if on {
                    // SAFETY: the pointer is the live NSWindow of this webview window, used on the main thread.
                    dim::show(&shown, unsafe { &*(ptr as *const objc2_app_kit::NSWindow) }, amount);
                } else {
                    dim::hide(&shown);
                }
            })
            .map_err(|e| e.to_string())?;
        if !on {
            let app = window.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(400));
                let _ = app.run_on_main_thread(move || dim::put_away(&label));
            });
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, on, amount);
    Ok(())
}

/// A popped-out Claude window's closed: its dimming goes too.
pub fn undim_closed<R: Runtime>(app: &AppHandle<R>, label: &str) {
    #[cfg(target_os = "macos")]
    {
        let label = label.to_string();
        let _ = app.run_on_main_thread(move || dim::remove(&label));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, label);
}

/// Deletes a session Claude Code keeps (its transcript, and the folder beside it), once you're done with it.
#[tauri::command]
pub fn claude_delete_session(session: String) -> Result<(), String> {
    if !session_id_ok(&session) {
        return Err("That isn't a session".into());
    }
    if let Some(path) = transcript(&session) {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(path.with_extension(""));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_odd_values_off_the_command_line() {
        assert!(session_id_ok("2fce6713-989f-450b-9cee-bcb7f598beb6"));
        assert!(!session_id_ok("--dangerously-skip-permissions"));
        assert!(!session_id_ok(""));
        assert!(model_ok("sonnet") && model_ok("claude-opus-5-5") && model_ok("opus[1m]"));
        assert!(!model_ok("x; rm -rf /") && !model_ok("--flag"));
        let a = args("plan", Some("abc-123"), Some("haiku"));
        assert!(a.windows(2).any(|w| w == ["--permission-mode", "plan"]));
        assert!(a.windows(2).any(|w| w == ["--resume", "abc-123"]));
        assert!(a.windows(2).any(|w| w == ["--permission-prompt-tool", "stdio"]));
    }

    #[test]
    fn keeps_whole_messages_but_not_text_deltas() {
        let mut c = Conversation::default();
        broadcast(&mut c, r#"{"type":"stream_event","event":{}}"#.into());
        broadcast(&mut c, r#"{"type":"assistant","message":{}}"#.into());
        assert_eq!(c.log.len(), 1);
        assert!(c.log[0].contains("assistant"));
    }

    #[test]
    fn reads_a_transcript_back_as_lines() {
        let t = [
            r#"{"type":"user","message":{"role":"user","content":"hello"}}"#,
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"caveat"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hi"}]}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}"#,
            r#"{"type":"summary","summary":"x"}"#,
        ]
        .join("\n");
        let lines = history(&t);
        assert_eq!(lines.len(), 5);
        assert!(lines[0].contains("acantha_user") && lines[0].contains("hello"));
        assert!(lines[1].contains(r#""type":"assistant""#));
        assert!(lines[2].contains("tool_result"));
        assert!(lines[3].contains("acantha_interrupted"));
        assert!(lines[4].contains("acantha_stopped"));
    }

    #[test]
    fn follows_what_claude_is_doing() {
        let mut c = Conversation::default();
        broadcast(&mut c, json!({ "type": "acantha_user", "text": "hi" }).to_string());
        assert_eq!(c.status, Status::Working);
        broadcast(&mut c, r#"{"type":"control_request","request":{"subtype":"can_use_tool"}}"#.into());
        assert_eq!(c.status, Status::Waiting);
        broadcast(&mut c, json!({ "type": "acantha_answered" }).to_string());
        // A tool's result isn't the turn's.
        broadcast(&mut c, r#"{"type":"user","message":{"content":[{"type":"tool_result"}]}}"#.into());
        assert_eq!(c.status, Status::Working);
        broadcast(&mut c, r#"{"type":"result","subtype":"success"}"#.into());
        assert_eq!(c.status, Status::Idle);
    }

    #[test]
    fn says_what_a_request_is_about() {
        assert_eq!(asking(&json!({ "input": { "command": "npm test" } })), "npm test");
        assert_eq!(asking(&json!({ "input": { "file_path": "/r/x.ts" } })), "/r/x.ts");
        assert_eq!(asking(&json!({ "display_name": "WebFetch", "input": {} })), "WebFetch");
    }
}
