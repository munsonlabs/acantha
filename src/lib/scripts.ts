import { invoke } from '@tauri-apps/api/core'

export interface Script {
  /** Vite+ only: the package for `package#task`, null for the workspace root. */
  package: string | null
  /** The folder it belongs to, relative to the repository ('' for the root). */
  dir: string
  name: string
  command: string
}

export interface Scripts {
  tool: 'vp' | 'npm'
  scripts: Script[]
}

export const listScripts = (repo: string) => invoke<Scripts>('list_scripts', { repo })

/** Quotes text as one shell word, in single quotes (the same in zsh, bash and fish). */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** What a terminal tab types to run a script, and where: Vite+ tasks from the repository root, npm scripts in their folder. */
export function scriptRun(tool: Scripts['tool'], s: Script): { dir: string; command: string } {
  if (tool === 'vp') return { dir: '', command: `npx vp run ${shellQuote(s.package ? `${s.package}#${s.name}` : s.name)}` }
  return { dir: s.dir, command: `npm run ${shellQuote(s.name)}` }
}

/** Identifies a script's terminal tab, so the list can show it's open there. */
export const scriptKey = (tool: Scripts['tool'], s: Script) => `${tool}:${s.dir}:${s.name}`

export type ScriptRow = { kind: 'folder'; path: string; label: string; depth: number } | { kind: 'script'; script: Script; depth: number }

interface Folder {
  scripts: Script[]
  children: Map<string, Folder>
}

/**
 * The scripts as a folder tree, flattened into rows: the root's scripts first, then each folder (alphabetically) with
 * its scripts under it. A folder holding nothing but one other folder is shown together with it (`packages/web`), as
 * VS Code compacts folders. Folders whose path is in `collapsed` hide what's in them.
 */
export function scriptRows(scripts: Script[], collapsed: Set<string> = new Set()): ScriptRow[] {
  const root: Folder = { scripts: [], children: new Map() }
  for (const s of scripts) {
    let node = root
    for (const part of s.dir.split('/').filter(Boolean)) {
      let next = node.children.get(part)
      if (!next) node.children.set(part, (next = { scripts: [], children: new Map() }))
      node = next
    }
    node.scripts.push(s)
  }
  const rows: ScriptRow[] = []
  const walk = (folder: Folder, path: string, depth: number) => {
    for (const script of folder.scripts) rows.push({ kind: 'script', script, depth })
    for (const name of [...folder.children.keys()].sort((a, b) => a.localeCompare(b))) {
      let node = folder.children.get(name)!
      let label = name
      let full = path ? `${path}/${name}` : name
      while (!node.scripts.length && node.children.size === 1) {
        const [child, next] = [...node.children][0]
        label += `/${child}`
        full += `/${child}`
        node = next
      }
      rows.push({ kind: 'folder', path: full, label, depth })
      if (!collapsed.has(full)) walk(node, full, depth + 1)
    }
  }
  walk(root, '', 0)
  return rows
}
