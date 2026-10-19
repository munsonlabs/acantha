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
