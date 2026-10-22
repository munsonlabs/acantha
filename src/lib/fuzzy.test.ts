import { describe, expect, it } from 'vite-plus/test'
import { fileScore, fuzzyPositions, fuzzyScore } from './fuzzy'

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

describe('fileScore', () => {
  const rank = (q: string, paths: string[]) => [...paths].sort((a, b) => fileScore(q, b) - fileScore(q, a))
  it('puts a match in the file name before one spread through folders', () => {
    expect(rank('editor', ['src/editor-tools/x.ts', 'src/lib/editor.ts'])[0]).toBe('src/lib/editor.ts')
    expect(rank('git', ['src/digital/index.ts', 'src/lib/git.ts'])[0]).toBe('src/lib/git.ts')
  })

  it('still finds a path by its folders', () => {
    expect(fileScore('libgit', 'src/lib/git.ts')).toBeGreaterThan(0)
    expect(fileScore('zzz', 'src/lib/git.ts')).toBe(-1)
  })
})

describe('fuzzyPositions', () => {
  it('gives where each letter matched, or null', () => {
    expect(fuzzyPositions('edt', 'editor.ts')).toEqual([0, 1, 3])
    expect(fuzzyPositions('ets', 'editor.ts')).toEqual([0, 3, 8])
    expect(fuzzyPositions('x', 'editor.ts')).toBeNull()
  })
})
