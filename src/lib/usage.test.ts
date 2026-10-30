import { describe, expect, it } from 'vite-plus/test'
import { planLimits, resetsText } from './usage'

describe('planLimits', () => {
  it('names each limit and keeps its percent in range', () => {
    expect(
      planLimits({
        limits: [{ kind: 'weekly_all', group: 'weekly', percent: 9, resets_at: null }, { kind: 'session', percent: 140 }, { kind: 'broken' }],
      }).map((l) => [l.label, l.percent]),
    ).toEqual([
      ['This week (all models)', 9],
      ['Current session', 100],
    ])
    expect(planLimits(null)).toEqual([])
  })
})

describe('resetsText', () => {
  it('gives only the time for today', () => {
    const now = new Date(2026, 9, 30, 12)
    expect(resetsText(new Date(2026, 9, 30, 17, 49).toISOString(), now)).toMatch(/^resets \d/)
    expect(resetsText(new Date(2026, 10, 5, 3).toISOString(), now)).toMatch(/^resets \D/)
    expect(resetsText(null, now)).toBe('')
  })
})
