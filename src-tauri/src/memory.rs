//! How much memory Acantha's using, as Activity Monitor counts it: every process macOS holds Acantha responsible for
//! (itself, WebKit's processes that draw its windows, and everything it started: agents, TypeScript, terminals and
//! what runs in them), each by its memory footprint. Grouped by what it's for, so the status bar can say what's using
//! it and whether that's usual.

use serde::Serialize;

/// One process's share.
#[derive(Serialize, Clone)]
pub struct Process {
    pid: i32,
    name: String,
    bytes: u64,
    /// "app" (Acantha and its windows), "agents", "types" (TypeScript) or "terminals" (shells and what runs in them).
    group: &'static str,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUse {
    total: u64,
    app: u64,
    agents: u64,
    types: u64,
    terminals: u64,
    /// This Mac's memory, for scale.
    system: u64,
    /// The biggest processes, largest first.
    top: Vec<Process>,
}

/// What a process started by Acantha is for, from its name (or the name of the one Acantha started that it runs
/// under): Claude Code or OpenCode is an agent, Node is TypeScript (its tsserver), and anything else is a terminal's.
fn group_of(started: &str) -> &'static str {
    match started {
        "claude" | "opencode" => "agents",
        "node" => "types",
        _ => "terminals",
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::os::raw::{c_char, c_int, c_void};

    /// `rusage_info_v0`, for `proc_pid_rusage`: only its footprint is read.
    #[repr(C)]
    #[derive(Default)]
    pub struct Rusage {
        uuid: [u8; 16],
        user_time: u64,
        system_time: u64,
        pkg_idle_wkups: u64,
        interrupt_wkups: u64,
        pageins: u64,
        wired_size: u64,
        resident_size: u64,
        pub phys_footprint: u64,
        proc_start_abstime: u64,
        proc_exit_abstime: u64,
    }

    extern "C" {
        fn proc_listallpids(buffer: *mut c_void, buffersize: c_int) -> c_int;
        fn proc_pid_rusage(pid: c_int, flavor: c_int, buffer: *mut Rusage) -> c_int;
        fn proc_name(pid: c_int, buffer: *mut c_void, buffersize: u32) -> c_int;
        fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: *mut c_void, buffersize: c_int) -> c_int;
        fn responsibility_get_pid_responsible_for_pid(pid: c_int) -> c_int;
        fn sysctlbyname(name: *const c_char, oldp: *mut c_void, oldlenp: *mut usize, newp: *mut c_void, newlen: usize) -> c_int;
    }

    pub fn pids() -> Vec<i32> {
        let mut pids = vec![0 as c_int; 16_384];
        // SAFETY: the buffer is as big as said; the count says how many were filled.
        let n = unsafe { proc_listallpids(pids.as_mut_ptr() as *mut c_void, (pids.len() * 4) as c_int) };
        pids.truncate(n.max(0) as usize);
        pids.retain(|&p| p > 0);
        pids
    }

    pub fn responsible(pid: i32) -> i32 {
        // SAFETY: takes a pid, returns one (or -1).
        unsafe { responsibility_get_pid_responsible_for_pid(pid) }
    }

    pub fn footprint(pid: i32) -> Option<u64> {
        let mut usage = Rusage::default();
        // SAFETY: flavor 0 (RUSAGE_INFO_V0) fills a `rusage_info_v0`.
        (unsafe { proc_pid_rusage(pid, 0, &mut usage) } == 0).then_some(usage.phys_footprint)
    }

    pub fn name(pid: i32) -> String {
        let mut buf = [0u8; 256];
        // SAFETY: the buffer is as big as said; the length says how much was filled.
        let n = unsafe { proc_name(pid, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
        String::from_utf8_lossy(&buf[..n.max(0) as usize]).into_owned()
    }

    /// Its parent, from `proc_bsdinfo` (PROC_PIDTBSDINFO), whose fifth field it is.
    pub fn parent(pid: i32) -> Option<i32> {
        let mut info = [0u64; 17]; // sizeof(struct proc_bsdinfo) is 136.
                                   // SAFETY: flavor 3 fills a `proc_bsdinfo`, which the buffer holds.
        let n = unsafe { proc_pidinfo(pid, 3, 0, info.as_mut_ptr() as *mut c_void, 136) };
        (n == 136).then(|| (info[2] & 0xffff_ffff) as i32)
    }

    pub fn system_memory() -> u64 {
        let mut size: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        // SAFETY: hw.memsize is a u64.
        unsafe {
            sysctlbyname(
                c"hw.memsize".as_ptr(),
                &mut size as *mut u64 as *mut c_void,
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        size
    }
}

/// What Acantha's using now: a look at every process on the Mac, so off the main thread.
#[tauri::command]
pub async fn memory_use() -> MemoryUse {
    tauri::async_runtime::spawn_blocking(measure).await.unwrap_or_default()
}

fn measure() -> MemoryUse {
    #[cfg(target_os = "macos")]
    {
        use std::collections::HashMap;
        let me = std::process::id() as i32;
        let ours: Vec<i32> = mac::pids().into_iter().filter(|&p| p == me || mac::responsible(p) == me).collect();
        let parents: HashMap<i32, i32> = ours.iter().filter_map(|&p| Some((p, mac::parent(p)?))).collect();
        // The one Acantha started that a process runs under: itself, or an ancestor whose parent is Acantha.
        let started = |mut p: i32| {
            for _ in 0..64 {
                match parents.get(&p) {
                    Some(&parent) if parent == me => return Some(p),
                    Some(&parent) if parents.contains_key(&parent) => p = parent,
                    _ => return None,
                }
            }
            None
        };
        let mut use_ = MemoryUse {
            system: mac::system_memory(),
            ..Default::default()
        };
        let mut all = Vec::new();
        for p in ours {
            let Some(bytes) = mac::footprint(p) else { continue };
            let name = mac::name(p);
            // Not started by Acantha (WebKit's processes are started by the system on its behalf): the app's own.
            let group = if p == me {
                "app"
            } else {
                started(p).map_or("app", |s| group_of(&mac::name(s)))
            };
            match group {
                "app" => use_.app += bytes,
                "agents" => use_.agents += bytes,
                "types" => use_.types += bytes,
                _ => use_.terminals += bytes,
            }
            use_.total += bytes;
            all.push(Process { pid: p, name, bytes, group });
        }
        all.sort_by_key(|p| std::cmp::Reverse(p.bytes));
        all.truncate(8);
        use_.top = all;
        use_
    }
    #[cfg(not(target_os = "macos"))]
    MemoryUse::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_what_a_started_process_is_for() {
        assert_eq!(group_of("claude"), "agents");
        assert_eq!(group_of("opencode"), "agents");
        assert_eq!(group_of("node"), "types");
        assert_eq!(group_of("zsh"), "terminals");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn counts_this_process() {
        // The test itself is a process of its own: it counts as the app, with some memory, on a Mac with some.
        let m = measure();
        assert!(m.total > 0 && m.app > 0 && m.system > m.total);
        assert!(m.top.iter().any(|p| p.pid == std::process::id() as i32 && p.group == "app"));
    }
}
