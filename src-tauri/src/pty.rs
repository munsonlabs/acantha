use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// The shell's process, to tell it apart from a program running in it.
    shell_pid: Option<u32>,
}

#[derive(Default)]
pub struct Ptys {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

impl Ptys {
    pub fn kill_all(&self) {
        for (_, mut s) in self.sessions.lock().unwrap().drain() {
            let _ = s.killer.kill();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: Option<u32> },
}

/// Length of the longest prefix that is complete UTF-8, so a character split across reads isn't mangled.
fn utf8_boundary(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        // An incomplete sequence at the end: hold it back for the next read.
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        // Genuinely invalid bytes: let them through and have them replaced.
        Err(_) => bytes.len(),
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[derive(Serialize)]
pub struct Spawned {
    id: u32,
    shell: String,
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, Ptys>,
    cwd: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<Spawned, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;

    // A shell chosen in settings wins over the login shell.
    let shell = shell
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()));
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Acantha");
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The parent must not hold the slave open, or the reader never sees EOF when the shell exits.
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let shell_pid = child.process_id();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().unwrap().insert(
        id,
        Session {
            master: pair.master,
            writer,
            killer,
            shell_pid,
        },
    );

    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let end = utf8_boundary(&pending);
                    if end == 0 {
                        continue;
                    }
                    let data = String::from_utf8_lossy(&pending[..end]).into_owned();
                    pending.drain(..end);
                    if on_event.send(PtyEvent::Data { data }).is_err() {
                        break;
                    }
                }
            }
        }
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = on_event.send(PtyEvent::Exit { code });
    });

    let shell = shell.rsplit('/').next().unwrap_or(&shell).to_string();
    Ok(Spawned { id, shell })
}

#[tauri::command]
pub fn pty_write(state: State<'_, Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("Terminal has closed")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("Terminal has closed")?;
    session.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

/// A command line made readable: the program's name rather than its path, and `npm run dev` rather than
/// `node /usr/local/bin/npm run dev` for tools that run on a runtime.
fn readable(args: &str) -> String {
    let name = |s: &str| s.rsplit('/').next().unwrap_or(s).to_string();
    let words: Vec<&str> = args.split_whitespace().collect();
    let Some(first) = words.first() else { return String::new() };
    let skip_runtime =
        ["node", "bun", "deno", "python", "python3", "ruby"].contains(&name(first).as_str()) && words.get(1).is_some_and(|w| !w.starts_with('-'));
    let rest = if skip_runtime { &words[1..] } else { &words[..] };
    let mut out = std::iter::once(name(rest[0]))
        .chain(rest[1..].iter().map(|w| w.to_string()))
        .collect::<Vec<_>>()
        .join(" ");
    if out.chars().count() > 60 {
        out = out.chars().take(59).collect::<String>() + "…";
    }
    out
}

/// What's running in a terminal in front of its shell, if anything: the terminal's foreground process group, when
/// that isn't the shell itself sitting at its prompt.
fn running_in(master: &(dyn MasterPty + Send), shell_pid: Option<u32>) -> Option<String> {
    let leader = master.process_group_leader()? as u32;
    if Some(leader) == shell_pid {
        return None;
    }
    let out = std::process::Command::new("ps")
        .args(["-o", "args=", "-p", &leader.to_string()])
        .output()
        .ok()?;
    let args = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!args.is_empty()).then(|| readable(&args))
}

/// For each of these terminals that has something running (a dev server, a build, `claude`), what it is. An idle shell
/// at its prompt isn't listed.
#[tauri::command]
pub fn pty_running(state: State<'_, Ptys>, ids: Vec<u32>) -> HashMap<u32, String> {
    let sessions = state.sessions.lock().unwrap();
    ids.into_iter()
        .filter_map(|id| {
            let s = sessions.get(&id)?;
            running_in(s.master.as_ref(), s.shell_pid).map(|name| (id, name))
        })
        .collect()
}

#[tauri::command]
pub fn pty_kill(state: State<'_, Ptys>, id: u32) {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_a_shell_command() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "printf 'héllo'"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut out = Vec::new();
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
        }
        assert!(child.wait().unwrap().success());
        assert!(String::from_utf8_lossy(&out).contains("héllo"));
    }

    #[test]
    fn makes_command_lines_readable() {
        assert_eq!(readable("node /usr/local/bin/npm run dev"), "npm run dev");
        assert_eq!(readable("/opt/homebrew/bin/cargo watch -x check"), "cargo watch -x check");
        assert_eq!(readable("node --inspect server.js"), "node --inspect server.js");
        assert_eq!(readable("python3 -m http.server"), "python3 -m http.server");
    }

    #[test]
    fn tells_a_busy_terminal_from_an_idle_one() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-i");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let shell = child.process_id();
        let mut writer = pair.master.take_writer().unwrap();
        // Keep the shell's output flowing so it never blocks writing.
        let mut reader = pair.master.try_clone_reader().unwrap();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            while matches!(reader.read(&mut buf), Ok(n) if n > 0) {}
        });
        let wait = |ms| std::thread::sleep(std::time::Duration::from_millis(ms));
        wait(400);
        assert_eq!(running_in(pair.master.as_ref(), shell), None);
        writer.write_all(b"sleep 5\n").unwrap();
        wait(600);
        assert_eq!(running_in(pair.master.as_ref(), shell).as_deref(), Some("sleep 5"));
        let _ = child.kill();
    }

    #[test]
    fn holds_back_split_characters() {
        let euro = "€".as_bytes();
        assert_eq!(utf8_boundary(b"abc"), 3);
        assert_eq!(utf8_boundary(&[b'a', euro[0], euro[1]]), 1);
        assert_eq!(utf8_boundary(&[b'a', 0xff, b'b']), 3);
    }
}
