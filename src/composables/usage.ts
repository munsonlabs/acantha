import { shallowRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { planLimits, type OpenCodeUsage, type PlanLimit } from '@/lib/usage'

/** Claude Code's plan limits and OpenCode's totals, shared by every view of them; `error` when they couldn't be had. */
export const claudeUsage = shallowRef<{ limits: PlanLimit[]; at: number } | { error: string; at: number } | null>(null)
export const openCodeUsage = shallowRef<{ stats: OpenCodeUsage; at: number } | { error: string; at: number } | null>(null)

/** How long usage is good for before it's asked for again. */
const FRESH = 60_000
let asking: Promise<void> | null = null

/** Asks Claude Code and OpenCode how much they've used, unless they were asked in the last minute (or `force`). */
export function refreshUsage(force = false) {
  const stale = (u: { at: number } | null) => force || !u || Date.now() - u.at > FRESH
  if (asking || (!stale(claudeUsage.value) && !stale(openCodeUsage.value))) return asking ?? Promise.resolve()
  asking = Promise.all([
    invoke<{ limits?: unknown[] }>('claude_usage').then(
      (r) => (claudeUsage.value = { limits: planLimits(r), at: Date.now() }),
      (e) => (claudeUsage.value = { error: String(e), at: Date.now() }),
    ),
    invoke<OpenCodeUsage>('opencode_usage').then(
      (stats) => (openCodeUsage.value = { stats, at: Date.now() }),
      (e) => (openCodeUsage.value = { error: String(e), at: Date.now() }),
    ),
  ]).then(() => {
    asking = null
  })
  return asking
}
