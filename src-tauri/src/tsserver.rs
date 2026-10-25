//! Types for the editor: the repository's own TypeScript language service, `tsserver` (what VS Code uses), run with
//! Node in the background, one per repository, while a TypeScript or JavaScript file's being edited in it. The editor
//! asks it about the code (types on hover, completions, definitions) and it reports each file's errors as they change.
//! Its own TypeScript, so the answers match the repository's build and `tsconfig.json`.
//!
//! tsserver takes a request per line (`{"seq","type":"request","command","arguments"}`) and answers with
//! `Content-Length`-framed JSON: a `response` to a request (by `request_seq`), or an `event`, such as a file's
//! diagnostics. Responses go back to whoever asked; diagnostics go to the editor as the `ts:diag` event.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

struct Server {
    stdin: ChildStdin,
    child: Child,
    seq: u64,
    /// Who's waiting for each request's response.
    waiting: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
}

#[derive(Default)]
pub struct TsServers {
    servers: Mutex<HashMap<String, Server>>,
}

impl TsServers {
    pub fn stop_all(&self) {
        for (_, s) in self.servers.lock().unwrap().drain() {
            crate::claude::end(s.child);
        }
    }
}

/// What the editor may ask: these answer; the file-keeping ones (`open`, `change`, `close`, `geterr`) answer only
/// with events, or not at all.
const ASKS: &[&str] = &[
    "quickinfo",
    "completionInfo",
    "completionEntryDetails",
    "definition",
    "signatureHelp",
    "navto",
];
const TELLS: &[&str] = &["open", "change", "close", "geterr"];

/// Compiler options for files no tsconfig.json covers: what a Vite or other bundled project builds with.
fn inferred_options() -> Value {
    json!({
        "module": "ESNext",
        "moduleResolution": "Bundler",
        "target": "ES2022",
        "jsx": "preserve",
        "allowJs": true,
        "resolveJsonModule": true,
        "esModuleInterop": true,
        "allowSyntheticDefaultImports": true,
        "allowImportingTsExtensions": true,
        "noEmit": true,
        "skipLibCheck": true,
        "strict": true,
    })
}

/// The tsserver a repository has: in its `node_modules`, or a parent folder's (a package in a monorepo).
fn find_tsserver(repo: &str) -> Option<PathBuf> {
    Path::new(repo)
        .ancestors()
        .take(6)
        .map(|dir| dir.join("node_modules/typescript/lib/tsserver.js"))
        .find(|p| p.is_file())
}

/// Reads tsserver's `Content-Length`-framed messages, passing each response to whoever's waiting and each file's
/// diagnostics to the editor, until it ends.
fn read_messages<R: Runtime>(app: AppHandle<R>, repo: String, stdout: impl Read, waiting: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Some(len) = line.strip_prefix("Content-Length:").and_then(|n| n.trim().parse::<usize>().ok()) else {
            continue;
        };
        // The blank line after the header, then the body.
        line.clear();
        let _ = reader.read_line(&mut line);
        let mut body = vec![0; len];
        if reader.read_exact(&mut body).is_err() {
            break;
        }
        let Ok(msg) = serde_json::from_slice::<Value>(&body) else { continue };
        match msg["type"].as_str() {
            Some("response") => {
                if let Some(to) = msg["request_seq"].as_u64().and_then(|seq| waiting.lock().unwrap().remove(&seq)) {
                    let _ = to.send(msg);
                }
            }
            Some("event") if matches!(msg["event"].as_str(), Some("syntaxDiag" | "semanticDiag")) => {
                let _ = app.emit(
                    "ts:diag",
                    json!({ "repo": repo, "kind": msg["event"], "file": msg["body"]["file"], "diagnostics": msg["body"]["diagnostics"] }),
                );
            }
            _ => {}
        }
    }
    // Gone: nothing's coming for whoever's still waiting, and the next request starts it again.
    waiting.lock().unwrap().clear();
    if let Some(s) = app.state::<TsServers>().servers.lock().unwrap().remove(&repo) {
        crate::claude::end(s.child);
    }
}

fn start<R: Runtime>(app: &AppHandle<R>, repo: &str) -> Result<Server, String> {
    let tsserver = find_tsserver(repo).ok_or("No TypeScript in this repository (node_modules/typescript)")?;
    let home = std::env::var("HOME").unwrap_or_default();
    let path = std::env::var("PATH").unwrap_or_default();
    let mut child = Command::new("node")
        .arg(tsserver)
        .args(["--disableAutomaticTypingAcquisition", "--locale", "en"])
        .current_dir(repo)
        // Apps opened from Finder get a short PATH: where Node usually is.
        .env(
            "PATH",
            format!("{path}:{home}/.vite-plus/bin:{home}/.volta/bin:/opt/homebrew/bin:/usr/local/bin"),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Node isn't installed, so TypeScript can't run".to_string()
            } else {
                e.to_string()
            }
        })?;
    let stdout = child.stdout.take().ok_or("No output from tsserver")?;
    let mut stdin = child.stdin.take().ok_or("No input to tsserver")?;
    // A file no tsconfig.json covers (a root vite.config.ts, say) gets today's defaults, as bundled projects build,
    // rather than TypeScript's old ones, which can't follow a package's `exports`.
    let inferred =
        json!({ "seq": 1, "type": "request", "command": "compilerOptionsForInferredProjects", "arguments": { "options": inferred_options() } });
    writeln!(stdin, "{inferred}").and_then(|_| stdin.flush()).map_err(|e| e.to_string())?;
    let waiting = Arc::new(Mutex::new(HashMap::new()));
    let (app, repo_owned, w) = (app.clone(), repo.to_string(), waiting.clone());
    std::thread::spawn(move || read_messages(app, repo_owned, stdout, w));
    Ok(Server {
        stdin,
        child,
        seq: 1,
        waiting,
    })
}

/// Whether every file a request names (its `file`, and any `files`) is in the repository.
fn files_inside(repo: &str, arguments: &Value) -> bool {
    let inside = |f: &Value| f.as_str().is_some_and(|f| f.starts_with(&format!("{repo}/")) && !f.contains("/../"));
    let file = &arguments["file"];
    (file.is_null() || inside(file)) && arguments["files"].as_array().is_none_or(|files| files.iter().all(inside))
}

/// Sends a request, starting the repository's tsserver if need be. Returns where its response will arrive, for
/// requests that answer.
type Waiting = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

fn send<R: Runtime>(
    app: &AppHandle<R>,
    repo: &str,
    command: &str,
    arguments: Value,
    answers: bool,
) -> Result<Option<(mpsc::Receiver<Value>, u64, Waiting)>, String> {
    let ts = app.state::<TsServers>();
    let mut servers = ts.servers.lock().unwrap();
    if !servers.contains_key(repo) {
        let s = start(app, repo)?;
        servers.insert(repo.to_string(), s);
    }
    let s = servers.get_mut(repo).unwrap();
    s.seq += 1;
    let seq = s.seq;
    let rx = answers.then(|| {
        let (tx, rx) = mpsc::channel();
        s.waiting.lock().unwrap().insert(seq, tx);
        (rx, seq, s.waiting.clone())
    });
    let line = json!({ "seq": seq, "type": "request", "command": command, "arguments": arguments });
    if writeln!(s.stdin, "{line}").and_then(|_| s.stdin.flush()).is_err() {
        // It's gone; the next request starts another.
        let gone = servers.remove(repo).unwrap();
        crate::claude::end(gone.child);
        return Err("TypeScript stopped".into());
    }
    Ok(rx)
}

/// Asks a repository's TypeScript something about its code, or tells it about a file (opened, changed, closed, or to
/// be checked). Answers with the response's body, or null for what doesn't answer.
#[tauri::command]
pub async fn ts_request<R: Runtime>(app: AppHandle<R>, repo: String, command: String, arguments: Value) -> Result<Value, String> {
    let answers = ASKS.contains(&command.as_str());
    if !answers && !TELLS.contains(&command.as_str()) {
        return Err(format!("Not something to ask TypeScript: {command}"));
    }
    if !files_inside(&repo, &arguments) {
        return Err("That file isn't in the repository".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some((rx, seq, waiting)) = send(&app, &repo, &command, arguments, answers)? else {
            return Ok(Value::Null);
        };
        // The first answer can wait on the project loading. Not answered in time, it's let go of.
        let Ok(msg) = rx.recv_timeout(Duration::from_secs(30)) else {
            waiting.lock().unwrap().remove(&seq);
            return Err("TypeScript didn't answer".to_string());
        };
        if msg["success"] == true {
            Ok(msg["body"].clone())
        } else {
            Err(msg["message"].as_str().unwrap_or("TypeScript couldn't answer").to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a repository's tsserver: its tab's closed or asleep, and it uses a fair bit of memory.
#[tauri::command]
pub fn ts_stop<R: Runtime>(app: AppHandle<R>, repo: String) {
    if let Some(s) = app.state::<TsServers>().servers.lock().unwrap().remove(&repo) {
        crate::claude::end(s.child);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_repositorys_typescript() {
        let repo = env!("CARGO_MANIFEST_DIR").trim_end_matches("/src-tauri").to_string();
        // This repository has it; a folder within it finds it a level or two up, as a monorepo's packages do.
        assert!(find_tsserver(&repo).is_some_and(|p| p.ends_with("typescript/lib/tsserver.js")));
        assert!(find_tsserver(&format!("{repo}/src-tauri/src")).is_some());
        assert!(find_tsserver("/").is_none());
    }

    #[test]
    fn gives_loose_files_todays_module_resolution() {
        // A package's `exports` (as `@scope/kit/vite/shared` needs) only resolve under bundler or node16 resolution.
        assert_eq!(inferred_options()["moduleResolution"], "Bundler");
        assert_eq!(inferred_options()["module"], "ESNext");
    }

    #[test]
    fn keeps_to_the_repositorys_files() {
        assert!(files_inside("/r", &json!({ "file": "/r/src/a.ts", "line": 1 })));
        assert!(files_inside("/r", &json!({ "files": ["/r/a.ts", "/r/b.ts"] })));
        assert!(!files_inside("/r", &json!({ "file": "/etc/passwd" })));
        assert!(!files_inside("/r", &json!({ "file": "/r/../etc/passwd" })));
        assert!(!files_inside("/r", &json!({ "files": ["/r/a.ts", 3] })));
        assert!(!files_inside("/r", &json!({ "file": "/rx/a.ts" })));
    }
}
