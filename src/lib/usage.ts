/** One of Claude Code's plan limits, from its `/usage`: how much of it's used, and when it starts over. */
export interface PlanLimit {
  label: string
  percent: number
  resetsAt: string | null
  /** Near or at the limit, as Claude Code judges it. */
  warn: boolean
}

/** OpenCode's totals over the last `days`, as `opencode stats` prints them. */
export interface OpenCodeUsage {
  days: number
  sessions: string
  messages: string
  cost: string
  input: string
  output: string
  cacheRead: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawLimit = any

function labelOf(l: RawLimit) {
  const model = l.scope?.model?.display_name
  if (l.kind === 'session' || l.group === 'session') return 'Current session'
  if (model) return `This week (${model})`
  if (l.group === 'weekly') return 'This week (all models)'
  return String(l.kind ?? 'Limit').replace(/_/g, ' ')
}

/** The limits in `/usage`'s report (its `rate_limits`), in the order it gives them. */
export function planLimits(rateLimits: { limits?: RawLimit[] } | null | undefined): PlanLimit[] {
  return (rateLimits?.limits ?? [])
    .filter((l) => typeof l?.percent === 'number')
    .map((l) => ({
      label: labelOf(l),
      percent: Math.max(0, Math.min(100, l.percent)),
      resetsAt: typeof l.resets_at === 'string' ? l.resets_at : null,
      warn: !!l.severity && l.severity !== 'normal',
    }))
}

/** When a limit starts over: the time if it's today, the day and time otherwise. */
export function resetsText(iso: string | null, now = new Date()) {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return `resets ${time}`
  return `resets ${at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`
}
