#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod git;
mod menu;
mod pty;
mod rebase;
mod watch;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::Ptys::default())
        .manage(watch::Watchers::default())
        .menu(menu::build)
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            git::initial_repo,
            git::resolve_repo,
            git::get_log,
            git::get_commit,
            git::get_changes,
            git::get_file_diff,
            git::run_action,
            git::get_status,
            git::get_status_diff,
            git::get_stats,
            git::head_state,
            git::rev_parse,
            files::list_files,
            files::read_file,
            files::write_file,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building Acantha")
        .run(|app, event| {
            // Don't leave shells running after the window goes away.
            if let tauri::RunEvent::Exit = event {
                app.state::<pty::Ptys>().kill_all();
            }
        });
}
