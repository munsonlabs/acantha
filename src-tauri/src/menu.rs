use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// One entry in a submenu: an item that runs a command (by id), one of macOS's own, or a separator.
enum Entry<R: Runtime> {
    Command(MenuItem<R>),
    Builtin(PredefinedMenuItem<R>),
    Separator,
}

/// A submenu of `entries`, leaving out the commands in `hidden` (features switched off) and any separator left
/// leading, trailing or doubled by that.
fn submenu<R: Runtime>(app: &AppHandle<R>, title: &str, entries: Vec<Entry<R>>, hidden: &[String]) -> tauri::Result<Submenu<R>> {
    let shown: Vec<Entry<R>> = entries
        .into_iter()
        .filter(|e| !matches!(e, Entry::Command(i) if hidden.iter().any(|h| h == i.id().as_ref())))
        .collect();
    let mut kept: Vec<Entry<R>> = Vec::new();
    for e in shown {
        let after_separator = matches!(kept.last(), None | Some(Entry::Separator));
        if !(matches!(e, Entry::Separator) && after_separator) {
            kept.push(e);
        }
    }
    if matches!(kept.last(), Some(Entry::Separator)) {
        kept.pop();
    }
    let separators: Vec<PredefinedMenuItem<R>> = kept
        .iter()
        .filter(|e| matches!(e, Entry::Separator))
        .map(|_| PredefinedMenuItem::separator(app))
        .collect::<tauri::Result<_>>()?;
    let mut next_separator = separators.iter();
    let items: Vec<&dyn IsMenuItem<R>> = kept
        .iter()
        .filter_map(|e| match e {
            Entry::Command(i) => Some(i as &dyn IsMenuItem<R>),
            Entry::Builtin(i) => Some(i as &dyn IsMenuItem<R>),
            Entry::Separator => next_separator.next().map(|s| s as &dyn IsMenuItem<R>),
        })
        .collect();
    Submenu::with_items(app, title, true, &items)
}

/// The macOS menu bar, without the commands in `hidden` (those of features switched off in Settings; the frontend
/// rebuilds it with `set_hidden_menu_items` whenever that list changes). Items send their id to the frontend as a
/// "menu" event, which runs the matching command. Only shortcuts that mean the same thing everywhere are bound here:
/// ⌘F, ⌘S, ⌘K, ⌘W and ⌘/ stay with the page, because the editor and terminal use them too.
pub fn build<R: Runtime>(app: &AppHandle<R>, hidden: &[String]) -> tauri::Result<Menu<R>> {
    use Entry::{Builtin as B, Command as C, Separator as Sep};
    let item = |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);

    let app_menu = submenu(
        app,
        "Acantha",
        vec![
            B(PredefinedMenuItem::about(app, Some("About Acantha"), None)?),
            Sep,
            C(item("settings", "Settings…", Some("CmdOrCtrl+,"))?),
            Sep,
            B(PredefinedMenuItem::services(app, None)?),
            Sep,
            B(PredefinedMenuItem::hide(app, None)?),
            B(PredefinedMenuItem::hide_others(app, None)?),
            B(PredefinedMenuItem::show_all(app, None)?),
            Sep,
            B(PredefinedMenuItem::quit(app, None)?),
        ],
        hidden,
    )?;
    let file = submenu(
        app,
        "File",
        vec![
            C(item("new-tab", "New Tab", Some("CmdOrCtrl+T"))?),
            C(item("open-repo", "Open Repository…", Some("CmdOrCtrl+O"))?),
            Sep,
            C(item("new-terminal", "New Terminal", None)?),
            Sep,
            C(item("close", "Close Tab", None)?),
        ],
        hidden,
    )?;
    let edit = submenu(
        app,
        "Edit",
        vec![
            B(PredefinedMenuItem::undo(app, None)?),
            B(PredefinedMenuItem::redo(app, None)?),
            Sep,
            B(PredefinedMenuItem::cut(app, None)?),
            B(PredefinedMenuItem::copy(app, None)?),
            B(PredefinedMenuItem::paste(app, None)?),
            B(PredefinedMenuItem::select_all(app, None)?),
            Sep,
            C(item("find", "Find", None)?),
            C(item("search-files", "Find in Files", Some("CmdOrCtrl+Shift+F"))?),
            C(item("search-file-names", "Find File by Name", Some("CmdOrCtrl+Alt+F"))?),
            Sep,
            C(item("open-slack-link", "Open Slack Link…", Some("CmdOrCtrl+Shift+L"))?),
        ],
        hidden,
    )?;
    let view = submenu(
        app,
        "View",
        vec![
            C(item("go-to-file", "Go to File…", Some("CmdOrCtrl+P"))?),
            C(item("palette", "Command Palette…", Some("CmdOrCtrl+Shift+P"))?),
            Sep,
            C(item("toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?),
            C(item("toggle-terminal", "Toggle Terminal", Some("CmdOrCtrl+J"))?),
            C(item("open-files", "Open Files…", Some("CmdOrCtrl+E"))?),
            Sep,
            C(item("refresh", "Refresh", Some("CmdOrCtrl+R"))?),
            Sep,
            C(item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?),
            C(item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?),
            C(item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?),
            Sep,
            B(PredefinedMenuItem::fullscreen(app, None)?),
        ],
        hidden,
    )?;
    let repository = submenu(
        app,
        "Repository",
        vec![
            C(item("undo", "Undo Last Git Action", None)?),
            Sep,
            C(item("fetch", "Fetch", None)?),
            C(item("pull", "Pull", None)?),
            C(item("push", "Push", None)?),
            Sep,
            C(item("clean-up-branches", "Clean Up Branches…", None)?),
            Sep,
            C(item("browse-files", "Browse Files", None)?),
            C(item("source-control", "Git Panel", None)?),
        ],
        hidden,
    )?;
    let window = submenu(
        app,
        "Window",
        vec![
            B(PredefinedMenuItem::minimize(app, None)?),
            B(PredefinedMenuItem::maximize(app, None)?),
            Sep,
            C(item("toggle-claude", "Agents", Some("CmdOrCtrl+Shift+I"))?),
            C(item("new-claude", "New Agent", None)?),
            C(item("new-agent-worktree", "New Agent in a Worktree…", None)?),
            Sep,
            C(item("next-tab", "Next Tab", None)?),
            C(item("prev-tab", "Previous Tab", None)?),
        ],
        hidden,
    )?;
    let help = submenu(app, "Help", vec![C(item("shortcuts", "Keyboard Shortcuts", None)?)], hidden)?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &repository, &window, &help])
}

/// Rebuilds the menu bar without these commands' items, when features are switched on or off.
#[tauri::command]
pub fn set_hidden_menu_items<R: Runtime>(app: AppHandle<R>, ids: Vec<String>) -> Result<(), String> {
    let menu = build(&app, &ids).map_err(|e| e.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())
}

pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id);
}
