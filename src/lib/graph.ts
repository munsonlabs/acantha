import { UNCOMMITTED, type Commit } from './git'

export const ROW_H = 32
export const COL_W = 18
export const PAD_X = 16
export const NODE_R = 5

const PALETTE = ['#6ea8e8', '#b98ce0', '#6ec48f', '#e0b34d', '#5fc6cc', '#e35d5d', '#8dbcf2', '#cba5ee', '#85d9a4', '#eec469', '#7bdbe0', '#f27f7f']
const UNCOMMITTED_COLOR = '#6e6e6e'

export const colorFor = (i: number) => (i < 0 ? UNCOMMITTED_COLOR : PALETTE[i % PALETTE.length])
export const nodeX = (col: number) => PAD_X + col * COL_W
export const rowY = (row: number) => row * ROW_H + ROW_H / 2

export interface GraphNode {
  col: number
  color: number
}

/** A line between two rows, in column/row units. */
export interface GraphEdge {
  c1: number
  r1: number
  c2: number
  r2: number
  color: number
  dashed: boolean
}

export interface GraphLayout {
  nodes: GraphNode[]
  /** Lines between loaded rows. A lane running straight down is one edge however many rows it spans. */
  edges: GraphEdge[]
  /** Lines from the last row trailing off the bottom, for lanes whose parents haven't been loaded yet. */
  tail: GraphEdge[]
  width: number
  /** Where the layout stopped, so rows added below can continue it (see `layoutGraph`'s `previous`). */
  state: LayoutState
}

/** A column waiting for `hash` to appear further down. `from` is where its line left the previous row, `start` the row its current straight run began on. */
interface Lane {
  hash: string
  color: number
  from: number
  start: number
  dashed: boolean
}

/** A merge line from a commit into a lane that was already waiting for the same parent. */
interface Join {
  from: number
  hash: string
  color: number
}

interface LayoutState {
  commits: Commit[]
  lanes: (Lane | null)[]
  joins: Join[]
  nextColor: number
  maxCols: number
}

const freeSlot = (lanes: (Lane | null)[], start: number) => {
  for (let i = start; i < lanes.length; i++) if (!lanes[i]) return i
  return Math.max(start, lanes.length)
}

const same = (a: Commit, b: Commit) => a.hash === b.hash && a.parents.length === b.parents.length && a.parents.every((p, i) => p === b.parents[i])

/** Whether `commits` begins with every commit `previous` was laid out from, so it can carry on from there. */
const startsWith = (commits: Commit[], previous: Commit[]) => commits.length >= previous.length && previous.every((c, i) => same(c, commits[i]))

/**
 * Assigns every commit a column and works out the lines between rows. Commits must be in child-before-parent order.
 * Given the layout of a list `commits` starts with (a page loaded before this one), only the rows after it are worked out.
 */
export function layoutGraph(commits: Commit[], previous?: GraphLayout | null): GraphLayout {
  const resume = previous && previous.state.commits.length && startsWith(commits, previous.state.commits) ? previous : null
  // Lanes are changed in place below, so a resumed layout works on copies, leaving the previous one as it was.
  let lanes: (Lane | null)[] = resume ? resume.state.lanes.map((l) => l && { ...l }) : []
  let joins: Join[] = resume ? [...resume.state.joins] : []
  let nextColor = resume?.state.nextColor ?? 0
  let maxCols = resume?.state.maxCols ?? 1
  const nodes: GraphNode[] = resume ? [...resume.nodes] : []
  const edges: GraphEdge[] = resume ? [...resume.edges] : []

  for (let i = nodes.length; i < commits.length; i++) {
    const c = commits[i]
    let col = lanes.findIndex((l) => l?.hash === c.hash)
    const incoming = col === -1 ? null : lanes[col]
    if (col === -1) col = freeSlot(lanes, 0)
    const pseudo = c.hash === UNCOMMITTED
    const color = pseudo ? -1 : incoming && !incoming.dashed ? incoming.color : nextColor++

    // Every waiting lane draws down into this row, converging on the commit if it was waiting for it. A lane that
    // carries straight on just lengthens its run; the run is drawn once it bends or ends.
    lanes.forEach((l, j) => {
      if (!l) return
      const ends = l.hash === c.hash
      const target = ends ? col : j
      if (target === l.from && !ends) return
      const line = { color: l.color, dashed: l.dashed }
      if (target === l.from) {
        edges.push({ c1: l.from, r1: l.start, c2: target, r2: i, ...line })
        return
      }
      if (l.start < i - 1) edges.push({ c1: l.from, r1: l.start, c2: l.from, r2: i - 1, ...line })
      edges.push({ c1: l.from, r1: i - 1, c2: target, r2: i, ...line })
      l.from = target
      l.start = i
    })
    for (const join of joins) {
      const target = join.hash === c.hash ? col : lanes.findIndex((l) => l?.hash === join.hash)
      if (target !== -1) edges.push({ c1: join.from, r1: i - 1, c2: target, r2: i, color: join.color, dashed: false })
    }
    joins = []
    for (let j = 0; j < lanes.length; j++) if (lanes[j]?.hash === c.hash) lanes[j] = null
    nodes.push({ col, color })

    c.parents.forEach((parent, k) => {
      if (k === 0) {
        lanes[col] = { hash: parent, color, from: col, start: i, dashed: pseudo }
        return
      }
      const existing = lanes.findIndex((l) => l?.hash === parent)
      if (existing !== -1) {
        joins.push({ from: col, hash: parent, color: lanes[existing]!.color })
        return
      }
      lanes[freeSlot(lanes, col + 1)] = { hash: parent, color: nextColor++, from: col, start: i, dashed: false }
    })

    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop()
    maxCols = Math.max(maxCols, lanes.length, col + 1)
  }

  // Lanes whose parents haven't been loaded yet trail off the bottom.
  const last = commits.length - 1
  const tail: GraphEdge[] = []
  lanes.forEach((l, j) => {
    if (l) tail.push({ c1: l.from, r1: l.start, c2: j, r2: last + 0.5, color: l.color, dashed: l.dashed })
  })

  return { nodes, edges, tail, width: PAD_X * 2 + (maxCols - 1) * COL_W, state: { commits, lanes, joins, nextColor, maxCols } }
}

export function edgePath({ c1, r1, c2, r2 }: GraphEdge) {
  const x1 = nodeX(c1)
  const y1 = rowY(r1)
  const x2 = nodeX(c2)
  const y2 = rowY(r2)
  if (x1 === x2) return `M${x1} ${y1}V${y2}`
  const ym = (y1 + y2) / 2
  return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`
}
