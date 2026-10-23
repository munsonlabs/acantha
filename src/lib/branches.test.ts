import { describe, expect, it } from 'vitest'
import { staleBranches } from './branches'
import type { BranchState } from './git'

const day = 86_400
const now = 1000 * day
const branch = (name: string, b: Partial<BranchState>): BranchState => ({
  name,
  hash: name,
  subject: '',
  date: now - day,
  upstream: null,
  merged: false,
  gone: false,
  ahead: 0,
  ...b,
})

describe('staleBranches', () => {
  it('sorts branches by why they look done with, oldest first, and leaves live ones out', () => {
    const g = staleBranches(
      [
        branch('merged-new', { merged: true }),
        branch('merged-old', { merged: true, gone: true, date: now - 200 * day }),
        branch('squashed', { gone: true, ahead: 2 }),
        branch('forgotten', { date: now - 120 * day }),
        branch('live', {}),
      ],
      now,
    )
    expect(g.merged.map((b) => b.name)).toEqual(['merged-old', 'merged-new'])
    expect(g.gone.map((b) => b.name)).toEqual(['squashed'])
    expect(g.old.map((b) => b.name)).toEqual(['forgotten'])
  })
})
