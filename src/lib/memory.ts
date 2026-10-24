/**
 * Whether Acantha's memory is in its usual range, part by part (see `memory_use` in src-tauri/src/memory.rs). Each
 * part has a baseline of what's usual, and a level above which it's worth doing something about; a terminal's share
 * is whatever you're running there, so it's shown but not judged.
 */

export interface MemoryUse {
  total: number
  app: number
  agents: number
  types: number
  terminals: number
  system: number
  top: { pid: number; name: string; bytes: number; group: 'app' | 'agents' | 'types' | 'terminals' }[]
}

export type Level = 'good' | 'fair' | 'high'
export type Part = 'app' | 'agents' | 'types' | 'terminals'

const MB = 1024 * 1024

/** What's usual for each part, and when it's high: in bytes. */
export const BASELINES: Record<Exclude<Part, 'terminals'>, { usual: number; high: number; name: string }> = {
  app: { usual: 600 * MB, high: 1200 * MB, name: 'Acantha and its windows' },
  agents: { usual: 1024 * MB, high: 2560 * MB, name: 'Agents' },
  types: { usual: 800 * MB, high: 1536 * MB, name: 'TypeScript' },
}

export const levelOf = (part: Part, bytes: number): Level | null => {
  if (part === 'terminals') return null
  const b = BASELINES[part]
  return bytes <= b.usual ? 'good' : bytes <= b.high ? 'fair' : 'high'
}

/** All told: the worst of the parts, or high when it's more than a quarter of the Mac's memory. */
export function overall(m: MemoryUse): Level {
  const levels = (['app', 'agents', 'types'] as const).map((p) => levelOf(p, m[p]))
  if (levels.includes('high') || (m.system && m.total > m.system / 4)) return 'high'
  return levels.includes('fair') ? 'fair' : 'good'
}

export function bytesText(bytes: number) {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`
  return `${Math.round(bytes / MB)} MB`
}

/** The verdict in a sentence: all well, or which part's above its usual and what that is. */
export function verdict(m: MemoryUse): string {
  const above = (['app', 'agents', 'types'] as const).filter((p) => levelOf(p, m[p]) !== 'good')
  if (!above.length) {
    if (m.system && m.total > m.system / 4) return `More than a quarter of this Mac’s ${bytesText(m.system)}, mostly from terminals.`
    return 'Healthy: everything’s within its usual range.'
  }
  return above.map((p) => `${BASELINES[p].name} above the usual ${bytesText(BASELINES[p].usual)}.`).join(' ')
}
