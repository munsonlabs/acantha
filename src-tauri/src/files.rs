use crate::git::{git, git_with, parse_commits, run, stderr_or_code, Commit, COMMIT_FORMAT};
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MAX_TEXT: usize = 2 * 1024 * 1024;
const MAX_IMAGE: usize = 15 * 1024 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileContent {
    Text { text: String, size: usize },
    Image { data: String, mime: &'static str, size: usize },
    Binary { size: usize },
    TooLarge { size: usize },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    author: String,
    date: i64,
    summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    hash: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    commits: HashMap<String, BlameCommit>,
    lines: Vec<BlameLine>,
}

fn image_mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Resolves a repo-relative path in the working tree, refusing anything that escapes the repository.
fn worktree_path(repo: &str, path: &str) -> Result<PathBuf, String> {
    let root = Path::new(repo).canonicalize().map_err(|e| e.to_string())?;
    let full = root.join(path);
    let resolved = full.canonicalize().map_err(|e| format!("{path}: {e}"))?;
    if !resolved.starts_with(&root) {
        return Err(format!("{path} is outside the repository"));
    }
    Ok(resolved)
}

fn classify(path: &str, bytes: Vec<u8>) -> FileContent {
    let size = bytes.len();
    if let Some(mime) = image_mime(path) {
        if size > MAX_IMAGE {
            return FileContent::TooLarge { size };
        }
        return FileContent::Image {
            data: base64::engine::general_purpose::STANDARD.encode(&bytes),
            mime,
            size,
        };
    }
    if bytes[..size.min(8000)].contains(&0) {
        return FileContent::Binary { size };
    }
    if size > MAX_TEXT {
        return FileContent::TooLarge { size };
    }
    FileContent::Text {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        size,
    }
}

/// Every file in the repository at `rev`, or in the working tree (tracked and untracked, not ignored).
#[tauri::command]
pub async fn list_files(repo: String, rev: Option<String>) -> Result<Vec<String>, String> {
    let out = match &rev {
        Some(rev) => git(&repo, ["ls-tree", "-r", "-z", "--name-only", "--full-tree", rev.as_str()])?,
        None => git(&repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?,
    };
    let root = Path::new(&repo);
    let mut files: Vec<String> = out
        .split('\0')
        .filter(|p| !p.is_empty())
        // Deleted files are still in the index until the deletion is staged.
        .filter(|p| rev.is_some() || root.join(p).exists())
        .map(String::from)
        .collect();
    files.dedup();
    Ok(files)
}

#[tauri::command]
pub async fn read_file(repo: String, rev: Option<String>, path: String) -> Result<FileContent, String> {
    let bytes = match rev {
        Some(rev) => {
            let out = run(&repo, ["show", &format!("{rev}:{path}")])?;
            if !out.status.success() {
                return Err(stderr_or_code(&out));
            }
            out.stdout
        }
        None => std::fs::read(worktree_path(&repo, &path)?).map_err(|e| format!("{path}: {e}"))?,
    };
    Ok(classify(&path, bytes))
}

const MAX_HITS: usize = 2000;
const MAX_LINE: usize = 400;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    line: u32,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    hits: Vec<SearchHit>,
    /// More lines matched than were returned.
    truncated: bool,
}

/// `git grep -n -z` output: `path NUL line NUL text` per line, with `rev:` before the path when searching a commit.
fn parse_grep(out: &str, rev: Option<&str>) -> SearchResults {
    let prefix = rev.map(|r| format!("{r}:"));
    let mut hits = Vec::new();
    let mut truncated = false;
    for record in out.lines() {
        let mut parts = record.splitn(3, '\0');
        let (Some(path), Some(line), Some(text)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let Ok(line) = line.parse() else { continue };
        if hits.len() == MAX_HITS {
            truncated = true;
            break;
        }
        let path = prefix.as_deref().and_then(|p| path.strip_prefix(p)).unwrap_or(path);
        let text = match text.char_indices().nth(MAX_LINE) {
            Some((cut, _)) => &text[..cut],
            None => text,
        };
        hits.push(SearchHit {
            path: path.to_string(),
            line,
            text: text.to_string(),
        });
    }
    SearchResults { hits, truncated }
}

/// Lines matching `query` in the repository's text files, at `rev` or in the working tree (tracked and untracked,
/// not ignored). A plain string unless `regex`, which takes an extended regular expression. `paths` are git pathspecs
/// limiting which files are searched (`:(glob)**/*.ts`, `:(glob,exclude)target/**`).
#[tauri::command]
pub async fn search_files(
    repo: String,
    rev: Option<String>,
    query: String,
    regex: bool,
    case_sensitive: bool,
    paths: Vec<String>,
) -> Result<SearchResults, String> {
    if query.is_empty() {
        return Ok(SearchResults {
            hits: Vec::new(),
            truncated: false,
        });
    }
    let mut args = vec!["grep", "-n", "-z", "-I", "--no-color", "--full-name", if regex { "-E" } else { "-F" }];
    if !case_sensitive {
        args.push("-i");
    }
    if rev.is_none() {
        args.push("--untracked");
    }
    args.extend(["-e", query.as_str()]);
    if let Some(rev) = &rev {
        args.push(rev.as_str());
    }
    args.push("--");
    args.extend(paths.iter().map(String::as_str));
    // Exit code 1 is "nothing matched".
    let out = git_with(&repo, &args, &[0, 1])?;
    Ok(parse_grep(&out, rev.as_deref()))
}

/// A path in the working tree for the file browser's create, rename and trash: relative, no `..`, and the folder it
/// sits in (the nearest one that exists) inside the repository, so a symlink can't lead out of it. The last part is
/// left unresolved, so renaming or trashing a symlink acts on the link, not what it points at.
fn browser_path(repo: &str, path: &str) -> Result<PathBuf, String> {
    let rel = safe_relative(path)?;
    let root = Path::new(repo).canonicalize().map_err(|e| e.to_string())?;
    let name = rel.file_name().ok_or_else(|| format!("{path} is not a file or folder name"))?;
    let mut parent = root.join(rel.parent().unwrap_or(Path::new("")));
    while !parent.exists() {
        parent = parent.parent().ok_or("No such folder")?.to_path_buf();
    }
    if !parent.canonicalize().map_err(|e| e.to_string())?.starts_with(&root) {
        return Err(format!("{path} is outside the repository"));
    }
    Ok(root.join(rel.parent().unwrap_or(Path::new(""))).join(name))
}

fn must_be_free(p: &Path, path: &str) -> Result<(), String> {
    if p.symlink_metadata().is_ok() {
        return Err(format!("{path} already exists"));
    }
    Ok(())
}

/// A new, empty file (and any folders it needs).
#[tauri::command]
pub async fn create_file(repo: String, path: String) -> Result<(), String> {
    let p = browser_path(&repo, &path)?;
    must_be_free(&p, &path)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&p)
        .map(|_| ())
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub async fn create_folder(repo: String, path: String) -> Result<(), String> {
    let p = browser_path(&repo, &path)?;
    must_be_free(&p, &path)?;
    std::fs::create_dir_all(&p).map_err(|e| format!("{path}: {e}"))
}

/// Renames or moves a file or folder within the working tree. Won't overwrite.
#[tauri::command]
pub async fn rename_path(repo: String, from: String, to: String) -> Result<(), String> {
    let source = browser_path(&repo, &from)?;
    source.symlink_metadata().map_err(|e| format!("{from}: {e}"))?;
    let dest = browser_path(&repo, &to)?;
    must_be_free(&dest, &to)?;
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&source, &dest).map_err(|e| format!("{from}: {e}"))
}

/// Moves `p` into `trash`, numbering the name if one's already there, as Finder does.
fn move_into(p: &Path, trash: &Path) -> Result<PathBuf, String> {
    let name = p.file_name().ok_or("Nothing to move")?.to_string_lossy().into_owned();
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.clone(), String::new()),
    };
    let mut dest = trash.join(&name);
    let mut n = 2;
    while dest.symlink_metadata().is_ok() {
        dest = trash.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    std::fs::rename(p, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Moves a file or folder to your Trash, so it can be put back from Finder.
#[tauri::command]
pub async fn trash_path(repo: String, path: String) -> Result<(), String> {
    let p = browser_path(&repo, &path)?;
    p.symlink_metadata().map_err(|e| format!("{path}: {e}"))?;
    let home = std::env::var("HOME").map_err(|_| "Couldn't find your Trash".to_string())?;
    move_into(&p, &Path::new(&home).join(".Trash"))
        .map(|_| ())
        .map_err(|e| format!("{path}: {e}"))
}

/// Overwrites a file in the working tree, used to save a resolved merge conflict.
#[tauri::command]
pub async fn write_file(repo: String, path: String, contents: String) -> Result<(), String> {
    std::fs::write(worktree_path(&repo, &path)?, contents).map_err(|e| format!("{path}: {e}"))
}

/// A repo-relative path that stays inside the repository: no absolute paths and no `..`.
fn safe_relative(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if p.is_absolute() || p.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err(format!("{path} is outside the repository"));
    }
    Ok(p)
}

fn backups_root() -> PathBuf {
    std::env::temp_dir().join("acantha-backups")
}

#[derive(Serialize, serde::Deserialize, Default)]
struct BackupManifest {
    /// Files that existed, copied into the backup.
    present: Vec<String>,
    /// Files that didn't exist, so restoring removes them again.
    missing: Vec<String>,
}

/// Copies files from the working tree aside before they're discarded, so Undo can put them back. Returns the backup's id.
#[tauri::command]
pub async fn backup_files(repo: String, paths: Vec<String>) -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let id = format!("{}-{nanos}", std::process::id());
    let dir = backups_root().join(&id);
    let mut manifest = BackupManifest::default();
    for path in paths {
        let rel = safe_relative(&path)?;
        let src = Path::new(&repo).join(rel);
        if src.is_file() {
            let dest = dir.join("files").join(rel);
            std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::copy(&src, &dest).map_err(|e| format!("{path}: {e}"))?;
            manifest.present.push(path);
        } else {
            manifest.missing.push(path);
        }
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("manifest.json"), serde_json::to_string(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Puts backed-up files back exactly as they were, removing any that didn't exist at the time.
#[tauri::command]
pub async fn restore_files(repo: String, backup: String) -> Result<(), String> {
    if backup.contains(['/', '\\']) || backup.contains("..") {
        return Err("Invalid backup".into());
    }
    let dir = backups_root().join(&backup);
    let manifest: BackupManifest =
        serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).map_err(|_| "That backup no longer exists".to_string())?)
            .map_err(|e| e.to_string())?;
    for path in &manifest.present {
        let rel = safe_relative(path)?;
        let dest = Path::new(&repo).join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(dir.join("files").join(rel), &dest).map_err(|e| format!("{path}: {e}"))?;
    }
    for path in &manifest.missing {
        let dest = Path::new(&repo).join(safe_relative(path)?);
        if dest.is_file() {
            std::fs::remove_file(&dest).map_err(|e| format!("{path}: {e}"))?;
        }
    }
    Ok(())
}

/// Commits that touched a file, following renames.
#[tauri::command]
pub async fn file_history(repo: String, rev: Option<String>, path: String) -> Result<Vec<Commit>, String> {
    let rev = rev.unwrap_or_else(|| "HEAD".into());
    Ok(parse_commits(&git(
        &repo,
        ["log", "--follow", "--max-count=300", COMMIT_FORMAT, rev.as_str(), "--", path.as_str()],
    )?))
}

/// Parses `git blame --porcelain`, where each commit's details appear once, on its first line.
fn parse_blame(out: &str) -> Blame {
    let mut blame = Blame {
        commits: HashMap::new(),
        lines: Vec::new(),
    };
    let mut current = String::new();
    for line in out.lines() {
        if let Some(text) = line.strip_prefix('\t') {
            blame.lines.push(BlameLine {
                hash: current.clone(),
                text: text.into(),
            });
            continue;
        }
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        if (key.len() == 40 || key.len() == 64) && key.bytes().all(|b| b.is_ascii_hexdigit()) {
            current = key.into();
            blame.commits.entry(current.clone()).or_insert(BlameCommit {
                author: String::new(),
                date: 0,
                summary: String::new(),
            });
            continue;
        }
        if let Some(c) = blame.commits.get_mut(&current) {
            match key {
                "author" => c.author = value.into(),
                "author-time" => c.date = value.parse().unwrap_or(0),
                "summary" => c.summary = value.into(),
                _ => {}
            }
        }
    }
    blame
}

/// Who last changed each line. Without a revision it blames the working tree, where uncommitted lines get the zero hash.
#[tauri::command]
pub async fn blame_file(repo: String, rev: Option<String>, path: String) -> Result<Blame, String> {
    let mut args = vec!["blame".to_string(), "--porcelain".into()];
    args.extend(rev);
    args.extend(["--".into(), path]);
    Ok(parse_blame(&git(&repo, args)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_blame() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let out = format!(
            "{a} 1 1 2\nauthor Ann\nauthor-time 100\nsummary first\nfilename f\n\tone\n{a} 2 2\n\ttwo\n{b} 3 3 1\nauthor Bob\nauthor-time 200\nsummary second\nfilename f\n\tthree\n"
        );
        let blame = parse_blame(&out);
        assert_eq!(blame.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), ["one", "two", "three"]);
        assert_eq!(blame.lines[1].hash, a);
        assert_eq!(blame.commits[&b].author, "Bob");
        assert_eq!(blame.commits[&a].summary, "first");
    }

    #[test]
    fn backs_up_and_restores_discarded_files() {
        let dir = std::env::temp_dir().join(format!("acantha-backup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        std::fs::write(dir.join("src/a.txt"), "changed").unwrap();
        std::fs::write(dir.join("new.bin"), [0u8, 1, 2]).unwrap();

        let id = tauri::async_runtime::block_on(backup_files(repo.clone(), vec!["src/a.txt".into(), "new.bin".into(), "gone.txt".into()])).unwrap();
        // The discard: one file reverted, one deleted, and one that was deleted gets recreated by git.
        std::fs::write(dir.join("src/a.txt"), "original").unwrap();
        std::fs::remove_file(dir.join("new.bin")).unwrap();
        std::fs::write(dir.join("gone.txt"), "restored by discard").unwrap();

        tauri::async_runtime::block_on(restore_files(repo.clone(), id)).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("src/a.txt")).unwrap(), "changed");
        assert_eq!(std::fs::read(dir.join("new.bin")).unwrap(), [0, 1, 2]);
        assert!(!dir.join("gone.txt").exists());

        assert!(tauri::async_runtime::block_on(backup_files(repo.clone(), vec!["../escape".into()])).is_err());
        assert!(tauri::async_runtime::block_on(restore_files(repo, "../x".into())).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn searches_files() {
        let dir = std::env::temp_dir().join(format!("acantha-search-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, ["init", "-q"]).unwrap();
        std::fs::write(dir.join("src/a.txt"), "one\nNeedle here\nthree\n").unwrap();
        std::fs::write(dir.join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(dir.join("ignored.txt"), "needle\n").unwrap();
        std::fs::write(dir.join("bin.dat"), [b'n', b'e', b'e', b'd', b'l', b'e', 0]).unwrap();
        git(&repo, ["add", "src/a.txt"]).unwrap();
        git(&repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"]).unwrap();
        std::fs::write(dir.join("new.txt"), "a needle untracked\n").unwrap();

        let search_in = |rev: Option<&str>, q: &str, regex: bool, case: bool, paths: &[&str]| {
            let paths = paths.iter().map(|p| p.to_string()).collect();
            tauri::async_runtime::block_on(search_files(repo.clone(), rev.map(String::from), q.into(), regex, case, paths)).unwrap()
        };
        let search = |rev: Option<&str>, q: &str, regex: bool, case: bool| search_in(rev, q, regex, case, &[]);
        let found = search(None, "needle", false, false);
        let mut where_: Vec<_> = found.hits.iter().map(|h| (h.path.as_str(), h.line)).collect();
        where_.sort();
        // Untracked files count; ignored and binary ones don't.
        assert_eq!(where_, [("new.txt", 1), ("src/a.txt", 2)]);
        assert_eq!(search(None, "needle", false, true).hits.len(), 1);
        assert_eq!(search(None, "^Need", true, true).hits[0].text, "Needle here");
        assert!(search(None, "nothing like it", false, false).hits.is_empty());
        let at_head = search(Some("HEAD"), "needle", false, false);
        assert_eq!(at_head.hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), ["src/a.txt"]);
        // Pathspecs narrow it down, or leave files out.
        let only_src = search_in(None, "needle", false, false, &[":(glob)src/**"]);
        assert_eq!(only_src.hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), ["src/a.txt"]);
        let not_src = search_in(None, "needle", false, false, &[":(glob,exclude)src/**"]);
        assert_eq!(not_src.hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), ["new.txt"]);
        // An option-like query is searched for, not obeyed.
        assert!(search(None, "--help", false, false).hits.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_renames_and_trashes() {
        let dir = std::env::temp_dir().join(format!("acantha-browser-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("trash")).unwrap();
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let r = repo.to_string_lossy().into_owned();
        let run = |f: std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>>>>| tauri::async_runtime::block_on(f);

        run(Box::pin(create_file(r.clone(), "src/new.ts".into()))).unwrap();
        assert!(repo.join("src/new.ts").is_file());
        assert!(run(Box::pin(create_file(r.clone(), "src/new.ts".into()))).is_err(), "won't overwrite");
        run(Box::pin(create_folder(r.clone(), "docs/notes".into()))).unwrap();
        assert!(repo.join("docs/notes").is_dir());

        run(Box::pin(rename_path(r.clone(), "src/new.ts".into(), "lib/renamed.ts".into()))).unwrap();
        assert!(repo.join("lib/renamed.ts").is_file() && !repo.join("src/new.ts").exists());
        assert!(
            run(Box::pin(rename_path(r.clone(), "docs".into(), "lib/renamed.ts".into()))).is_err(),
            "won't overwrite"
        );

        for bad in ["../escape", "/etc/hosts", "a/../../b"] {
            assert!(run(Box::pin(create_file(r.clone(), bad.into()))).is_err(), "{bad}");
        }

        std::fs::write(dir.join("trash/renamed.ts"), "older").unwrap();
        let moved = move_into(&browser_path(&r, "lib/renamed.ts").unwrap(), &dir.join("trash")).unwrap();
        assert_eq!(moved.file_name().unwrap(), "renamed 2.ts");
        assert!(!repo.join("lib/renamed.ts").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_paths_inside_the_repo() {
        let dir = std::env::temp_dir();
        assert!(worktree_path(dir.to_str().unwrap(), "../../etc/hosts").is_err());
    }
}
