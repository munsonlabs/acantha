export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'note'
  text: string
  oldNo?: number
  newNo?: number
  /** For a hunk header: where it starts on each side. */
  oldStart?: number
  newStart?: number
}

export interface ParsedDiff {
  lines: DiffLine[]
  binary: boolean
  truncated: boolean
  /** The file's header lines (`diff --git`, `index`, `---`, `+++`), which a patch built from the diff starts with. */
  header: string[]
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseDiff(text: string, maxLines = 20_000): ParsedDiff {
  const lines: DiffLine[] = []
  const header: string[] = []
  let binary = false
  let inHunk = false
  let oldNo = 0
  let newNo = 0

  for (const raw of text.split('\n')) {
    if (lines.length >= maxLines) return { lines, binary, truncated: true, header }
    const hunk = HUNK.exec(raw)
    if (hunk) {
      inHunk = true
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      lines.push({ kind: 'hunk', text: raw, oldStart: oldNo, newStart: newNo })
    } else if (!inHunk) {
      if (raw.startsWith('Binary files')) binary = true
      if (!lines.length && raw) header.push(raw)
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), newNo: newNo++ })
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++ })
    } else if (raw.startsWith(' ')) {
      lines.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
    } else if (raw.startsWith('\\')) {
      lines.push({ kind: 'note', text: raw.slice(2) })
    } else if (raw.startsWith('diff --git')) {
      // A rename with --no-index or multiple paths starts another file header.
      inHunk = false
    }
  }
  return { lines, binary, truncated: false, header }
}

/**
 * Whether parts of the file can be staged, unstaged or discarded line by line. A new, deleted or renamed file's
 * header describes the whole file, so taking only some of its lines would contradict it; those go as a whole.
 */
export function canPickLines(diff: ParsedDiff) {
  return (
    !diff.binary &&
    !diff.truncated &&
    diff.header.some((h) => h.startsWith('--- a/')) &&
    diff.header.some((h) => h.startsWith('+++ b/')) &&
    !diff.header.some((h) => /^(new|deleted) file mode|^rename (from|to)/.test(h))
  )
}

/**
 * A patch of just the chosen added and removed lines (by index into `diff.lines`), for `git apply`.
 *
 * Forward (staging into the index): a chosen line stays a change, an added line left out is dropped, and a removed
 * line left out stays as context, since it's still there. Reverse (unstaging, or discarding from the working tree,
 * applied with `-R`): the other way round, an added line left out stays as context and a removed one is dropped. Either
 * way the side being patched matches what's really there. Null when nothing chosen is a change.
 */
export function buildPatch(diff: ParsedDiff, chosen: Set<number>, reverse = false): string | null {
  const out = [...diff.header]
  // How far the side being written has drifted from the other, from the hunks written so far.
  let drift = 0
  let hunks = 0
  const lines = diff.lines
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]
    if (head.kind !== 'hunk') continue
    const body: string[] = []
    let oldCount = 0
    let newCount = 0
    let changes = 0
    // Whether the last line made it into the patch, for a "\\ No newline" note after it.
    let lastKept = false
    let j = i + 1
    for (; j < lines.length && lines[j].kind !== 'hunk'; j++) {
      const l = lines[j]
      const pick = chosen.has(j)
      if (l.kind === 'note') {
        if (lastKept) body.push(`\\ ${l.text}`)
        continue
      }
      const asContext = l.kind === 'ctx' || (!pick && ((l.kind === 'del' && !reverse) || (l.kind === 'add' && reverse)))
      lastKept = asContext || pick
      if (asContext) {
        body.push(` ${l.text}`)
        oldCount++
        newCount++
      } else if (pick) {
        body.push(`${l.kind === 'add' ? '+' : '-'}${l.text}`)
        if (l.kind === 'add') newCount++
        else oldCount++
        changes++
      }
    }
    i = j - 1
    if (!changes) continue
    // The side that's applied against keeps its own position; the other follows from the hunks before.
    const oldStart = reverse ? head.newStart! - drift : head.oldStart!
    const newStart = reverse ? head.newStart! : head.oldStart! + drift
    drift += newCount - oldCount
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body)
    hunks++
  }
  return hunks ? `${out.join('\n')}\n` : null
}
