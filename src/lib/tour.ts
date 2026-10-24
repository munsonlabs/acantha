/** A stop on a tour of a repository: a file, the lines to look at, and what to know about them. */
export interface Stop {
  title: string
  file: string
  start: number
  end: number
  note: string
}

/**
 * The stops in Claude's answer (a JSON array, perhaps with a fence or a word around it), kept to the ones that make
 * sense: a file that's in the repository, and lines that are numbers, in order.
 */
export function parseTour(answer: string, exists: (path: string) => boolean): Stop[] {
  const from = answer.indexOf('[')
  const to = answer.lastIndexOf(']')
  if (from === -1 || to <= from) return []
  let raw: unknown
  try {
    raw = JSON.parse(answer.slice(from, to + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const stops: Stop[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const file = typeof r?.file === 'string' ? r.file.replace(/^\.?\//, '') : ''
    if (!file || !exists(file)) continue
    const start = Math.max(1, Math.round(Number(r.start) || 1))
    const end = Math.max(start, Math.round(Number(r.end) || start))
    const text = (v: unknown, or: string) => (typeof v === 'string' ? v : or)
    stops.push({ title: text(r.title, file).slice(0, 120), file, start, end, note: text(r.note, '').slice(0, 1200) })
  }
  return stops
}
