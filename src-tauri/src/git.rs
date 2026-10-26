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
    /// Inside a folder the main working tree ignores (build output, a tool's scratch space): one something made for
    /// itself, rather than one to work in.
    ignored: bool,
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
    /// An untracked folder that's a git repository of its own (it has a `.git`): git lists the folder, `path/`, not
    /// its files, as it won't look inside another repository.
    nested_repo: bool,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    hash: String,
    /// `HEAD@{n}`, which git accepts anywhere a commit goes.
    selector: String,
    /// What moved HEAD there: "checkout: moving from main to fix", "reset: moving to HEAD~1", "commit: …".
    action: String,
    /// When HEAD moved, not when the commit was made.
    date: i64,
    subject: String,
    /// On no branch, tag or remote any more: only the reflog still knows it, so it's what you'd want to recover.
    lost: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchState {
    name: String,
    hash: String,
    subject: String,
    /// When its tip was committed.
    date: i64,
    upstream: Option<String>,
    /// Everything on it is in the base.
    merged: bool,
    /// It has an upstream that's gone from the remote: usually deleted once its pull request was merged.
    gone: bool,
    /// Commits on it that the base doesn't have.
    ahead: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchCleanup {
    /// What branches are measured against: the remote's default branch (`origin/main`), or else the local main one.
    base: Option<String>,
    /// Every local branch but the base's own and the one checked out here.
    branches: Vec<BranchState>,
}

/// The branch the others are measured against: the default branch of `origin` as it was last fetched, else a local
/// `main`, `master` or `trunk`.
fn cleanup_base(repo: &str) -> Option<String> {
    if let Ok(remote) = git(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]) {
        return Some(remote.trim().to_string());
    }
    ["main", "master", "trunk"]
        .into_iter()
        .find(|b| git(repo, ["show-ref", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_ok())
        .map(String::from)
}

/// The local branches, with what's needed to tell which are done with: merged into the base, their remote branch
/// gone, or long untouched. For the Clean Up Branches list.
#[tauri::command]
pub async fn branch_cleanup(repo: String) -> Result<BranchCleanup, String> {
    let base = cleanup_base(&repo);
    let current = git(&repo, ["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string());
    // The base's own local branch (main for origin/main) isn't one to clean up.
    let base_local = base.as_deref().map(|b| b.split_once('/').map_or(b, |(_, name)| name).to_string());
    let merged: Vec<String> = match &base {
        Some(b) => git(&repo, ["branch", "--format=%(refname:short)", "--merged", b.as_str()])?
            .lines()
            .map(String::from)
            .collect(),
        None => Vec::new(),
    };
    const FIELDS: &str = "%(refname:short)%1f%(objectname)%1f%(committerdate:unix)%1f%(upstream:short)%1f%(upstream:track)%1f%(contents:subject)";
    // git 2.41 counts every branch's commits beyond the base in one go; older ones are asked branch by branch.
    let counted = base.as_ref().and_then(|b| {
        let format = format!("--format={FIELDS}%1f%(ahead-behind:{b})");
        git(&repo, ["for-each-ref", "refs/heads", format.as_str()]).ok()
    });
    let out = match &counted {
        Some(out) => out.clone(),
        None => git(&repo, ["for-each-ref", "refs/heads", &format!("--format={FIELDS}")])?,
    };
    let mut branches = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split('\x1f').collect();
        let [name, hash, date, upstream, track, subject, ..] = f[..] else {
            continue;
        };
        if Some(name) == current.as_deref() || Some(name) == base_local.as_deref() {
            continue;
        }
        let ahead = match (f.get(6), &base) {
            (Some(counts), _) => counts.split(' ').next().and_then(|n| n.parse().ok()).unwrap_or(0),
            (None, Some(b)) => git(&repo, ["rev-list", "--count", &format!("{b}..{name}")])
                .ok()
                .and_then(|n| n.trim().parse().ok())
                .unwrap_or(0),
            (None, None) => 0,
        };
        branches.push(BranchState {
            name: name.to_string(),
            hash: hash.to_string(),
            subject: subject.to_string(),
            date: date.parse().unwrap_or(0),
            upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
            merged: merged.iter().any(|m| m == name),
            gone: track == "[gone]",
            ahead,
        });
    }
    Ok(BranchCleanup { base, branches })
}

/// Where HEAD has been, newest first: a way back to commits a reset, rebase or deleted branch left behind.
#[tauri::command]
pub async fn get_reflog(repo: String, limit: usize) -> Result<Vec<ReflogEntry>, String> {
    let Ok(out) = git(
        &repo,
        [
            "log",
            "-g",
            "--date=unix",
            &format!("-n{limit}"),
            "--format=%H%x1f%gd%x1f%gs%x1f%s",
            "HEAD",
        ],
    ) else {
        return Ok(Vec::new()); // no commits yet
    };
    let reachable: std::collections::HashSet<String> = git(&repo, ["rev-list", "--all"]).unwrap_or_default().lines().map(String::from).collect();
    Ok(out
        .lines()
        .enumerate()
        .filter_map(|(i, line)| {
            let f: Vec<&str> = line.splitn(4, '\x1f').collect();
            (f.len() == 4).then(|| ReflogEntry {
                hash: f[0].into(),
                selector: format!("HEAD@{{{i}}}"),
                // With --date=unix the selector reads HEAD@{1700000000}.
                date: f[1].rsplit('{').next().and_then(|t| t.trim_end_matches('}').parse().ok()).unwrap_or(0),
                action: f[2].into(),
                subject: f[3].into(),
                lost: !reachable.contains(f[0]),
            })
        })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    path: String,
    /// The folder is gone, or isn't a repository any more.
    missing: bool,
    branch: Option<String>,
    /// Files with changes, staged or not, untracked included.
    changed: usize,
    ahead: u32,
    behind: u32,
    upstream: Option<String>,
    operation: Option<&'static str>,
    last_subject: Option<String>,
    last_date: Option<i64>,
}

fn summarise(path: &str) -> RepoSummary {
    let missing = RepoSummary {
        path: path.into(),
        missing: true,
        branch: None,
        changed: 0,
        ahead: 0,
        behind: 0,
        upstream: None,
        operation: None,
        last_subject: None,
        last_date: None,
    };
    if !Path::new(path).is_dir() {
        return missing;
    }
    let Ok(out) = git(path, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"]) else {
        return missing;
    };
    let status = parse_status(&out);
    let last = trimmed(git(path, ["log", "-1", "--format=%s%x1f%ct"]));
    let (last_subject, last_date) = match last.as_deref().and_then(|l| l.split_once('\x1f')) {
        Some((s, d)) => (Some(s.to_string()), d.parse().ok()),
        None => (None, None),
    };
    RepoSummary {
        path: path.into(),
        missing: false,
        branch: status.branch,
        changed: status.files.len(),
        ahead: status.ahead,
        behind: status.behind,
        upstream: status.upstream,
        operation: operation(path),
        last_subject,
        last_date,
    }
}

/// Where each of several repositories stands, for the start screen: checked side by side, so a dozen take as long as
/// the slowest.
#[tauri::command]
pub async fn repo_summaries(paths: Vec<String>) -> Vec<RepoSummary> {
    std::thread::scope(|s| {
        let handles: Vec<_> = paths.iter().map(|p| s.spawn(move || summarise(p))).collect();
        handles.into_iter().map(|h| h.join().expect("summary thread")).collect()
    })
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
            nested_repo: false,
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
    for f in status.files.iter_mut().filter(|f| f.kind == "untracked" && f.path.ends_with('/')) {
        f.nested_repo = Path::new(&repo).join(&f.path).join(".git").exists();
    }
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
    tauri::async_runtime::spawn_blocking(move || read_log(&repo, limit, branches, show_remotes))
        .await
        .map_err(|e| e.to_string())?
}

/// The commits after the first `skip`, for loading another page below the graph without reading it all again.
#[tauri::command]
pub async fn get_log_page(repo: String, skip: usize, limit: usize, branches: Vec<String>, show_remotes: bool) -> Result<LogPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let head = trimmed(git(&repo, ["rev-parse", "--verify", "-q", "HEAD"]));
        let mut commits = read_commits(&repo, head.is_some(), skip, limit, branches, show_remotes)?;
        let has_more = commits.len() > limit;
        commits.truncate(limit);
        Ok(LogPage { commits, has_more })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    commits: Vec<Commit>,
    has_more: bool,
}

/// Up to `limit + 1` commits (the extra one says whether there are more), in the graph's order.
fn read_commits(repo: &str, has_head: bool, skip: usize, limit: usize, branches: Vec<String>, show_remotes: bool) -> Result<Vec<Commit>, String> {
    let mut args = vec![
        "log".to_string(),
        "--date-order".into(),
        format!("--skip={skip}"),
        format!("--max-count={}", limit + 1),
        COMMIT_FORMAT.into(),
    ];
    let all = branches.is_empty();
    if all {
        args.extend(["--branches".into(), "--tags".into()]);
        if show_remotes {
            args.push("--remotes".into());
        }
        if has_head {
            args.push("HEAD".into());
        }
    } else {
        args.extend(branches);
    }
    args.push("--".into());
    match git(repo, &args) {
        Ok(out) => Ok(parse_commits(&out)),
        // Without HEAD and with no refs at all (a new repository), there's simply nothing to show.
        Err(_) if all && !has_head => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/// Everything the graph shows. The parts are independent, so each runs side by side: a refresh takes as long as the
/// slowest (usually `log` or `status`), not all of them added up.
fn read_log(repo: &str, limit: usize, branches: Vec<String>, show_remotes: bool) -> Result<Log, String> {
    let head = trimmed(git(repo, ["rev-parse", "--verify", "-q", "HEAD"]));
    let has_head = head.is_some();
    std::thread::scope(|s| {
        let commits = s.spawn(move || read_commits(repo, has_head, 0, limit, branches, show_remotes));
        let head_branch = s.spawn(|| trimmed(git(repo, ["symbolic-ref", "--short", "-q", "HEAD"])));
        let refs = s.spawn(|| {
            git(
                repo,
                [
                    "for-each-ref",
                    "--format=%(objectname)%1f%(*objectname)%1f%(refname)",
                    "refs/heads",
                    "refs/remotes",
                    "refs/tags",
                ],
            )
            .map(|out| parse_refs(&out))
        });
        let remotes = s.spawn(|| -> Result<_, String> {
            let remotes: Vec<String> = git(repo, ["remote"])?.lines().map(String::from).collect();
            let url = remotes.first().and_then(|r| trimmed(git(repo, ["remote", "get-url", r.as_str()])));
            Ok((remotes, url))
        });
        // Just counting, so it shouldn't take the index lock and get in the way of git run in a terminal meanwhile.
        let uncommitted =
            s.spawn(|| git(repo, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"]).map(|out| out.lines().count()));
        let stashes =
            s.spawn(|| parse_stashes(&git(repo, ["stash", "list", "--format=%H%x1f%P%x1f%gd%x1f%gs%x1f%an%x1f%ae%x1f%at"]).unwrap_or_default()));
        let worktrees = s.spawn(|| {
            let here = Path::new(repo).canonicalize().unwrap_or_else(|_| PathBuf::from(repo));
            let mut worktrees = parse_worktrees(&git(repo, ["worktree", "list", "--porcelain"]).unwrap_or_default(), &here);
            mark_ignored(&mut worktrees);
            worktrees
        });

        let join = |what: &str| format!("Reading the {what} failed");
        let mut commits = commits.join().map_err(|_| join("log"))??;
        let (remotes, remote_url) = remotes.join().map_err(|_| join("remotes"))??;
        let has_more = commits.len() > limit;
        commits.truncate(limit);
        Ok(Log {
            remote_url,
            worktrees: worktrees.join().map_err(|_| join("worktrees"))?,
            commits,
            refs: refs.join().map_err(|_| join("refs"))??,
            remotes,
            head,
            head_branch: head_branch.join().map_err(|_| join("branch"))?,
            uncommitted: uncommitted.join().map_err(|_| join("status"))??,
            has_more,
            stashes: stashes.join().map_err(|_| join("stashes"))?,
        })
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
                ignored: false,
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

/// Marks the worktrees inside folders the main working tree ignores: `git check-ignore` there, for each one within it.
fn mark_ignored(worktrees: &mut [Worktree]) {
    let Some(main) = worktrees.iter().find(|w| w.main).map(|w| w.path.clone()) else {
        return;
    };
    for w in worktrees.iter_mut() {
        if let Some(rel) = w.path.strip_prefix(&main).and_then(|r| r.strip_prefix('/')) {
            // check-ignore succeeds only when the path is ignored.
            w.ignored = git(&main, ["check-ignore", "-q", "--", rel]).is_ok();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// Where the two split: what the changed files are measured from.
    merge_base: Option<String>,
    /// Commits in `head` that `base` doesn't have, newest first, and the other way round.
    ahead: Vec<Commit>,
    behind: usize,
    /// The head's commit, for opening a file's diff.
    head_hash: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tracking {
    upstream: String,
    /// Commits the local branch has that the upstream doesn't, and the other way round.
    ahead: usize,
    behind: usize,
}

/// How a local branch stands against its upstream (or `against`, a remote branch named instead): none when it has
/// no upstream.
#[tauri::command]
pub async fn branch_tracking(repo: String, branch: String, against: Option<String>) -> Option<Tracking> {
    let upstream = against.or_else(|| {
        trimmed(git(
            &repo,
            ["for-each-ref", "--format=%(upstream:short)", &format!("refs/heads/{branch}")],
        ))
    })?;

    let counts = trimmed(git(
        &repo,
        ["rev-list", "--left-right", "--count", &format!("refs/heads/{branch}...{upstream}")],
    ))?;
    let (ahead, behind) = counts.split_once(char::is_whitespace)?;
    Some(Tracking {
        upstream,
        ahead: ahead.trim().parse().ok()?,
        behind: behind.trim().parse().ok()?,
    })
}

/// The repository's main branch, as its remote names it (`origin/HEAD`), else a local `main` or `master`.
#[tauri::command]
pub async fn default_branch(repo: String) -> Option<String> {
    if let Some(remote) = trimmed(git(&repo, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"])) {
        let local = remote.trim_start_matches("origin/");
        // The local branch when there is one: it's what you'd merge into.
        if trimmed(git(&repo, ["rev-parse", "--verify", "-q", &format!("refs/heads/{local}")])).is_some() {
            return Some(local.to_string());
        }
        return Some(remote);
    }
    ["main", "master"]
        .into_iter()
        .find(|b| trimmed(git(&repo, ["rev-parse", "--verify", "-q", &format!("refs/heads/{b}")])).is_some())
        .map(String::from)
}

/// How `head` differs from `base`: the commits only `head` has (up to 200), how many only `base` has, and where they
/// split, for the files changed since.
#[tauri::command]
pub async fn compare_refs(repo: String, base: String, head: String) -> Result<Comparison, String> {
    let head_hash =
        trimmed(git(&repo, ["rev-parse", "--verify", "-q", &format!("{head}^{{commit}}")])).ok_or_else(|| format!("{head} doesn't exist"))?;
    trimmed(git(&repo, ["rev-parse", "--verify", "-q", &format!("{base}^{{commit}}")])).ok_or_else(|| format!("{base} doesn't exist"))?;
    let merge_base = trimmed(git(&repo, ["merge-base", base.as_str(), head_hash.as_str()]));
    let ahead = parse_commits(&git(
        &repo,
        ["log", "--max-count=200", COMMIT_FORMAT, &format!("{base}..{head_hash}"), "--"],
    )?);
    let behind = trimmed(git(&repo, ["rev-list", "--count", &format!("{head_hash}..{base}")]))
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);
    Ok(Comparison {
        merge_base,
        ahead,
        behind,
        head_hash: Some(head_hash),
    })
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
    fn tells_how_far_a_branch_is_behind_its_upstream() {
        let dir = std::env::temp_dir().join(format!("acantha-tracking-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        let commit = |m: &str| git(&repo, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", m, "--allow-empty"]).unwrap();
        git(&repo, ["init", "-q", "-b", "main"]).unwrap();
        commit("first");
        git(&repo, ["branch", "stale"]).unwrap();
        git(&repo, ["branch", "--set-upstream-to=main", "stale"]).unwrap();
        commit("second");
        commit("third");
        let t = block_on(branch_tracking(repo.clone(), "stale".into(), None)).unwrap();
        assert_eq!((t.upstream.as_str(), t.ahead, t.behind), ("main", 0, 2));
        assert!(block_on(branch_tracking(repo.clone(), "main".into(), None)).is_none());
        let t = block_on(branch_tracking(repo.clone(), "main".into(), Some("stale".into()))).unwrap();
        assert_eq!((t.ahead, t.behind), (2, 0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_the_reflog_and_what_it_alone_remembers() {
        let dir = std::env::temp_dir().join(format!("acantha-reflog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        let commit = |m: &str| git(&repo, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", m, "--allow-empty"]).unwrap();
        git(&repo, ["init", "-q", "-b", "main"]).unwrap();
        commit("first");
        commit("second");
        git(&repo, ["reset", "-q", "--hard", "HEAD~1"]).unwrap();
        let log = block_on(get_reflog(repo.clone(), 50)).unwrap();
        assert_eq!(log.len(), 3);
        assert!(log[0].action.starts_with("reset: moving to HEAD~1"));
        assert_eq!((log[0].selector.as_str(), log[0].lost), ("HEAD@{0}", false));
        assert_eq!((log[1].subject.as_str(), log[1].lost), ("second", true));
        assert!(log[1].date > 1_600_000_000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn summarises_several_repositories() {
        let dir = std::env::temp_dir().join(format!("acantha-summary-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, ["init", "-q", "-b", "main"]).unwrap();
        git(
            &repo,
            ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "hello", "--allow-empty"],
        )
        .unwrap();
        std::fs::write(dir.join("new.txt"), "x").unwrap();
        let list = block_on(repo_summaries(vec![repo.clone(), "/nowhere/at/all".into()]));
        assert_eq!((list[0].missing, list[0].branch.as_deref(), list[0].changed), (false, Some("main"), 1));
        assert_eq!(list[0].last_subject.as_deref(), Some("hello"));
        assert!(list[1].missing);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn compares_two_branches() {
        let dir = std::env::temp_dir().join(format!("acantha-compare-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        let commit = |m: &str| git(&repo, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", m, "--allow-empty"]).unwrap();
        git(&repo, ["init", "-q", "-b", "main"]).unwrap();
        commit("first");
        git(&repo, ["checkout", "-qb", "feature"]).unwrap();
        commit("a");
        commit("b");
        git(&repo, ["checkout", "-q", "main"]).unwrap();
        commit("on main");
        let c = block_on(compare_refs(repo.clone(), "main".into(), "feature".into())).unwrap();
        assert_eq!((c.ahead.len(), c.behind), (2, 1));
        assert_eq!(c.ahead[0].subject, "b");
        let c = block_on(compare_refs(repo.clone(), "feature".into(), "main".into())).unwrap();
        assert_eq!((c.ahead.len(), c.behind), (1, 2));
        assert!(c.merge_base.is_some());
        assert!(block_on(compare_refs(repo.clone(), "nope".into(), "main".into())).is_err());
        assert_eq!(block_on(default_branch(repo)).as_deref(), Some("main"));
        let _ = std::fs::remove_dir_all(&dir);
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
    fn marks_nested_repositories() {
        let dir = std::env::temp_dir().join(format!("acantha-nested-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("inner")).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        git(&repo, ["init", "-q"]).unwrap();
        git(&format!("{repo}/inner"), ["init", "-q"]).unwrap();
        std::fs::write(dir.join("inner/x.txt"), "x").unwrap();
        std::fs::write(dir.join("loose.txt"), "y").unwrap();
        let status = block_on(get_status(repo)).unwrap();
        let nested: Vec<_> = status.files.iter().map(|f| (f.path.as_str(), f.nested_repo)).collect();
        assert!(nested.contains(&("inner/", true)) && nested.contains(&("loose.txt", false)), "{nested:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_branches_done_with() {
        let dir = std::env::temp_dir().join(format!("acantha-cleanup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        let sh = |args: &[&str]| git(&repo, args).unwrap();
        sh(&["init", "-q", "-b", "main"]);
        sh(&["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "first", "--allow-empty"]);
        // Merged: nothing on it that main hasn't.
        sh(&["branch", "done"]);
        // Its remote branch deleted after review, with a commit main never got (a squash merge, say).
        sh(&["checkout", "-qb", "squashed"]);
        sh(&["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "work", "--allow-empty"]);
        sh(&["remote", "add", "origin", "/nowhere"]);
        sh(&["config", "branch.squashed.remote", "origin"]);
        sh(&["config", "branch.squashed.merge", "refs/heads/squashed"]);
        // Still being worked on, checked out here: left out.
        sh(&["checkout", "-qb", "wip"]);

        let found = block_on(branch_cleanup(repo.clone())).unwrap();
        assert_eq!(found.base.as_deref(), Some("main"));
        let names: Vec<_> = found.branches.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["done", "squashed"]);
        let (done, squashed) = (&found.branches[0], &found.branches[1]);
        assert!(done.merged && !done.gone && done.ahead == 0);
        assert!(!squashed.merged && squashed.gone && squashed.ahead == 1);
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
        assert!(log.worktrees.iter().all(|w| !w.ignored));

        // One a tool made inside an ignored folder of the repository.
        std::fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        let nested = format!("{repo}/build/baseline");
        git(&repo, ["worktree", "add", "-q", "--detach", nested.as_str()]).unwrap();
        let log = block_on(get_log(repo.clone(), 100, vec![], true)).unwrap();
        let ignored: Vec<_> = log.worktrees.iter().filter(|w| w.ignored).map(|w| w.path.as_str()).collect();
        // git gives the temp folder's real path (/private/var on macOS).
        assert!(matches!(ignored[..], [path] if path.ends_with("/build/baseline")));
        let _ = std::fs::remove_dir_all(&linked);
    }

    fn reads_the_log_a_page_at_a_time(repo: &str) {
        let repo = repo.to_string();
        let first = block_on(get_log(repo.clone(), 2, vec![], true)).unwrap();
        assert!(first.has_more);
        let rest = block_on(get_log_page(repo.clone(), 2, 2, vec![], true)).unwrap();
        assert!(!rest.has_more);
        let paged: Vec<_> = first.commits.iter().chain(&rest.commits).map(|c| c.subject.as_str()).collect();
        assert_eq!(paged, ["merge", "rename", "first"]);
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
        reads_the_log_a_page_at_a_time(&repo);
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
