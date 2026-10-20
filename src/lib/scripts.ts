import { invoke } from '@tauri-apps/api/core'

export interface Script {
  /** Vite+: the package for `package#task`, null for the workspace root. npm: the package.json's folder, '' at the root. */
  package: string | null
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
  return { dir: s.package ?? '', command: `npm run ${shellQuote(s.name)}` }
}

/** Identifies a script's terminal tab, so the list can show it's open there. */
export const scriptKey = (tool: Scripts['tool'], s: Script) => `${tool}:${s.package ?? ''}:${s.name}`
