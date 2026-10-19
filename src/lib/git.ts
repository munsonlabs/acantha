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

export interface LogOptions {
  limit: number
  branch: string | null
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
}
