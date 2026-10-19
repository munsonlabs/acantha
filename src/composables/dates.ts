import { ref } from 'vue'
import { compactDate } from '@/lib/format'
import { prefs } from './prefs'

/** Ticks every minute so "5m ago" keeps up. */
const now = ref(Date.now())
setInterval(() => (now.value = Date.now()), 60_000)

export function relativeDate(seconds: number, nowMs = now.value) {
  const ago = nowMs / 1000 - seconds
  if (ago < 45) return 'just now'
  if (ago < 3600) return `${Math.round(ago / 60)}m ago`
  if (ago < 86_400) return `${Math.round(ago / 3600)}h ago`
  if (ago < 2 * 86_400) return 'yesterday'
  if (ago < 7 * 86_400) return `${Math.floor(ago / 86_400)}d ago`
  return compactDate(seconds)
}

/** The date style picked in settings. */
export const displayDate = (seconds: number) => (prefs.dateStyle.value === 'relative' ? relativeDate(seconds) : compactDate(seconds))
