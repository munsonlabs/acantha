import { resolveName } from './paths'

/** A file named in a line of terminal output, as columns in that line (end exclusive), with a line and column if given. */
export interface FileRef {
  start: number
  end: number
  path: string
  line?: number
  col?: number
}

/**
 * Paths with an extension, optionally followed by `:line`, `:line:col` or `(line,col)`: what compilers, test runners,
 * linters, git and Claude Code print. `./x`, `../x` and absolute paths too. Not preceded by a word character or a slash,
 * so a URL's path isn't picked out of the middle of it.
 */
const REF = /(?<![\w/.@~:-])((?:\.{1,2}\/|\/)?(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][\w]*)(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))?/g

export function findFileRefs(text: string): FileRef[] {
  const out: FileRef[] = []
  for (const m of text.matchAll(REF)) {
    // Part of a URL (`https://x.com/a.js`): the slashes before it are excluded above, but not the host.
    if (/:\/\/\S*$/.test(text.slice(0, m.index))) continue
    const line = m[2] ?? m[4]
    const col = m[3] ?? m[5]
    out.push({ start: m.index!, end: m.index! + m[0].length, path: m[1], line: line ? Number(line) : undefined, col: col ? Number(col) : undefined })
  }
  return out
}

/**
 * The repository file a printed path means, or null if there isn't one. Tried in turn: an absolute path inside the
 * repository; relative to the terminal's folder; relative to the top of the repository; and, for tools in a package
 * further down that print paths relative to it, the one file in the repository that ends with it.
 */
export function resolveFileRef(path: string, root: string, cwd: string, files: string[], known = new Set(files)): string | null {
  if (path.startsWith('/')) {
    if (!path.startsWith(`${root}/`)) return null
    const rel = path.slice(root.length + 1)
    return known.has(rel) ? rel : null
  }
  const here = cwd === root ? '' : cwd.startsWith(`${root}/`) ? cwd.slice(root.length + 1) : null
  if (here !== null) {
    const rel = resolveName(here, path)
    if (known.has(rel)) return rel
  }
  const top = resolveName('', path)
  if (known.has(top)) return top
  if (path.startsWith('.')) return null
  const ends = files.filter((f) => f.endsWith(`/${path}`))
  return ends.length === 1 ? ends[0] : null
}
