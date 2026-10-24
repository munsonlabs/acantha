import { Channel, invoke } from '@tauri-apps/api/core'

/** Pseudo-hash for the working tree, shown as the "Uncommitted Changes" row. */
export const UNCOMMITTED = '*'

export interface Commit {
  hash: string
  parents: string[]
  author: string
  email: string
  date: number
  subject: string
  /** Set on rows that are stashes rather than commits. */
  stash?: Stash
}

export interface Stash {
  hash: string
  base: string
  selector: string
  subject: string
  author: string
  email: string
  date: number
}

export interface GitRef {
  kind: 'branch' | 'remote' | 'tag'
  name: string
  remote: string | null
  hash: string
}

export interface Log {
  commits: Commit[]
  refs: GitRef[]
  remotes: string[]
  head: string | null
  headBranch: string | null
  uncommitted: number
  hasMore: boolean
  stashes: Stash[]
  remoteUrl: string | null
  /** Every working tree of the repository, this one included. */
  worktrees: Worktree[]
}

export interface RepoSummary {
  path: string
  missing: boolean
  branch: string | null
  changed: number
  ahead: number
  behind: number
  upstream: string | null
  operation: string | null
  lastSubject: string | null
  lastDate: number | null
}

/** A local branch, with what tells whether it's done with (see `branch_cleanup` in src-tauri/src/git.rs). */
export interface BranchState {
  name: string
  hash: string
  subject: string
  date: number
  upstream: string | null
  /** Everything on it is in the base. */
  merged: boolean
  /** Its upstream's gone from the remote. */
  gone: boolean
  /** Commits on it that the base doesn't have. */
  ahead: number
}

export interface BranchCleanup {
  /** What branches are measured against: `origin/main`, or a local main branch. */
  base: string | null
  branches: BranchState[]
}

export interface ReflogEntry {
  hash: string
  selector: string
  action: string
  date: number
  subject: string
  lost: boolean
}

export interface Comparison {
  mergeBase: string | null
  /** Commits only the head has, newest first (up to 200). */
  ahead: Commit[]
  /** How many commits only the base has. */
  behind: number
  headHash: string | null
}

export interface PackageReadme {
  name: string
  version: string | null
  source: 'installed' | 'npm'
  text: string
}

export interface Worktree {
  path: string
  head: string | null
  /** The checked-out branch; null when detached. */
  branch: string | null
  /** The main working tree, which git won't remove. */
  main: boolean
  /** The one this tab has open. */
  current: boolean
  locked: boolean
  /** Why it's locked, if whoever locked it said. */
  lockReason: string | null
  /** Its folder is gone; `git worktree prune` tidies it away. */
  prunable: boolean
  /** Inside a folder the main working tree ignores: one a build or tool made for itself. */
  ignored: boolean
}

export interface Stat {
  files: number
  additions: number
  deletions: number
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: string
  email: string
  authorDate: number
  committer: string
  committerEmail: string
  commitDate: number
  body: string
}

export interface FileChange {
  status: string
  path: string
  oldPath: string | null
  additions: number | null
  deletions: number | null
}

export interface StatusFile {
  path: string
  oldPath: string | null
  /** Staged state, "." when unchanged. */
  index: string
  /** Working tree state, "." when unchanged. */
  worktree: string
  kind: 'changed' | 'untracked' | 'conflict'
  /** An untracked folder that's a repository of its own: git lists the folder (`path/`), not its files. */
  nestedRepo: boolean
}

export interface Status {
  branch: string | null
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: StatusFile[]
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
}

export type FileContent =
  | { kind: 'text'; text: string; size: number }
  | { kind: 'image'; data: string; mime: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'tooLarge'; size: number }

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface SearchResults {
  hits: SearchHit[]
  /** More lines matched than came back. */
  truncated: boolean
}

export interface Blame {
  commits: Record<string, { author: string; date: number; summary: string }>
  lines: { hash: string; text: string }[]
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

export interface TodoItem {
  action: RebaseAction
  hash: string
  message: string | null
}

export interface LogOptions {
  limit: number
  /** Revisions to show. Empty means every branch and tag. */
  branches: string[]
  showRemotes: boolean
}

export interface FileDiffOptions {
  from: string | null
  to: string
  path: string
  oldPath: string | null
  untracked: boolean
}

export const git = {
  initialRepo: () => invoke<string | null>('initial_repo'),
  resolveRepo: (path: string) => invoke<string>('resolve_repo', { path }),
  log: (repo: string, opts: LogOptions) => invoke<Log>('get_log', { repo, ...opts }),
  commit: (repo: string, hash: string) => invoke<CommitDetails>('get_commit', { repo, hash }),
  changes: (repo: string, from: string | null, to: string) => invoke<FileChange[]>('get_changes', { repo, from, to }),
  fileDiff: (repo: string, opts: FileDiffOptions) => invoke<string>('get_file_diff', { repo, ...opts }),
  action: (repo: string, args: string[]) => invoke<string>('run_action', { repo, args }),
  status: (repo: string) => invoke<Status>('get_status', { repo }),
  stats: (repo: string, hashes: string[]) => invoke<Record<string, Stat>>('get_stats', { repo, hashes }),
  headState: (repo: string) => invoke<{ head: string | null; branch: string | null }>('head_state', { repo }),
  revParse: (repo: string, rev: string) => invoke<string | null>('rev_parse', { repo, rev }),
  backupFiles: (repo: string, paths: string[]) => invoke<string>('backup_files', { repo, paths }),
  restoreFiles: (repo: string, backup: string) => invoke<void>('restore_files', { repo, backup }),
  /** How far a local branch is ahead of and behind its upstream (or `against`); null with no upstream. */
  tracking: (repo: string, branch: string, against?: string) =>
    invoke<{ upstream: string; ahead: number; behind: number } | null>('branch_tracking', { repo, branch, against: against ?? null }),
  /** Where each repository stands (branch, changes, ahead and behind, last commit), checked side by side. */
  summaries: (paths: string[]) => invoke<RepoSummary[]>('repo_summaries', { paths }),
  /** Where HEAD has been, newest first; `lost` marks commits only the reflog still reaches. */
  reflog: (repo: string, limit = 200) => invoke<ReflogEntry[]>('get_reflog', { repo, limit }),
  /** The local branches, with whether each is merged, gone from the remote, or old: for Clean Up Branches. */
  branchCleanup: (repo: string) => invoke<BranchCleanup>('branch_cleanup', { repo }),
  /** The repository's main branch (`origin/HEAD`, else `main` or `master`). */
  defaultBranch: (repo: string) => invoke<string | null>('default_branch', { repo }),
  /** How `head` differs from `base`: its own commits, how far behind it is, and where the two split. */
  compare: (repo: string, base: string, head: string) => invoke<Comparison>('compare_refs', { repo, base, head }),
  packageReadme: (repo: string, name: string) => invoke<PackageReadme>('package_readme', { repo, name }),
  /** Applies a patch of some lines to the index (`cached`) or the working tree; `reverse` takes them back out. */
  applyPatch: (repo: string, patch: string, cached: boolean, reverse: boolean) => invoke<void>('apply_patch', { repo, patch, cached, reverse }),
  /** Watches a repository for changes made outside the app. "git" means commits, branches or the index changed. */
  watch: (repo: string, onChange: (kind: 'git' | 'tree') => void) => {
    const channel = new Channel<'git' | 'tree'>()
    channel.onmessage = onChange
    return invoke<number>('watch_repo', { repo, onChange: channel })
  },
  unwatch: (id: number) => invoke<void>('unwatch_repo', { id }),
  statusDiff: (repo: string, file: StatusFile, staged: boolean) =>
    invoke<string>('get_status_diff', { repo, path: file.path, oldPath: file.oldPath, staged, untracked: file.kind === 'untracked' }),
  listFiles: (repo: string, rev: string | null) => invoke<string[]>('list_files', { repo, rev }),
  /** New folders in the working tree, empty ones included. */
  listNewFolders: (repo: string) => invoke<string[]>('list_new_folders', { repo }),
  /** What .gitignore leaves out; an ignored folder is one entry ending in a slash. */
  listIgnored: (repo: string) => invoke<string[]>('list_ignored', { repo }),
  /** One folder's names, folders ending in a slash. */
  listDir: (repo: string, dir: string) => invoke<string[]>('list_dir', { repo, dir }),
  readFile: (repo: string, rev: string | null, path: string) => invoke<FileContent>('read_file', { repo, rev, path }),
  searchFiles: (repo: string, rev: string | null, query: string, regex: boolean, caseSensitive: boolean, paths: string[]) =>
    invoke<SearchResults>('search_files', { repo, rev, query, regex, caseSensitive, paths }),
  writeFile: (repo: string, path: string, contents: string) => invoke<void>('write_file', { repo, path, contents }),
  createFile: (repo: string, path: string) => invoke<void>('create_file', { repo, path }),
  createFolder: (repo: string, path: string) => invoke<void>('create_folder', { repo, path }),
  renamePath: (repo: string, from: string, to: string) => invoke<void>('rename_path', { repo, from, to }),
  /** Moves a file or folder to the Trash. */
  trashPath: (repo: string, path: string) => invoke<void>('trash_path', { repo, path }),
  fileHistory: (repo: string, rev: string | null, path: string) => invoke<Commit[]>('file_history', { repo, rev, path }),
  blame: (repo: string, rev: string | null, path: string) => invoke<Blame>('blame_file', { repo, rev, path }),
  rebaseCommits: (repo: string, base: string | null) => invoke<Commit[]>('rebase_commits', { repo, base }),
  interactiveRebase: (repo: string, base: string | null, todo: TodoItem[]) => invoke<string>('interactive_rebase', { repo, base, todo }),
}
