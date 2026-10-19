use crate::git::{git, parse_commits, run, stderr_or_code, Commit, COMMIT_FORMAT};
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

/// Overwrites a file in the working tree, used to save a resolved merge conflict.
#[tauri::command]
pub async fn write_file(repo: String, path: String, contents: String) -> Result<(), String> {
    std::fs::write(worktree_path(&repo, &path)?, contents).map_err(|e| format!("{path}: {e}"))
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
    fn keeps_paths_inside_the_repo() {
        let dir = std::env::temp_dir();
        assert!(worktree_path(dir.to_str().unwrap(), "../../etc/hosts").is_err());
    }
}
