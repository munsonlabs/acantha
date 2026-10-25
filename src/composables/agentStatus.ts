import { onScopeDispose, shallowRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { conversations } from './claude'
import { usePersisted } from './usePersisted'

/** What an agent's Claude is doing, from the backend (see `claude_statuses` in src-tauri/src/claude.rs). */
interface Activity {
  status: 'idle' | 'working' | 'waiting'
  /** Since when, in ms. */
  since: number
  /** When a reply last finished, in ms; 0 if none has. */
  finished: number
  /** Whether Claude's running for it: not before its first message, nor once it's asleep. */
  running: boolean
  /** What it's used since Acantha started. */
  usage: { cost: number; tokensIn: number; tokensOut: number }
}

/**
 * What an agent's up to, as the tabs and the sidebar show it: needs you (asking permission), working, done (finished a
 * reply you haven't looked at yet), idle, or off (not running: not started yet, or put to sleep).
 */
export type AgentState = 'waiting' | 'working' | 'done' | 'idle' | 'off'

const activity = shallowRef<Record<string, Activity>>({})
/** When each agent was last looked at, so a reply finished since then shows as done. Shared with popped-out windows. */
const seen = usePersisted<Record<string, number>>('agent-seen', {}, { sync: true })

let users = 0
let timer: ReturnType<typeof setInterval> | undefined
/** The usage last seen for each, so only what's new is added to its conversation's totals. */
const counted: Record<string, Activity['usage']> = {}
async function poll() {
  activity.value = await invoke<Record<string, Activity>>('claude_statuses').catch(() => activity.value)
  // What's been used since the last look goes on each conversation's totals, kept across restarts.
  let changed: Record<string, (typeof conversations.value)[string]> | null = null
  for (const [id, a] of Object.entries(activity.value)) {
    const was = counted[id] ?? { cost: 0, tokensIn: 0, tokensOut: 0 }
    counted[id] = a.usage
    const more = (k: keyof Activity['usage']) => Math.max(0, a.usage[k] - was[k])
    const c = conversations.value[id]
    if (!c || !(more('cost') || more('tokensIn') || more('tokensOut'))) continue
    changed ??= { ...conversations.value }
    changed[id] = {
      ...c,
      spent: (c.spent ?? 0) + more('cost'),
      tokensIn: (c.tokensIn ?? 0) + more('tokensIn'),
      tokensOut: (c.tokensOut ?? 0) + more('tokensOut'),
    }
  }
  if (changed) conversations.value = changed
}

/** Keeps the agents' activity up to date while something shows it: polled, as it's a cheap look at the backend. */
/**
 * Whether there's anything to look at: some agent's been running (or has a conversation open), the window's showing,
 * and, while every agent's idle or Acantha's not in front, only every few ticks, as nobody's watching closely.
 */
let tick = 0
function worthLooking() {
  tick++
  if (document.hidden) return false
  const any = Object.keys(activity.value).length > 0 || Object.values(conversations.value).some((c) => !c.closed)
  if (!any) return false
  // While nothing's working or waiting on you, a change is less likely: look half as often.
  const busy = Object.values(activity.value).some((a) => a.status === 'working' || a.status === 'waiting')
  return document.hasFocus() ? busy || tick % 2 === 0 : tick % 4 === 0
}

export function useAgentActivity() {
  if (users++ === 0) {
    void poll()
    timer = setInterval(() => worthLooking() && void poll(), 1500)
  }
  onScopeDispose(() => {
    if (--users === 0) clearInterval(timer)
  })
  return activity
}

export function agentState(id: string): AgentState {
  const a = activity.value[id]
  if (!a) return 'off'
  if (a.status === 'waiting') return 'waiting'
  if (a.status === 'working') return 'working'
  if (a.finished > (seen.value[id] ?? 0)) return 'done'
  return a.running ? 'idle' : 'off'
}

/** The agent's been looked at: a reply it finished is no longer news. (Written at most every few seconds.) */
export function markSeen(id: string) {
  if (Date.now() - (seen.value[id] ?? 0) > 3000) seen.value = { ...seen.value, [id]: Date.now() }
}

/** Forgets when agents were looked at, for ones that are gone. */
export function forgetSeen(ids: string[]) {
  const rest = { ...seen.value }
  for (const id of ids) delete rest[id]
  seen.value = rest
}

/** The most pressing of several agents' states, for a repository's tab. */
export function mostPressing(states: AgentState[]): AgentState {
  for (const s of ['waiting', 'working', 'done', 'idle'] as const) if (states.includes(s)) return s
  return 'off'
}

/** An agent's state in words, with how long it's been that way. */
export function stateWords(id: string, now = Date.now()) {
  const a = activity.value[id]
  const state = agentState(id)
  const mins = a ? Math.max(0, Math.round((now - a.since) / 60_000)) : 0
  const took = mins < 1 ? 'just now' : mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`
  if (state === 'waiting') return `Needs you · ${took}`
  if (state === 'working') return `Working · ${took}`
  if (state === 'done') return 'Done'
  if (state === 'idle') return 'Idle'
  return a?.finished ? 'Asleep' : 'Not started'
}

/** What an agent's used, all told (kept with its conversation), in words. */
export const usageOf = (id: string) => conversations.value[id] ?? {}
