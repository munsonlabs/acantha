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
