import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/** Pull requests, checks and Actions runs, through the GitHub CLI (`gh`); see `src-tauri/src/github.rs`. */

export type CheckState = 'pass' | 'fail' | 'pending' | 'skipped'

export interface Check {
  name: string
  state: CheckState
  url: string | null
}

export interface PullRequest {
  number: number
  title: string
  url: string
  author: string
  isDraft: boolean
  state: string
  headRefName: string
  baseRefName: string
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or empty. */
  reviewDecision: string
  checks: Check[]
}

export interface Run {
  id: number
  title: string
  workflow: string
  branch: string
  event: string
  state: CheckState
  createdAt: string
  url: string
}

/** One entry of `statusCheckRollup`: a check run (Actions and apps) or an old-style commit status. */
type RawCheck =
  | { __typename: 'CheckRun'; name: string; status: string; conclusion: string; detailsUrl?: string; workflowName?: string }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl?: string }

function checkState(status: string, conclusion: string): CheckState {
  if (status && status !== 'COMPLETED') return 'pending'
  if (['SUCCESS', 'NEUTRAL'].includes(conclusion)) return 'pass'
  if (['SKIPPED', 'STALE'].includes(conclusion)) return 'skipped'
  return conclusion ? 'fail' : 'pending'
}

export function parseChecks(raw: RawCheck[] | null | undefined): Check[] {
  return (raw ?? []).map((c) =>
    c.__typename === 'StatusContext'
      ? {
          name: c.context,
          state: c.state === 'SUCCESS' ? 'pass' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'fail',
          url: c.targetUrl ?? null,
        }
      : { name: c.workflowName ? `${c.workflowName} / ${c.name}` : c.name, state: checkState(c.status, c.conclusion), url: c.detailsUrl ?? null },
  )
}

/** The checks as one state: any failure fails, then anything still going is pending. Null when there are none. */
export function overall(checks: Check[]): CheckState | null {
  const counted = checks.filter((c) => c.state !== 'skipped')
  if (!counted.length) return checks.length ? 'skipped' : null
  if (counted.some((c) => c.state === 'fail')) return 'fail'
  if (counted.some((c) => c.state === 'pending')) return 'pending'
  return 'pass'
}

/** How many Actions runs are going, by repository, for the GitHub tab's label. */
export const runningRuns = ref<Record<string, number>>({})

const PR_FIELDS = 'number,title,url,author,isDraft,state,headRefName,baseRefName,reviewDecision,statusCheckRollup'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPr(p: any): PullRequest {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    author: p.author?.login ?? '',
    isDraft: !!p.isDraft,
    state: p.state ?? 'OPEN',
    headRefName: p.headRefName ?? '',
    baseRefName: p.baseRefName ?? '',
    reviewDecision: p.reviewDecision ?? '',
    checks: parseChecks(p.statusCheckRollup),
  }
}

const gh = (repo: string, args: string[]) => invoke<string>('run_gh', { repo, args })

export const github = {
  /** The pull request for the checked-out branch, or null when it has none. */
  async currentPr(repo: string): Promise<PullRequest | null> {
    try {
      return toPr(JSON.parse(await gh(repo, ['pr', 'view', '--json', PR_FIELDS])))
    } catch (e) {
      if (/no pull requests found/i.test(String(e))) return null
      throw e
    }
  },
  async openPrs(repo: string): Promise<PullRequest[]> {
    return JSON.parse(await gh(repo, ['pr', 'list', '--limit', '30', '--json', PR_FIELDS])).map(toPr)
  },
  async runs(repo: string, branch?: string): Promise<Run[]> {
    const fields = 'databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url'
    const list = JSON.parse(await gh(repo, ['run', 'list', '--limit', '20', ...(branch ? ['--branch', branch] : []), '--json', fields]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return list.map((r: any) => ({
      id: r.databaseId,
      title: r.displayTitle,
      workflow: r.workflowName,
      branch: r.headBranch,
      event: r.event,
      state: checkState(String(r.status).toUpperCase(), String(r.conclusion ?? '').toUpperCase()),
      createdAt: r.createdAt,
      url: r.url,
    }))
  },
  /** Opens GitHub's new pull request form for the checked-out branch, in the browser. */
  createPr: (repo: string) => gh(repo, ['pr', 'create', '--web']),
}
