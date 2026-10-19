const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const sameYearFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const otherYearFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export const formatDate = (seconds: number) => dateFormat.format(new Date(seconds * 1000))

/** Short date for the commit list: the year only appears when it isn't this one. */
export function compactDate(seconds: number) {
  const date = new Date(seconds * 1000)
  return (date.getFullYear() === new Date().getFullYear() ? sameYearFormat : otherYearFormat).format(date)
}

export const shortHash = (hash: string) => hash.slice(0, 7)
export const basename = (path: string) =>
  path
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() ?? path

export function splitPath(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 1)).toUpperCase()
}

/** A stable hue per author, so the same person always gets the same avatar colour. */
export function nameHue(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

/**
 * Commit messages are hard-wrapped at about 72 columns by convention. This joins the lines of each paragraph so
 * the text flows to the width it's shown at, keeping blank lines, list items and indented (code) lines as they are.
 */
export function reflowMessage(text: string): string {
  const LIST = /^\s*([-*+•]|\d+[.)])\s/
  const TRAILER = /^[A-Za-z-]+-(by|to):/i
  const INDENTED = /^\s{2,}\S/
  const out: string[] = []
  for (const line of text.split('\n')) {
    const prev = out[out.length - 1]
    // An indented line continues a list item above it; otherwise it's probably code, so it stays put.
    const joins = !!line.trim() && !!prev?.trim() && !LIST.test(line) && !TRAILER.test(line) && (!INDENTED.test(line) || LIST.test(prev))
    if (joins && !(INDENTED.test(prev) && !LIST.test(prev))) out[out.length - 1] = `${prev} ${line.trim()}`
    else out.push(line)
  }
  return out.join('\n')
}
