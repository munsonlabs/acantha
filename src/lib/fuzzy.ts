/**
 * Scores how well `query` matches `text` as an in-order subsequence, case-insensitively. Higher is better and -1 is
 * no match. Runs of consecutive letters and matches at the start of words count for more; long texts count for less.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    const wordStart = found === 0 || /[\s/._-]/.test(t[found - 1])
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (wordStart ? 3 : 0)
    ti = found + 1
  }
  if (t.startsWith(q)) score += 6
  return score - t.length * 0.02
}

/** Where `query`'s letters fall in `text` (the same in-order match as `fuzzyScore`), for highlighting; null if none. */
export function fuzzyPositions(query: string, text: string): number[] | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const out: number[] = []
  let ti = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    out.push(found)
    ti = found + 1
  }
  return out
}

/**
 * Scores a file path for Go to File: a match in the file's own name counts for far more than one spread through its
 * folders, so `editor` finds `src/lib/editor.ts` before `src/editor-tools/x.ts`.
 */
export function fileScore(query: string, path: string): number {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const inName = fuzzyScore(query, name)
  const inPath = fuzzyScore(query, path)
  return inName >= 0 ? inName + 20 + Math.max(inPath, 0) * 0.1 : inPath
}
