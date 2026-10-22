import { describe, expect, it } from 'vitest'
import { lineChanges } from './lineDiff'

const text = (...lines: (string | number)[]) => lines.join('\n')
const base = text(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)

describe('lineChanges', () => {
  it('finds nothing in an unchanged file', () => {
    expect(lineChanges(base, base)).toEqual({ added: [], modified: [], deletedAfter: [] })
  })

  it('marks added, modified and deleted lines', () => {
    expect(lineChanges(base, text(1, 2, 'new', 3, 4, 5, 6, 7, 8, 9, 10)).added).toEqual([3])
    expect(lineChanges(base, text(1, 2, 3, 'four', 5, 6, 7, 8, 9, 10)).modified).toEqual([4])
    expect(lineChanges(base, text(1, 2, 3, 6, 7, 8, 9, 10)).deletedAfter).toEqual([3])
    expect(lineChanges(base, text(2, 3, 4, 5, 6, 7, 8, 9, 10)).deletedAfter).toEqual([0])
  })

  it('handles several changes spread through the file', () => {
    const c = lineChanges(base, text('one', 2, 3, 4, 'extra', 5, 6, 7, 9, 10, 'end'))
    expect(c).toEqual({ added: [5, 11], modified: [1], deletedAfter: [8] })
  })

  it('stays correct on a big file edited at both ends', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`)
    const edited = [...big]
    edited[3] = 'changed'
    edited.splice(4990, 0, 'inserted')
    const c = lineChanges(big.join('\n'), edited.join('\n'))
    expect(c).toEqual({ added: [4991], modified: [4], deletedAfter: [] })
  })
})
