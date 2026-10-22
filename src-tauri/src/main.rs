#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod git;
mod github;
mod menu;
mod packages;
mod pty;
mod rebase;
mod scripts;
mod slack;
mod watch;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

/// Set once the interface has said it's fine to quit (no unsaved edits, or you chose to lose them).
static QUIT_ALLOWED: AtomicBool = AtomicBool::new(false);
/// When the last quit was held back, so a second ⌘Q soon after quits anyway: the interface can't block quitting
/// if it has stopped answering.
static QUIT_ASKED_AT: AtomicU64 = AtomicU64::new(0);

/// Quitting (⌘Q, or closing the window) is held back and the interface asked first, since it knows about unsaved
/// edits. Returns true when it should go ahead now.
fn should_quit(app: &tauri::AppHandle) -> bool {
    if QUIT_ALLOWED.load(Ordering::SeqCst) {
        return true;
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    if now.saturating_sub(QUIT_ASKED_AT.swap(now, Ordering::SeqCst)) < 2000 {
        return true;
    }
    let _ = app.emit("quit-requested", ());
    false
}

/// The interface's go-ahead to quit.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    QUIT_ALLOWED.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::Ptys::default())
        .manage(watch::Watchers::default())
        .menu(|app| menu::build(app, &[]))
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            quit_app,
            git::initial_repo,
            git::resolve_repo,
            git::get_log,
            git::get_commit,
            git::get_changes,
            git::get_file_diff,
            git::run_action,
            git::get_status,
            git::get_status_diff,
            git::apply_patch,
            menu::set_hidden_menu_items,
            git::default_branch,
            git::branch_tracking,
            git::get_reflog,
            git::repo_summaries,
            git::compare_refs,
            github::run_gh,
            packages::package_readme,
            git::get_stats,
            git::head_state,
            git::rev_parse,
            slack::slack_thread,
            slack::slack_canvas,
            scripts::list_scripts,
            files::list_files,
            files::list_new_folders,
            files::list_ignored,
            files::list_dir,
            files::read_file,
            files::write_file,
            files::create_file,
            files::create_folder,
            files::rename_path,
            files::trash_path,
            files::search_files,
            files::file_history,
            files::blame_file,
            files::backup_files,
            files::restore_files,
            rebase::rebase_commits,
            rebase::interactive_rebase,
            watch::watch_repo,
            watch::unwatch_repo,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Acantha")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code: None, .. } => {
                if !should_quit(app) {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if !should_quit(app) {
                    api.prevent_close();
                }
            }
            // Don't leave shells running after the window goes away.
            tauri::RunEvent::Exit => app.state::<pty::Ptys>().kill_all(),
            _ => {}
        });
}
