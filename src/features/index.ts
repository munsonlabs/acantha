import { prefs } from '@/composables/prefs'

/**
 * The optional features: everything beyond the graph, the Git panel, files, search, the editor, terminals and the
 * conflict resolver. Each can be switched off in Settings; then its code isn't loaded (each is its own lazily loaded
 * chunk), it drops out of menus, the palette and the panel's + menu, and nothing of it runs in the background. All are
 * on unless switched off, so a new one appears for everyone.
 *
 * A feature hooks in through the registries that take one (panel tabs in `panelTabs.ts`, commands' `feature`), and
 * otherwise by checking `isOn` where it adds to a core view.
 */
export type FeatureId =
  | 'slack'
  | 'todos'
  | 'notes'
  | 'scripts'
  | 'compare'
  | 'github'
  | 'markdown'
  | 'readme'
  | 'worktrees'
  | 'snake'
  | 'reflog'
  | 'changeMarkers'
  | 'dashboard'
  | 'tabSleep'
  | 'claude'

export interface Feature {
  id: FeatureId
  name: string
  description: string
}

export const FEATURES: Feature[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'A floating Claude Code pane for the open repository (⇧⌘I): replies as they’re written, approvals as cards.',
  },
  {
    id: 'tabSleep',
    name: 'Tab sleep',
    description: 'Put tabs to sleep (by hand, or after a while unused) to free their memory; they open again when clicked.',
  },
  {
    id: 'dashboard',
    name: 'Repository dashboard',
    description: 'On the new tab screen: each recent repository’s branch, changes, ahead and behind, and last commit.',
  },
  { id: 'changeMarkers', name: 'Change markers', description: 'Bars in the editor’s margin beside lines changed since the version git has.' },
  { id: 'worktrees', name: 'Worktrees', description: 'The Worktrees list in the Git panel, and checking branches out into new ones.' },
  { id: 'reflog', name: 'Reflog', description: 'A panel tab of everywhere HEAD has been, to get back commits a reset or rebase left behind.' },
  { id: 'compare', name: 'Compare branches', description: 'A panel tab comparing two branches: their commits and changed files.' },
  { id: 'github', name: 'GitHub', description: 'A panel tab for the branch’s pull request, its checks and Actions runs, through the gh CLI.' },
  { id: 'scripts', name: 'Scripts', description: 'A panel tab of the repository’s npm scripts and Vite+ tasks, to run in a terminal.' },
  { id: 'todos', name: 'To-do lists', description: 'Panel tabs of to-dos; pasting a bulleted list makes one.' },
  { id: 'notes', name: 'Notes', description: 'Markdown notepads in the panel.' },
  { id: 'markdown', name: 'Markdown preview', description: 'A repository Markdown file rendered in the panel, following your edits.' },
  { id: 'readme', name: 'Package READMEs', description: 'A package’s README in the panel, from node_modules or npm.' },
  { id: 'slack', name: 'Slack', description: 'Slack messages and canvases in the panel, from a pasted link.' },
  { id: 'snake', name: 'Commit Snake', description: 'A little game, from the collapsed graph and the new tab screen.' },
]

export const isOn = (id: FeatureId) => !prefs.disabledFeatures.value.includes(id)

export function setFeature(id: FeatureId, on: boolean) {
  const rest = prefs.disabledFeatures.value.filter((f) => f !== id)
  prefs.disabledFeatures.value = on ? rest : [...rest, id]
}
