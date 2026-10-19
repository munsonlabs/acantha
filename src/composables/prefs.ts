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
  dateStyle: usePersisted<'relative' | 'absolute'>('date-style', 'relative'),
  /** Author pictures from GitHub and Gravatar. Gravatar gets a hash of the email, never the address. */
  avatars: usePersisted('avatars', true),
  terminalFontSize: usePersisted('terminal-font-size', 12.5),
  /** Scale of the whole interface: 1 is 100%. */
  uiZoom: usePersisted('ui-zoom', 1),
  /** Fetch every open repository in the background, every `autoFetchMinutes`. */
  autoFetch: usePersisted('auto-fetch', true),
  autoFetchMinutes: usePersisted('auto-fetch-minutes', 5),
  /** Shell for new terminals. Empty means the login shell. */
  shell: usePersisted('shell', ''),
  /** App used by "Open in Editor". Empty means the system default for the file type. */
  externalEditor: usePersisted('external-editor', ''),
}

export function addRecent(path: string) {
  prefs.recents.value = [path, ...prefs.recents.value.filter((r) => r !== path)].slice(0, 12)
}
