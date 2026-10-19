import { invoke } from '@tauri-apps/api/core'

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
  statusDiff: (repo: string, file: StatusFile, staged: boolean) =>
    invoke<string>('get_status_diff', { repo, path: file.path, oldPath: file.oldPath, staged, untracked: file.kind === 'untracked' }),
  listFiles: (repo: string, rev: string | null) => invoke<string[]>('list_files', { repo, rev }),
  readFile: (repo: string, rev: string | null, path: string) => invoke<FileContent>('read_file', { repo, rev, path }),
  writeFile: (repo: string, path: string, contents: string) => invoke<void>('write_file', { repo, path, contents }),
  fileHistory: (repo: string, rev: string | null, path: string) => invoke<Commit[]>('file_history', { repo, rev, path }),
  blame: (repo: string, rev: string | null, path: string) => invoke<Blame>('blame_file', { repo, rev, path }),
  rebaseCommits: (repo: string, base: string | null) => invoke<Commit[]>('rebase_commits', { repo, base }),
  interactiveRebase: (repo: string, base: string | null, todo: TodoItem[]) => invoke<string>('interactive_rebase', { repo, base, todo }),
}
