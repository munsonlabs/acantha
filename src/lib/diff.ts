export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'note'
  text: string
  oldNo?: number
  newNo?: number
}

export interface ParsedDiff {
  lines: DiffLine[]
  binary: boolean
  truncated: boolean
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseDiff(text: string, maxLines = 20_000): ParsedDiff {
  const lines: DiffLine[] = []
  let binary = false
  let inHunk = false
  let oldNo = 0
  let newNo = 0

  for (const raw of text.split('\n')) {
    if (lines.length >= maxLines) return { lines, binary, truncated: true }
    const hunk = HUNK.exec(raw)
    if (hunk) {
      inHunk = true
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      lines.push({ kind: 'hunk', text: raw })
    } else if (!inHunk) {
      if (raw.startsWith('Binary files')) binary = true
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
  return { lines, binary, truncated: false }
}
