/**
 * The search panel's "files to include" box: a comma- or space-separated list such as `ts, vue`, `*.test.ts`,
 * `src/` or `!*.lock`. A bare word is an extension, a pattern without a slash matches at any depth, a trailing slash
 * means everything under that folder, and `!` leaves matches out.
 */
export interface FileFilter {
  include: string[]
  exclude: string[]
}

function toGlob(term: string) {
  let t = term.trim()
  if (/^\.?[\w+-]+$/.test(t) && !t.includes('/')) t = `*.${t.replace(/^\./, '')}`
  if (t.endsWith('/')) t += '**'
  if (!t.includes('/')) t = `**/${t}`
  return t.replace(/^\/+/, '')
}

export function parseFileFilter(input: string): FileFilter {
  const filter: FileFilter = { include: [], exclude: [] }
  for (const raw of input.split(/[\s,]+/)) {
    if (!raw || raw === '!') continue
    if (raw.startsWith('!')) filter.exclude.push(toGlob(raw.slice(1)))
    else filter.include.push(toGlob(raw))
  }
  return filter
}

/** git pathspecs for `git grep -- …`. */
export function filterPathspecs({ include, exclude }: FileFilter) {
  return [...include.map((g) => `:(glob)${g}`), ...exclude.map((g) => `:(glob,exclude)${g}`)]
}

function globRegExp(glob: string) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      re += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

/** Whether a repo-relative path passes the filter, as git would decide it. */
export function fileFilterMatcher({ include, exclude }: FileFilter) {
  const inc = include.map(globRegExp)
  const exc = exclude.map(globRegExp)
  return (path: string) => (!inc.length || inc.some((r) => r.test(path))) && !exc.some((r) => r.test(path))
}
