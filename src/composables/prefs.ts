import { usePersisted } from './usePersisted'

/** App-wide preferences, shared by every workspace tab. */
export const prefs = {
  showRemotes: usePersisted('show-remotes', true),
  showStashes: usePersisted('show-stashes', true),
  recents: usePersisted<string[]>('recents', []),
  detailsHeight: usePersisted('details-height', 280),
  terminalWidth: usePersisted('terminal-width', 0.42),
  terminalOpen: usePersisted('terminal-open', true),
  sidebarWidth: usePersisted('sidebar-width', 300),
  sidebarOpen: usePersisted('sidebar-open', true),
  workspaces: usePersisted<string[]>('workspaces', []),
  editorVim: usePersisted('editor-vim', false),
  /** App used by "Open in Editor". Empty means the system default for the file type. */
  externalEditor: usePersisted('external-editor', ''),
}

export function addRecent(path: string) {
  prefs.recents.value = [path, ...prefs.recents.value.filter((r) => r !== path)].slice(0, 12)
}
