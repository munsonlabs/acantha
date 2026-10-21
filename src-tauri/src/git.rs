use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const EMPTY_TREE_SHA1: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EMPTY_TREE_SHA256: &str = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

/// Pseudo-hash the frontend uses for the working tree.
const UNCOMMITTED: &str = "*";

/// Subcommands the UI is allowed to run through `run_action`.
const ACTIONS: &[&str] = &[
    "checkout",
    "branch",
    "tag",
    "merge",
    "rebase",
    "cherry-pick",
    "revert",
    "reset",
    "fetch",
    "push",
    "pull",
    "stash",
    "clean",
    "add",
    "restore",
    "rm",
    "commit",
    "worktree",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub(crate) hash: String,
    pub(crate) parents: Vec<String>,
    author: String,
    email: String,
    date: i64,
    subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    /// "branch" | "remote" | "tag"
    kind: &'static str,
    name: String,
    remote: Option<String>,
    hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Log {
    commits: Vec<Commit>,
    refs: Vec<GitRef>,
    remotes: Vec<String>,
    head: Option<String>,
    head_branch: Option<String>,
    uncommitted: usize,
    has_more: bool,
    stashes: Vec<Stash>,
    /// The first remote's URL, to link commits to their web page.
    remote_url: Option<String>,
    /// Every working tree of the repository, this one included (`git worktree list`).
    worktrees: Vec<Worktree>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    path: String,
    head: Option<String>,
    /// The checked-out branch's short name; none when detached.
    branch: Option<String>,
    /// The main working tree, which git won't remove.
    main: bool,
    /// The one this window has open.
    current: bool,
    locked: bool,
    /// Why it's locked, when whoever locked it said (`git worktree lock --reason`).
    lock_reason: Option<String>,
    /// Its folder is gone: `git worktree prune` would tidy it away.
    prunable: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    files: u32,
    additions: u32,
    deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    hash: String,
    /// The commit the stash was made on top of.
    base: String,
    /// e.g. "stash@{0}"
    selector: String,
    subject: String,
    author: String,
    email: String,
    date: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    author_date: i64,
    committer: String,
    committer_email: String,
    commit_date: i64,
    body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    status: String,
    path: String,
    old_path: Option<String>,
    additions: Option<u32>,
    deletions: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    path: String,
    old_path: Option<String>,
    /// Index (staged) state from porcelain v2, "." when unchanged.
    index: String,
    /// Working tree state, "." when unchanged.
    worktree: String,
    /// "changed" | "untracked" | "conflict"
    kind: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    branch: Option<String>,
    oid: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<StatusFile>,
    /// A multi-step operation that stopped part way: "merge" | "rebase" | "cherry-pick" | "revert".
    operation: Option<&'static str>,
}

pub(crate) const COMMIT_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1e";

pub(crate) fn command(repo: &str) -> Command {
    // Apps launched from Finder get a minimal PATH, which breaks credential helpers and hooks.
    let path = std::env::var("PATH").unwrap_or_default();
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false", "-c", "log.showSignature=false"])
        .env("PATH", format!("{path}:/opt/homebrew/bin:/usr/local/bin"))
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true");
    cmd
}

pub(crate) fn run<I, S>(repo: &str, args: I) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    command(repo).args(args).output().map_err(|e| format!("Failed to run git: {e}"))
}

pub(crate) fn stderr_or_code(out: &Output) -> String {
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if err.is_empty() {
        format!("git exited with code {}", out.status.code().unwrap_or(-1))
    } else {
        err
    }
}

pub(crate) fn git_with<I, S>(repo: &str, args: I, ok_codes: &[i32]) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let out = run(repo, args)?;
    if ok_codes.contains(&out.status.code().unwrap_or(-1)) {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(stderr_or_code(&out))
    }
}

pub(crate) fn git<I, S>(repo: &str, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    git_with(repo, args, &[0])
}

fn empty_tree(hash: &str) -> &'static str {
    if hash.len() == 64 {
        EMPTY_TREE_SHA256
    } else {
        EMPTY_TREE_SHA1
    }
}

/// Parses `git log` output in `COMMIT_FORMAT`.
pub(crate) fn parse_commits(out: &str) -> Vec<Commit> {
    out.split('\x1e')
        .filter_map(|record| {
            let f: Vec<&str> = record.trim_start_matches('\n').splitn(6, '\x1f').collect();
            (f.len() == 6).then(|| Commit {
                hash: f[0].into(),
                parents: f[1].split_whitespace().map(String::from).collect(),
                author: f[2].into(),
                email: f[3].into(),
                date: f[4].parse().unwrap_or(0),
                subject: f[5].into(),
            })
        })
        .collect()
}

fn parse_stashes(out: &str) -> Vec<Stash> {
    out.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(7, '\x1f').collect();
            (f.len() == 7).then(|| Stash {
                hash: f[0].into(),
                base: f[1].split_whitespace().next().unwrap_or_default().into(),
                selector: f[2].into(),
                subject: f[3].into(),
                author: f[4].into(),
                email: f[5].into(),
                date: f[6].parse().unwrap_or(0),
            })
        })
        .collect()
}

/// Which multi-step operation, if any, is waiting to be continued or aborted.
fn operation(repo: &str) -> Option<&'static str> {
    const MARKERS: [(&str, &str); 5] = [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ];
    let mut args = vec!["rev-parse"];
    for (marker, _) in MARKERS {
        args.extend(["--git-path", marker]);
    }
    let out = git(repo, args).ok()?;
    out.lines()
        .zip(MARKERS)
        .find(|(path, _)| std::path::Path::new(repo).join(path).exists())
        .map(|(_, (_, op))| op)
}

pub(crate) fn trimmed(s: Result<String, String>) -> Option<String> {
    s.ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn parse_refs(out: &str) -> Vec<GitRef> {
    let mut refs = Vec::new();
    for line in out.lines() {
        let mut f = line.split('\x1f');
        let (Some(obj), Some(peeled), Some(name)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
        // Annotated tags point at a tag object; the peeled hash is the commit.
        let hash = if peeled.is_empty() { obj } else { peeled }.to_string();
        if let Some(n) = name.strip_prefix("refs/heads/") {
            refs.push(GitRef {
                kind: "branch",
                name: n.into(),
                remote: None,
                hash,
            });
        } else if let Some(n) = name.strip_prefix("refs/remotes/") {
            let Some((remote, branch)) = n.split_once('/') else { continue };
            if branch == "HEAD" {
                continue;
            }
            refs.push(GitRef {
                kind: "remote",
                name: branch.into(),
                remote: Some(remote.into()),
                hash,
            });
        } else if let Some(n) = name.strip_prefix("refs/tags/") {
            refs.push(GitRef {
                kind: "tag",
                name: n.into(),
                remote: None,
                hash,
            });
        }
    }
    refs
}

/// Parses `git diff --name-status -z` output.
fn parse_name_status(out: &str) -> Vec<FileChange> {
    let mut files = Vec::new();
    let mut it = out.split('\0').filter(|s| !s.is_empty());
    while let Some(status) = it.next() {
        let renamed = status.starts_with('R') || status.starts_with('C');
        let (old_path, path) = if renamed {
            (it.next().map(String::from), it.next())
        } else {
            (None, it.next())
        };
        let Some(path) = path else { break };
        files.push(FileChange {
            status: status[..1].to_string(),
            path: path.into(),
            old_path,
            additions: None,
            deletions: None,
        });
    }
    files
}

/// Parses `git diff --numstat -z` output into path -> (additions, deletions). Binary files have no counts.
fn parse_numstat(out: &str) -> HashMap<String, (Option<u32>, Option<u32>)> {
    let mut stats = HashMap::new();
    let mut it = out.split('\0');
    while let Some(tok) = it.next() {
        let mut parts = tok.splitn(3, '\t');
        let (Some(a), Some(d), Some(p)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        // Renames leave the path empty and follow it with the old and new paths.
        let path = if p.is_empty() {
            it.next();
            it.next().unwrap_or_default().to_string()
        } else {
            p.to_string()
        };
        stats.insert(path, (a.parse().ok(), d.parse().ok()));
    }
    stats
}

/// Parses `git status --porcelain=v2 --branch -z`.
fn parse_status(out: &str) -> Status {
    let mut status = Status {
        branch: None,
        oid: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
        operation: None,
    };
    let mut it = out.split('\0');
    while let Some(entry) = it.next() {
        if let Some(header) = entry.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.head" if value != "(detached)" => status.branch = Some(value.into()),
                "branch.oid" if value != "(initial)" => status.oid = Some(value.into()),
                "branch.upstream" => status.upstream = Some(value.into()),
                "branch.ab" => {
                    for n in value.split(' ') {
                        if let Some(a) = n.strip_prefix('+') {
                            status.ahead = a.parse().unwrap_or(0);
                        } else if let Some(b) = n.strip_prefix('-') {
                            status.behind = b.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let file = |xy: &str, path: &str, old_path: Option<&str>, kind| StatusFile {
            path: path.into(),
            old_path: old_path.map(String::from),
            index: xy[..1].into(),
            worktree: xy[1..2].into(),
            kind,
        };
        match entry.chars().next() {
            Some('1') => {
                let f: Vec<&str> = entry.splitn(9, ' ').collect();
                if f.len() == 9 {
                    status.files.push(file(f[1], f[8], None, "changed"));
                }
            }
            Some('2') => {
                // Renames carry the original path as the next NUL-separated field.
                let f: Vec<&str> = entry.splitn(10, ' ').collect();
                let old = it.next();
                if f.len() == 10 {
                    status.files.push(file(f[1], f[9], old, "changed"));
                }
            }
            Some('u') => {
                let f: Vec<&str> = entry.splitn(11, ' ').collect();
                if f.len() == 11 {
                    status.files.push(file(f[1], f[10], None, "conflict"));
                }
            }
            Some('?') => status.files.push(file("??", &entry[2..], None, "untracked")),
            _ => {}
        }
    }
    status
}

#[tauri::command]
pub async fn get_status(repo: String) -> Result<Status, String> {
    let mut status = parse_status(&git(&repo, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])?);
    status.operation = operation(&repo);
    Ok(status)
}

/// Diff of one file in the working tree, against the index (unstaged) or of the index against HEAD (staged).
#[tauri::command]
pub async fn get_status_diff(repo: String, path: String, old_path: Option<String>, staged: bool, untracked: bool) -> Result<String, String> {
    if untracked {
        return git_with(&repo, ["diff", "--no-index", "--", "/dev/null", &path], &[0, 1]);
    }
    let mut args = vec!["diff".to_string(), "-M".into()];
    if staged {
        args.push("--cached".into());
    }
    args.push("--".into());
    args.extend(old_path);
    args.push(path);
    git(&repo, args)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadState {
    head: Option<String>,
    branch: Option<String>,
}

/// Where HEAD is right now, read fresh rather than from the last graph load. Undo records this before and after.
#[tauri::command]
pub async fn head_state(repo: String) -> HeadState {
    HeadState {
        head: trimmed(git(&repo, ["rev-parse", "--verify", "-q", "HEAD"])),
        branch: trimmed(git(&repo, ["symbolic-ref", "--short", "-q", "HEAD"])),
    }
}

/// Resolves a revision to its full hash, or nothing if it doesn't exist.
#[tauri::command]
pub async fn rev_parse(repo: String, rev: String) -> Option<String> {
    trimmed(git(&repo, ["rev-parse", "--verify", "-q", rev.as_str()]))
}

#[tauri::command]
pub fn initial_repo() -> Option<String> {
    let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'))?;
    std::fs::canonicalize(arg).ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn resolve_repo(path: String) -> Result<String, String> {
    trimmed(git(&path, ["rev-parse", "--show-toplevel"])).ok_or_else(|| format!("{path} is not a git repository"))
}

#[tauri::command]
pub async fn get_log(repo: String, limit: usize, branches: Vec<String>, show_remotes: bool) -> Result<Log, String> {
    let head = trimmed(git(&repo, ["rev-parse", "--verify", "-q", "HEAD"]));
    let head_branch = trimmed(git(&repo, ["symbolic-ref", "--short", "-q", "HEAD"]));
    let refs = parse_refs(&git(
        &repo,
        [
            "for-each-ref",
            "--format=%(objectname)%1f%(*objectname)%1f%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?);
    let remotes: Vec<String> = git(&repo, ["remote"])?.lines().map(String::from).collect();
    let remote_url = remotes.first().and_then(|r| trimmed(git(&repo, ["remote", "get-url", r.as_str()])));
    let uncommitted = git(&repo, ["status", "--porcelain", "--untracked-files=all"])?.lines().count();

    let mut commits = Vec::new();
    if head.is_some() || !refs.is_empty() {
        let mut args = vec![
            "log".to_string(),
            "--date-order".into(),
            format!("--max-count={}", limit + 1),
            COMMIT_FORMAT.into(),
        ];
        if branches.is_empty() {
            args.extend(["--branches".into(), "--tags".into()]);
            if show_remotes {
                args.push("--remotes".into());
            }
            if head.is_some() {
                args.push("HEAD".into());
            }
        } else {
            args.extend(branches);
        }
        args.push("--".into());
        commits = parse_commits(&git(&repo, &args)?);
    }

    let stashes = parse_stashes(&git(&repo, ["stash", "list", "--format=%H%x1f%P%x1f%gd%x1f%gs%x1f%an%x1f%ae%x1f%at"]).unwrap_or_default());

    let here = Path::new(&repo).canonicalize().unwrap_or_else(|_| PathBuf::from(&repo));
    let worktrees = parse_worktrees(&git(&repo, ["worktree", "list", "--porcelain"]).unwrap_or_default(), &here);

    let has_more = commits.len() > limit;
    commits.truncate(limit);
    Ok(Log {
        remote_url,
        worktrees,
        commits,
        refs,
        remotes,
        head,
        head_branch,
        uncommitted,
        has_more,
        stashes,
    })
}

/// Parses `git worktree list --porcelain`: blocks of `key value` lines, a blank line between worktrees, the main
/// one first. Bare repositories have no working tree to show, so they're left out.
fn parse_worktrees(out: &str, current: &Path) -> Vec<Worktree> {
    let same = |p: &str| Path::new(p).canonicalize().map(|p| p == current).unwrap_or(false);
    out.split("\n\n")
        .filter(|block| !block.trim().is_empty())
        .enumerate()
        .filter_map(|(i, block)| {
            let mut wt = Worktree {
                path: String::new(),
                head: None,
                branch: None,
                main: i == 0,
                current: false,
                locked: false,
                lock_reason: None,
                prunable: false,
            };
            for line in block.lines() {
                let (key, value) = line.split_once(' ').unwrap_or((line, ""));
                match key {
                    "worktree" => wt.path = value.to_string(),
                    "HEAD" => wt.head = Some(value.to_string()),
                    "branch" => wt.branch = Some(value.strip_prefix("refs/heads/").unwrap_or(value).to_string()),
                    "bare" => return None,
                    "locked" => {
                        wt.locked = true;
                        wt.lock_reason = (!value.is_empty()).then(|| value.to_string());
                    }
                    "prunable" => wt.prunable = true,
                    _ => {}
                }
            }
            wt.current = same(&wt.path);
            (!wt.path.is_empty()).then_some(wt)
        })
        .collect()
}

/// Parses the summary line of `--shortstat`, e.g. " 3 files changed, 10 insertions(+), 2 deletions(-)".
fn parse_shortstat(line: &str) -> Stat {
    let mut stat = Stat::default();
    for part in line.split(',') {
        let n = part.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        if part.contains("file") {
            stat.files = n;
        } else if part.contains("insertion") {
            stat.additions = n;
        } else if part.contains("deletion") {
            stat.deletions = n;
        }
    }
    stat
}

/// Lines added and removed per commit. Loaded after the log so the graph shows up first. Merges have no stat.
#[tauri::command]
pub async fn get_stats(repo: String, hashes: Vec<String>) -> Result<HashMap<String, Stat>, String> {
    use std::io::Write;
    use std::process::Stdio;
    if hashes.is_empty() {
        return Ok(HashMap::new());
    }
    // Hashes go in on stdin, since a long list would overflow the command line.
    let mut child = command(&repo)
        .args(["log", "--no-walk=unsorted", "--stdin", "--shortstat", "--format=%x1e%H"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(hashes.join("\n").as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(stderr_or_code(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .split('\x1e')
        .filter_map(|record| {
            let mut lines = record.lines().filter(|l| !l.trim().is_empty());
            let hash = lines.next()?.trim().to_string();
            Some((hash, lines.next().map(parse_shortstat).unwrap_or_default()))
        })
        .collect())
}

#[tauri::command]
pub async fn get_commit(repo: String, hash: String) -> Result<CommitDetails, String> {
    let out = git(
        &repo,
        ["show", "-s", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B", &hash],
    )?;
    let f: Vec<&str> = out.splitn(9, '\x1f').collect();
    if f.len() < 9 {
        return Err(format!("Could not read commit {hash}"));
    }
    Ok(CommitDetails {
        hash: f[0].into(),
        parents: f[1].split_whitespace().map(String::from).collect(),
        author: f[2].into(),
        email: f[3].into(),
        author_date: f[4].parse().unwrap_or(0),
        committer: f[5].into(),
        committer_email: f[6].into(),
        commit_date: f[7].parse().unwrap_or(0),
        body: f[8].trim_end().into(),
    })
}

/// Files changed between `from` (or the empty tree) and `to`, where `to` may be the working tree.
#[tauri::command]
pub async fn get_changes(repo: String, from: Option<String>, to: String) -> Result<Vec<FileChange>, String> {
    let mut revs = vec![from.unwrap_or_else(|| empty_tree(&to).to_string())];
    if to != UNCOMMITTED {
        revs.push(to.clone());
    }
    let diff = |mode: &str| {
        let args = ["diff", mode, "-z", "-M"]
            .into_iter()
            .map(String::from)
            .chain(revs.iter().cloned())
            .chain(["--".to_string()]);
        git(&repo, args)
    };

    let mut files = parse_name_status(&diff("--name-status")?);
    let stats = parse_numstat(&diff("--numstat")?);
    for f in &mut files {
        if let Some(&(a, d)) = stats.get(&f.path) {
            f.additions = a;
            f.deletions = d;
        }
    }

    if to == UNCOMMITTED {
        let untracked = git(&repo, ["ls-files", "--others", "--exclude-standard", "-z"])?;
        files.extend(untracked.split('\0').filter(|p| !p.is_empty()).map(|p| FileChange {
            status: "?".into(),
            path: p.into(),
            old_path: None,
            additions: None,
            deletions: None,
        }));
    }
    Ok(files)
}

#[tauri::command]
pub async fn get_file_diff(
    repo: String,
    from: Option<String>,
    to: String,
    path: String,
    old_path: Option<String>,
    untracked: bool,
) -> Result<String, String> {
    if untracked {
        // --no-index exits with 1 when the files differ, which they always do here.
        return git_with(&repo, ["diff", "--no-index", "--", "/dev/null", &path], &[0, 1]);
    }
    let mut args = vec!["diff".to_string(), "-M".into(), from.unwrap_or_else(|| empty_tree(&to).to_string())];
    if to != UNCOMMITTED {
        args.push(to);
    }
    args.push("--".into());
    args.extend(old_path);
    args.push(path);
    git(&repo, args)
}

#[tauri::command]
pub async fn run_action(repo: String, args: Vec<String>) -> Result<String, String> {
    match args.first() {
        Some(cmd) if ACTIONS.contains(&cmd.as_str()) => {}
        _ => return Err("Unsupported git command".into()),
    }
    let out = run(&repo, &args)?;
    if !out.status.success() {
        return Err(stderr_or_code(&out));
    }
    // Commands like fetch and push report progress on stderr even when they succeed.
    let text = [out.stdout, out.stderr]
        .iter()
        .map(|b| String::from_utf8_lossy(b).trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    Ok(text.join("\n"))
}

/// Applies a patch of some of a file's lines: to the index (`cached`), or to the working tree. `reverse` takes the
/// patch's changes back out, for unstaging or discarding.
#[tauri::command]
pub async fn apply_patch(repo: String, patch: String, cached: bool, reverse: bool) -> Result<(), String> {
    use std::io::Write;
    use std::process::Stdio;
    let mut cmd = command(&repo);
    cmd.args(["apply", "--whitespace=nowarn"]);
    if cached {
        cmd.arg("--cached");
    }
    if reverse {
        cmd.arg("-R");
    }
    let mut child = cmd
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(patch.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(stderr_or_code(&out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::async_runtime::block_on;

    fn repo() -> String {
        let dir = std::env::temp_dir().join(format!("acantha-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        let sh = |args: &[&str]| git(&path, args).unwrap();
        sh(&["init", "-q", "-b", "main"]);
        sh(&["config", "user.name", "Test"]);
        sh(&["config", "user.email", "test@example.com"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        sh(&["add", "-A"]);
        sh(&["commit", "-qm", "first"]);
        sh(&["tag", "-a", "v1", "-m", "v1"]);
        sh(&["checkout", "-qb", "feature"]);
        std::fs::rename(dir.join("a.txt"), dir.join("b.txt")).unwrap();
        sh(&["add", "-A"]);
        sh(&["commit", "-qm", "rename"]);
        sh(&["checkout", "-q", "main"]);
        sh(&["merge", "-q", "--no-ff", "feature", "-m", "merge"]);
        std::fs::write(dir.join("new.txt"), "x\n").unwrap();
        path
    }

    #[test]
    fn applies_a_patch_to_the_index() {
        let dir = std::env::temp_dir().join(format!("acantha-apply-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, ["init", "-q"]).unwrap();
        std::fs::write(dir.join("f.txt"), "a\nb\n").unwrap();
        git(&repo, ["add", "f.txt"]).unwrap();
        let patch = "--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,3 @@\n a\n+x\n b\n";
        block_on(apply_patch(repo.clone(), patch.into(), true, false)).unwrap();
        assert_eq!(git(&repo, ["show", ":f.txt"]).unwrap(), "a\nx\nb\n");
        block_on(apply_patch(repo.clone(), patch.into(), true, true)).unwrap();
        assert_eq!(git(&repo, ["show", ":f.txt"]).unwrap(), "a\nb\n");
        assert!(block_on(apply_patch(repo.clone(), "nonsense".into(), true, false)).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_worktrees() {
        let out = "worktree /nowhere/main\nHEAD aaa\nbranch refs/heads/main\n\nworktree /nowhere/fix\nHEAD bbb\ndetached\nlocked claude code agent\nprunable gitdir file points to non-existent location\n\n";
        let list = parse_worktrees(out, Path::new("/elsewhere"));
        assert_eq!(list.len(), 2);
        assert_eq!((list[0].branch.as_deref(), list[0].main, list[0].current), (Some("main"), true, false));
        assert_eq!(
            (list[1].branch.as_deref(), list[1].locked, list[1].prunable, list[1].main),
            (None, true, true, false)
        );
        assert_eq!(list[1].lock_reason.as_deref(), Some("claude code agent"));
        assert_eq!(list[0].lock_reason, None);
        assert!(parse_worktrees("worktree /nowhere/bare.git\nbare\n", Path::new("/x")).is_empty());
    }

    #[test]
    fn lists_linked_worktrees() {
        let dir = std::env::temp_dir().join(format!("acantha-worktrees-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, ["init", "-q", "-b", "main"]).unwrap();
        git(
            &repo,
            ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "first", "--allow-empty"],
        )
        .unwrap();
        let linked = format!("{repo}-linked");
        let _ = std::fs::remove_dir_all(&linked);
        git(&repo, ["worktree", "add", "-q", "-b", "feature", linked.as_str()]).unwrap();
        let log = block_on(get_log(linked.clone(), 100, vec![], true)).unwrap();
        let current: Vec<_> = log.worktrees.iter().filter(|w| w.current).collect();
        assert_eq!(log.worktrees.len(), 2);
        assert_eq!(
            (current.len(), current[0].branch.as_deref(), current[0].main),
            (1, Some("feature"), false)
        );
        let _ = std::fs::remove_dir_all(&linked);
    }

    #[test]
    fn reads_log_refs_and_changes() {
        let repo = repo();
        let log = block_on(get_log(repo.clone(), 100, vec![], true)).unwrap();
        assert_eq!(
            log.commits.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(),
            ["merge", "rename", "first"]
        );
        assert_eq!(log.commits[0].parents.len(), 2);
        assert_eq!(log.head_branch.as_deref(), Some("main"));
        assert_eq!(log.uncommitted, 1);
        // The annotated tag resolves to the commit, not the tag object.
        let tag = log.refs.iter().find(|r| r.kind == "tag").unwrap();
        assert_eq!(tag.hash, log.commits[2].hash);

        let rename = &log.commits[1];
        let files = block_on(get_changes(repo.clone(), Some(rename.parents[0].clone()), rename.hash.clone())).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(
            (files[0].status.as_str(), files[0].path.as_str(), files[0].old_path.as_deref()),
            ("R", "b.txt", Some("a.txt"))
        );

        let root = block_on(get_changes(repo.clone(), None, log.commits[2].hash.clone())).unwrap();
        assert_eq!((root[0].status.as_str(), root[0].additions), ("A", Some(1)));

        let working = block_on(get_changes(repo.clone(), log.head.clone(), UNCOMMITTED.into())).unwrap();
        assert_eq!(working[0].status, "?");
        let diff = block_on(get_file_diff(
            repo.clone(),
            log.head.clone(),
            UNCOMMITTED.into(),
            "new.txt".into(),
            None,
            true,
        ))
        .unwrap();
        assert!(diff.contains("+x"));

        let stats = block_on(get_stats(repo.clone(), log.commits.iter().map(|c| c.hash.clone()).collect())).unwrap();
        let first = &stats[&log.commits[2].hash];
        assert_eq!((first.files, first.additions, first.deletions), (1, 1, 0));
        assert_eq!(stats[&log.commits[0].hash].files, 0, "merges have no stat");

        let status = block_on(get_status(repo.clone())).unwrap();
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.oid, log.head);
        assert_eq!((status.files[0].kind, status.files[0].path.as_str()), ("untracked", "new.txt"));

        // Stage it, then edit it again so it is both staged and modified.
        block_on(run_action(repo.clone(), vec!["add".into(), "--".into(), "new.txt".into()])).unwrap();
        std::fs::write(std::path::Path::new(&repo).join("new.txt"), "x\ny\n").unwrap();
        let status = block_on(get_status(repo.clone())).unwrap();
        assert_eq!((status.files[0].index.as_str(), status.files[0].worktree.as_str()), ("A", "M"));
        let staged = block_on(get_status_diff(repo.clone(), "new.txt".into(), None, true, false)).unwrap();
        let unstaged = block_on(get_status_diff(repo.clone(), "new.txt".into(), None, false, false)).unwrap();
        assert!(staged.contains("+x") && !staged.contains("+y"));
        assert!(unstaged.contains("+y"));

        assert!(block_on(run_action(repo.clone(), vec!["gc".into()])).is_err());
        let _ = std::fs::remove_dir_all(&repo);
    }
}
