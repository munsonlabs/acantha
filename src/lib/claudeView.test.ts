import { describe, expect, it } from 'vite-plus/test'
import { prune, type SavedConversation } from './claudeView'

const day = 86_400_000
const now = 100 * day

describe('prune', () => {
  it('keeps open conversations, and past ones that are recent and few enough', () => {
    const all: Record<string, SavedConversation> = {
      open: { repo: '/r', sessionId: 's0', updated: 0 },
      idle: { repo: '/r', updated: 0 },
      old: { repo: '/r', sessionId: 's1', updated: now - 40 * day, closed: true },
      unsaid: { repo: '/r', updated: now, closed: true },
      recent: { repo: '/r', sessionId: 's2', updated: now - day, closed: true },
    }
    expect(Object.keys(prune(all, { days: 30, perRepo: 20 }, now)).sort()).toEqual(['open', 'recent'])
    // No limits: only the past one with nothing said goes.
    expect(Object.keys(prune(all, { days: 0, perRepo: 0 }, now)).sort()).toEqual(['old', 'open', 'recent'])
  })

  it('keeps at most twenty past ones a repository, the newest', () => {
    const all: Record<string, SavedConversation> = {}
    for (let i = 0; i < 25; i++) all[`c${i}`] = { repo: '/r', sessionId: `s${i}`, updated: now - i * 1000, closed: true }
    all.other = { repo: '/o', sessionId: 'x', updated: 0 + now - 30 * day + 1, closed: true }
    const kept = prune(all, { days: 30, perRepo: 20 }, now)
    expect(Object.keys(kept)).toHaveLength(21)
    expect(kept.c19).toBeDefined()
    expect(kept.c20).toBeUndefined()
  })
})
