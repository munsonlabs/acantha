use crate::git::{git, trimmed};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

/// One file watcher per open repository, so changes made outside the app show up straight away.
#[derive(Default)]
pub struct Watchers {
    watchers: Mutex<HashMap<u32, Debouncer<RecommendedWatcher>>>,
    next_id: AtomicU32,
}

/// What changed: "git" (commits, branches, the index, a checkout) or "tree" (files in the working tree).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Change {
    Git,
    Tree,
}

pub struct Classifier {
    root: PathBuf,
    git_dir: PathBuf,
    ignore: Gitignore,
}

impl Classifier {
    pub fn new(repo: &str) -> Self {
        let root = Path::new(repo).canonicalize().unwrap_or_else(|_| PathBuf::from(repo));
        let git_dir = trimmed(git(repo, ["rev-parse", "--absolute-git-dir"]))
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join(".git"));
        let git_dir = git_dir.canonicalize().unwrap_or(git_dir);
        // The repository's own ignore rules, so build output and dependencies don't trigger refreshes.
        let mut builder = GitignoreBuilder::new(&root);
        builder.add(root.join(".gitignore"));
        builder.add(git_dir.join("info/exclude"));
        let _ = builder.add_line(None, "node_modules/");
        let ignore = builder.build().unwrap_or_else(|_| Gitignore::empty());
        Self { root, git_dir, ignore }
    }

    /// Whether a changed path matters, and how. Git's object store, logs and lock files churn on every operation
    /// without meaning anything by themselves; the refs, HEAD and index that change alongside them are enough.
    pub fn classify(&self, path: &Path) -> Option<Change> {
        if let Ok(inside) = path.strip_prefix(&self.git_dir) {
            let rel = inside.to_string_lossy();
            let noisy = rel.starts_with("objects") || rel.starts_with("logs") || rel.ends_with(".lock") || rel.starts_with("fsmonitor");
            return (!noisy).then_some(Change::Git);
        }
        let rel = path.strip_prefix(&self.root).ok()?;
        if rel.as_os_str().is_empty() {
            return None;
        }
        let ignored = self.ignore.matched_path_or_any_parents(rel, path.is_dir()).is_ignore();
        (!ignored).then_some(Change::Tree)
    }
}

#[tauri::command]
pub fn watch_repo(state: State<'_, Watchers>, repo: String, on_change: Channel<&'static str>) -> Result<u32, String> {
    let classifier = Classifier::new(&repo);
    let root = classifier.root.clone();
    // Bursts of events, like everything a commit touches, arrive as one batch.
    let mut debouncer = new_debouncer(Duration::from_millis(250), move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let changes: Vec<Change> = events.iter().filter_map(|e| classifier.classify(&e.path)).collect();
        if changes.contains(&Change::Git) {
            let _ = on_change.send("git");
        } else if !changes.is_empty() {
            let _ = on_change.send("tree");
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.watchers.lock().unwrap().insert(id, debouncer);
    Ok(id)
}

#[tauri::command]
pub fn unwatch_repo(state: State<'_, Watchers>, id: u32) {
    state.watchers.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_changes() {
        let dir = std::env::temp_dir().join(format!("acantha-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, ["init", "-q"]).unwrap();
        std::fs::write(dir.join(".gitignore"), "target/\n*.log\n").unwrap();
        let c = Classifier::new(&repo);
        let root = &c.root;

        assert_eq!(c.classify(&root.join("src/main.rs")), Some(Change::Tree));
        assert_eq!(c.classify(&root.join(".git/HEAD")), Some(Change::Git));
        assert_eq!(c.classify(&root.join(".git/refs/heads/main")), Some(Change::Git));
        assert_eq!(c.classify(&root.join(".git/objects/ab/cdef")), None);
        assert_eq!(c.classify(&root.join(".git/index.lock")), None);
        assert_eq!(c.classify(&root.join("target/debug/app")), None);
        assert_eq!(c.classify(&root.join("debug.log")), None);
        assert_eq!(c.classify(&root.join("node_modules/x/index.js")), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
