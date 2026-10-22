/**
 * Which lines of a file have changed since `base` (the version git has), for the editor's change markers: added lines,
 * modified ones, and where lines were deleted. Line numbers are 1-based, in the current text.
 */
export interface LineChanges {
  added: number[]
  modified: number[]
  /** Lines were removed just after this one (0: before the first). */
  deletedAfter: number[]
}

/** Past this many differences the edit script isn't worth working out; the whole changed stretch shows as modified. */
const MAX_EDITS = 1500

type Op = '=' | '-' | '+'

/** Myers' diff of two lists of lines, as keep (=), delete (-) and insert (+) steps; null when they differ too much. */
function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length
  const m = b.length
  const off = n + m
  const v = new Int32Array(2 * off + 2)
  // Only the band of diagonals reached by each step is kept, so memory grows with the edits rather than the file.
  const trace: Int32Array[] = []
  for (let d = 0; d <= Math.min(off, MAX_EDITS); d++) {
    trace.push(v.slice(off - d, off + d + 1))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m, d)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], n: number, m: number, end: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = end; d > 0; d--) {
    const band = trace[d]
    const at = (k: number) => band[k + d]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('=')
      x--
      y--
    }
    ops.push(x === prevX ? '+' : '-')
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    ops.push('=')
    x--
    y--
  }
  return ops.reverse()
}

export function lineChanges(base: string, current: string): LineChanges {
  const out: LineChanges = { added: [], modified: [], deletedAfter: [] }
  if (base === current) return out
  const a = base.split('\n')
  const b = current.split('\n')
  // What's the same at both ends never needs diffing; most edits are in one place.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const ops = myers(a.slice(start, endA), b.slice(start, endB))
  if (!ops) {
    for (let line = start + 1; line <= endB; line++) out.modified.push(line)
    if (endB === start) out.deletedAfter.push(start)
    return out
  }
  // Walk the steps in runs of changes: a run with both deletions and insertions is a modification.
  let line = start // lines of the current text passed so far
  for (let i = 0; i < ops.length;) {
    if (ops[i] === '=') {
      line++
      i++
      continue
    }
    let dels = 0
    let adds = 0
    while (i < ops.length && ops[i] !== '=') {
      if (ops[i++] === '-') dels++
      else adds++
    }
    if (!adds) out.deletedAfter.push(line)
    for (let j = 1; j <= adds; j++) (dels ? out.modified : out.added).push(line + j)
    line += adds
  }
  return out
}
