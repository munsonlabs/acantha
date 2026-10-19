#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;
mod pty;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::Ptys::default())
        .invoke_handler(tauri::generate_handler![
            git::initial_repo,
            git::resolve_repo,
            git::get_log,
            git::get_commit,
            git::get_changes,
            git::get_file_diff,
            git::run_action,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Git Graph")
        .run(|app, event| {
            // Don't leave shells running after the window goes away.
            if let tauri::RunEvent::Exit = event {
                app.state::<pty::Ptys>().kill_all();
            }
        });
}
