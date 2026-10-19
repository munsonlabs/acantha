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
pub fn pty_spawn(state: State<'_, Ptys>, cwd: String, cols: u16, rows: u16, on_event: Channel<PtyEvent>) -> Result<Spawned, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "GitGraph");
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The parent must not hold the slave open, or the reader never sees EOF when the shell exits.
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().unwrap().insert(
        id,
        Session {
            master: pair.master,
            writer,
            killer,
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
    fn holds_back_split_characters() {
        let euro = "€".as_bytes();
        assert_eq!(utf8_boundary(b"abc"), 3);
        assert_eq!(utf8_boundary(&[b'a', euro[0], euro[1]]), 1);
        assert_eq!(utf8_boundary(&[b'a', 0xff, b'b']), 3);
    }
}
