import { describe, expect, it } from 'vitest'
import { bytesText, levelOf, overall, verdict, type MemoryUse } from './memory'

const MB = 1024 * 1024
const use = (m: Partial<MemoryUse>): MemoryUse => ({ total: 0, app: 0, agents: 0, types: 0, terminals: 0, system: 32 * 1024 * MB, top: [], ...m })

describe('memory', () => {
  it('judges each part against its usual range', () => {
    expect(levelOf('app', 300 * MB)).toBe('good')
    expect(levelOf('app', 900 * MB)).toBe('fair')
    expect(levelOf('app', 2000 * MB)).toBe('high')
    // A terminal's share is what you're running: not judged.
    expect(levelOf('terminals', 9000 * MB)).toBeNull()
  })

  it('takes the worst part, or high past a quarter of the Mac', () => {
    expect(overall(use({ app: 300 * MB, total: 300 * MB }))).toBe('good')
    expect(overall(use({ app: 300 * MB, agents: 1500 * MB, total: 1800 * MB }))).toBe('fair')
    expect(overall(use({ app: 300 * MB, terminals: 9000 * MB, total: 9300 * MB }))).toBe('high')
  })

  it('says why in words', () => {
    expect(verdict(use({ app: 300 * MB, total: 300 * MB }))).toMatch(/Healthy/)
    expect(verdict(use({ app: 900 * MB, total: 900 * MB }))).toBe('Acantha and its windows above the usual 600 MB.')
    expect(bytesText(1536 * MB)).toBe('1.5 GB')
  })
})
