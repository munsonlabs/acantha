/** Repo tab colours, drawn from the graph's lane palette so they sit comfortably in the app. */
export const TAB_COLORS = [
  { name: 'Blue', value: '#6ea8e8' },
  { name: 'Violet', value: '#b98ce0' },
  { name: 'Green', value: '#6ec48f' },
  { name: 'Amber', value: '#e0b34d' },
  { name: 'Teal', value: '#5fc6cc' },
  { name: 'Red', value: '#e35d5d' },
  { name: 'Orange', value: '#f2a65a' },
  { name: 'Pink', value: '#e88fb4' },
] as const

/** A stable default for a repository, so it gets the same colour every time it's opened. */
export function autoTabColor(path: string): string {
  let h = 0
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TAB_COLORS[h % TAB_COLORS.length].value
}

/**
 * A colour for a repository opening alongside others: its usual pick unless another open tab already has it, in
 * which case the first colour nobody's using. Callers save the result, so the repo keeps it from then on.
 */
export function freshTabColor(path: string, taken: string[]): string {
  const preferred = autoTabColor(path)
  if (!taken.includes(preferred)) return preferred
  return TAB_COLORS.find((c) => !taken.includes(c.value))?.value ?? preferred
}

/** The colour to show: the one picked for this repository, none if that was chosen, or the automatic one. */
export function tabColor(path: string | null, picked: Record<string, string>): string | null {
  if (!path) return null
  const choice = picked[path]
  if (choice === 'none') return null
  return choice ?? autoTabColor(path)
}
