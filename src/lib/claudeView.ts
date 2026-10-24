import type { Approval } from './claudeChat'
import type { IconName } from './icons'

/** What both Claude views (the panel's and the floating one) show the same way. */

export const MODES = [
  { id: 'auto', label: 'Auto', hint: 'Does what it judges safe without asking, as Claude Code’s auto mode; asks about the rest' },
  { id: 'plan', label: 'Plan', hint: 'Reads and plans; changes nothing' },
  { id: 'default', label: 'Ask', hint: 'Asks before running commands or editing files' },
  { id: 'acceptEdits', label: 'Edit files', hint: 'Edits files without asking; still asks before commands' },
] as const

export const MODELS = [
  { id: '', label: 'Default model' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
]

export const SUGGESTIONS = ['Explain how this repository is organised', 'Review my uncommitted changes', 'Find and fix a failing test']

export const TOOL_ICONS: Record<string, IconName> = {
  Bash: 'terminal',
  Read: 'file',
  Write: 'pencil',
  Edit: 'pencil',
  MultiEdit: 'pencil',
  Grep: 'search',
  Glob: 'files',
  WebFetch: 'cloud',
  WebSearch: 'search',
  TodoWrite: 'check',
}

/** An edit's change as a little diff: the old lines, then the new (or a new file's first lines). */
export function editDiff(input: Record<string, unknown>) {
  const lines = (s: unknown, sign: string) =>
    typeof s === 'string'
      ? s
          .split('\n')
          .slice(0, 14)
          .map((text) => ({ sign, text }))
      : []
  if (typeof input.old_string === 'string') return [...lines(input.old_string, '-'), ...lines(input.new_string, '+')]
  if (typeof input.content === 'string') return lines(input.content, '+')
  return []
}

/** What an approval is asking, in words. */
export function asking(a: Approval) {
  if (a.tool === 'Bash') return 'Run this command?'
  if (a.tool === 'Edit' || a.tool === 'MultiEdit') return 'Edit this file?'
  if (a.tool === 'Write') return 'Write this file?'
  return `Use ${a.tool}?`
}

/** A conversation's state in a couple of words. */
export const statusWords = (status: string) => (status === 'waiting' ? 'needs you' : status === 'working' ? 'working…' : 'ready')

export const costText = (cost: number) => (cost ? (cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`) : '')

/** When a past conversation was last carried on: the time today, the day before that. */
export function when(time: number, now = new Date()) {
  const d = new Date(time)
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * A conversation, kept so it can be carried on: after a restart, in its tab, or from the list of past ones once its tab
 * is closed. Claude Code keeps what was said (its session); this is which session, where, and what about.
 */
/** What runs an agent: Claude Code, or OpenCode. */
export type AgentKind = 'claude' | 'opencode'
export const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', opencode: 'OpenCode' }

export interface SavedConversation {
  repo: string
  /** What runs it; Claude Code when not said. */
  kind?: AgentKind
  /** Where it runs, when that's a worktree of the repository rather than the repository itself. */
  cwd?: string
  sessionId?: string
  /** What it's about: the first thing you said. */
  title?: string
  updated: number
  /** Its tab's gone; it's in the past ones. */
  closed?: boolean
  /** What it's used, all told: dollars (as Claude Code works them out, a subscription's included) and tokens. */
  spent?: number
  tokensIn?: number
  tokensOut?: number
}

/** Dollars and tokens, short: "$0.42 · 12k tokens". */
export function usageText(u: { spent?: number; tokensIn?: number; tokensOut?: number }) {
  const tokens = (u.tokensIn ?? 0) + (u.tokensOut ?? 0)
  if (!u.spent && !tokens) return ''
  const k = tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`
  return [u.spent ? costText(u.spent) : '', tokens ? `${k} tokens` : ''].filter(Boolean).join(' · ')
}

/** How long past conversations are kept, in days, and how many a repository; 0 for no limit. */
export interface Keep {
  days: number
  perRepo: number
}

/** Drops past conversations that are too old, or too many, so the list doesn't grow without end. */
export function prune(all: Record<string, SavedConversation>, keep: Keep, now = Date.now()) {
  const counts: Record<string, number> = {}
  const tooOld = (c: SavedConversation) => keep.days > 0 && now - c.updated > keep.days * 86_400_000
  const kept = Object.entries(all)
    .sort(([, a], [, b]) => b.updated - a.updated)
    .filter(([, c]) => {
      // An open tab where nothing's been said: it makes another when it's next shown.
      if (!c.closed) return !!c.sessionId || now - c.updated < 30 * 86_400_000
      if (!c.sessionId || tooOld(c)) return false
      counts[c.repo] = (counts[c.repo] ?? 0) + 1
      return !keep.perRepo || counts[c.repo] <= keep.perRepo
    })
  return Object.fromEntries(kept)
}
