import { describe, expect, it } from 'vitest'
import type { Commit } from './git'
import { layoutGraph } from './graph'

const commit = (hash: string, ...parents: string[]): Commit => ({ hash, parents, author: '', email: '', date: 0, subject: hash })

// m merges feature (f2, f1) into main (a3, a2, a1); a side branch b1 runs alongside off a1.
const history = [
  commit('m', 'a3', 'f2'),
  commit('b1', 'a1'),
  commit('a3', 'a2'),
  commit('f2', 'f1'),
  commit('a2', 'a1'),
  commit('f1', 'a1'),
  commit('a1', 'r'),
  commit('r'),
]

describe('layoutGraph', () => {
  it('draws a lane running straight down as one line', () => {
    const layout = layoutGraph([commit('c3', 'c2'), commit('x', 'c1'), commit('c2', 'c1'), commit('y', 'c1'), commit('c1')])
    // c3's lane runs straight from row 0 to c2 at row 2: one edge, not one per row.
    expect(layout.edges.filter((e) => e.c1 === 0 && e.c2 === 0 && e.r1 === 0)).toEqual([{ c1: 0, r1: 0, c2: 0, r2: 2, color: 0, dashed: false }])
  })

  it('trails lanes still waiting for a parent off the bottom', () => {
    const layout = layoutGraph(history.slice(0, 3))
    expect(layout.tail.map((e) => e.r2)).toEqual([2.5, 2.5, 2.5])
  })

  it('gives the same layout carrying on from a previous page as starting over', () => {
    const whole = layoutGraph(history)
    for (let split = 1; split < history.length; split++) {
      const resumed = layoutGraph(history, layoutGraph(history.slice(0, split)))
      expect(resumed.nodes).toEqual(whole.nodes)
      expect(resumed.edges).toEqual(whole.edges)
      expect(resumed.tail).toEqual(whole.tail)
      expect(resumed.width).toBe(whole.width)
    }
  })

  it('starts over when the earlier rows changed', () => {
    const before = layoutGraph(history.slice(0, 4))
    const changed = [commit('n', 'm'), ...history]
    expect(layoutGraph(changed, before)).toEqual(layoutGraph(changed))
  })

  it('leaves the layout it carried on from as it was', () => {
    const page = layoutGraph(history.slice(0, 3))
    const snapshot = JSON.parse(JSON.stringify(page))
    layoutGraph(history, page)
    expect(JSON.parse(JSON.stringify(page))).toEqual(snapshot)
  })
})
