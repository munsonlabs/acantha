//! A guided tour of a repository: Claude Code reads the code (in plan mode, so it changes nothing) and plans the stops
//! a newcomer should see, in order, each a real file and line range with a few sentences on it. Run once, headless,
//! its answer (a JSON array) passed back for the editor to walk through (see src/composables/tour.ts). Run through
//! src/ask.rs, like the editor's ⌘I.

use std::time::Duration;

/// Long enough to read a fair-sized repository; a tour that takes longer isn't coming.
const LIMIT: Duration = Duration::from_secs(6 * 60);

/// What Claude's asked: the stops, as JSON only, optionally about one part of the code.
fn prompt(focus: Option<&str>) -> String {
    let about = match focus.map(str::trim).filter(|f| !f.is_empty()) {
        Some(f) => format!("The tour is about this, in particular: {f}\n\n"),
        None => String::new(),
    };
    format!(
        "{about}Give a newcomer a guided tour of this repository's code: 6 to 12 stops, in the order they should see \
         them. Start where the program starts (or the most central file), then follow how it works. For each stop pick \
         the real file and the line range that shows it best: read the code, so paths and line numbers are right.\n\n\
         Reply with only a JSON array, no other text: [{{\"title\": a short name, \"file\": its path from the \
         repository's root, \"start\": its first line, \"end\": its last line, \"note\": 2 to 4 sentences on what it \
         is, why it matters, and how it connects to the stop before}}]"
    )
}

/// Plans a tour of the repository. Returns Claude's answer: the stops, as JSON text.
#[tauri::command]
pub async fn tour_plan(repo: String, focus: Option<String>, model: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || plan(&repo, focus.as_deref(), model.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

fn plan(repo: &str, focus: Option<&str>, model: Option<&str>) -> Result<String, String> {
    crate::ask::run_once(repo, &prompt(focus), model, LIMIT, "plan a tour")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_for_json_stops_about_the_focus() {
        let p = prompt(Some("how requests are handled"));
        assert!(p.starts_with("The tour is about this, in particular: how requests are handled"));
        assert!(p.contains("only a JSON array") && p.contains("\"start\""));
        assert!(!prompt(Some("  ")).contains("in particular"));
    }
}
