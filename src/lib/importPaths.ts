import { resolveName } from './paths'

export interface ImportCandidate {
  /** What's inserted after the folder already typed: `utils/` for a folder, `format` for format.ts. */
  label: string
  folder: boolean
}

/** Extensions TypeScript and bundlers resolve by themselves, so imports usually leave them off. */
const IMPLIED = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

/**
 * The folder `@/` stands for, seen from `fromFile`: the nearest `src` folder above it, as Vite and Vue projects set it
 * up (in a monorepo, its own package's). None when there isn't one.
 */
function aliasRoot(fromFile: string, files: string[]) {
  const parts = fromFile.split('/').slice(0, -1)
  for (let i = parts.length; i >= 0; i--) {
    const src = [...parts.slice(0, i), 'src'].join('/')
    if (files.some((f) => f.startsWith(`${src}/`))) return src
  }
  return null
}

/**
 * The files and folders a path can point at from `fromFile`, given the folder part already typed (`./`, `../lib/`,
 * `@/components/`, …), from the repository's file list. In an import (`strip`), script files lose their extension
 * (`./format` for format.ts); otherwise, and for other files, it stays (`./App.vue`, `./logo.svg`). The file itself
 * isn't offered.
 */
export function importCandidates(fromFile: string, typedDir: string, files: string[], strip = true): ImportCandidate[] {
  let target: string
  if (typedDir.startsWith('@/')) {
    const root = aliasRoot(fromFile, files)
    if (root === null) return []
    target = resolveName(root, typedDir.slice(2))
  } else {
    const here = fromFile.split('/').slice(0, -1).join('/')
    // Climbing out of the repository leads nowhere it can list.
    const ups = (typedDir.match(/\.\.\//g) ?? []).length
    if (ups > here.split('/').filter(Boolean).length) return []
    target = typedDir === './' ? here : resolveName(here, typedDir)
  }
  const prefix = target ? `${target}/` : ''
  const seen = new Map<string, ImportCandidate>()
  for (const f of files) {
    if (!f.startsWith(prefix) || f === fromFile) continue
    const rest = f.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash !== -1) {
      const name = `${rest.slice(0, slash)}/`
      if (!name.startsWith('.') && !name.startsWith('node_modules')) seen.set(name, { label: name, folder: true })
    } else {
      const label = strip ? rest.replace(IMPLIED, '') : rest
      if (!seen.has(label)) seen.set(label, { label, folder: false })
    }
  }
  return [...seen.values()].sort((a, b) => Number(b.folder) - Number(a.folder) || a.label.localeCompare(b.label))
}

/**
 * The path being typed at the end of `before` (the line up to the cursor): one starting `./`, `../` or `@/`, just
 * after a quote or an opening bracket (`import('…`, `url(…`). `isImport` when it's what an import or require names.
 */
export function pathBeingTyped(before: string): { typed: string; isImport: boolean } | null {
  const m = before.match(/['"`(]((?:\.{1,2}|@)\/[^'"`\s()]*)$/)
  if (!m) return null
  const isImport = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`][^'"`]*$/.test(before)
  return { typed: m[1], isImport }
}
