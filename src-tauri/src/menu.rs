use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// The macOS menu bar. Items send their id to the frontend as a "menu" event, which runs the matching command.
/// Only shortcuts that mean the same thing everywhere are bound here: ⌘F, ⌘S, ⌘K and ⌘W stay with the page,
/// because the editor and terminal use them too.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = Submenu::with_items(
        app,
        "Acantha",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Acantha"), None)?,
            &sep()?,
            &item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new-tab", "New Tab", Some("CmdOrCtrl+T"))?,
            &item("open-repo", "Open Repository…", Some("CmdOrCtrl+O"))?,
            &sep()?,
            &item("new-terminal", "New Terminal", None)?,
            &sep()?,
            &item("close", "Close Tab", None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &sep()?,
            &item("find", "Find", None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("palette", "Command Palette…", Some("CmdOrCtrl+P"))?,
            &sep()?,
            &item("toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?,
            &item("toggle-terminal", "Toggle Terminal", Some("CmdOrCtrl+J"))?,
            &sep()?,
            &item("refresh", "Refresh", Some("CmdOrCtrl+R"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let repository = Submenu::with_items(
        app,
        "Repository",
        true,
        &[
            &item("fetch", "Fetch", None)?,
            &item("pull", "Pull", None)?,
            &item("push", "Push", None)?,
            &sep()?,
            &item("browse-files", "Browse Files", None)?,
            &item("source-control", "Source Control", None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep()?,
            &item("next-tab", "Next Tab", None)?,
            &item("prev-tab", "Previous Tab", None)?,
        ],
    )?;
    let help = Submenu::with_items(app, "Help", true, &[&item("shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+/"))?])?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &repository, &window, &help])
}

pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id);
}
