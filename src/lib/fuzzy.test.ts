import { describe, expect, it } from 'vite-plus/test'
import { fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('matches in-order letters only', () => {
    expect(fuzzyScore('tgl', 'Toggle Sidebar')).toBeGreaterThan(0)
    expect(fuzzyScore('xyz', 'Toggle Sidebar')).toBe(-1)
  })

  it('prefers prefixes, word starts and runs', () => {
    expect(fuzzyScore('fet', 'Fetch')).toBeGreaterThan(fuzzyScore('fet', 'Prefetch'))
    expect(fuzzyScore('vc', 'vite.config.ts')).toBeGreaterThan(fuzzyScore('vc', 'eventsvc'))
  })
})
