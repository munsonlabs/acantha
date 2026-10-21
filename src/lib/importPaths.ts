import { resolveName } from './paths'

export interface ImportCandidate {
  /** What's inserted after the folder already typed: `utils/` for a folder, `format` for format.ts. */
  label: string
  folder: boolean
}

/** Extensions TypeScript and bundlers resolve by themselves, so imports usually leave them off. */
const IMPLIED = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

/**
 * The files and folders an import can point at from `fromFile`, given the folder part already typed (`./`,
 * `../lib/`, …), from the repository's file list. Script files lose their extension (`./format` for format.ts);
 * others keep it (`./App.vue`, `./logo.svg`). The file itself isn't offered.
 */
export function importCandidates(fromFile: string, typedDir: string, files: string[]): ImportCandidate[] {
  const here = fromFile.split('/').slice(0, -1).join('/')
  // Climbing out of the repository leads nowhere it can list.
  const ups = (typedDir.match(/\.\.\//g) ?? []).length
  if (ups > here.split('/').filter(Boolean).length) return []
  const target = typedDir === './' ? here : resolveName(here, typedDir)
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
      const label = rest.replace(IMPLIED, '')
      if (!seen.has(label)) seen.set(label, { label, folder: false })
    }
  }
  return [...seen.values()].sort((a, b) => Number(b.folder) - Number(a.folder) || a.label.localeCompare(b.label))
}
