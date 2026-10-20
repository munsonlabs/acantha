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
  /** Opening a working-tree file goes straight to the editor (text files; others still preview). */
  editByDefault: usePersisted('edit-by-default', true),
  /** The card with a commit's details that appears when hovering a row in the graph. */
  hoverCards: usePersisted('hover-cards', true),
  /** Fade the graph while you're working elsewhere (pointer away, nothing in it focused). */
  dimIdleGraph: usePersisted('dim-idle-graph', false),
  /** The graph folded away, its place showing Acantha's mark, for more room around the terminal and panels. */
  graphCollapsed: usePersisted('graph-collapsed', false),
  /** Slack channel IDs whose messages and canvases may be opened. Empty allows any the token can see. */
  slackChannels: usePersisted<string[]>('slack-channels', []),
  /** The panel under the terminal (Slack and to-do tabs), and its share of that column's height when both show. */
  panelOpen: usePersisted('slack-open', false),
  panelHeight: usePersisted('slack-height', 0.45),
  /** Columns of the graph turned off from the header's right-click menu. */
  hiddenColumns: usePersisted<string[]>('hidden-columns', []),
  /** Column order dragged in the graph's header. Empty means the default. */
  columnOrder: usePersisted<string[]>('column-order', []),
  dateStyle: usePersisted<'relative' | 'absolute'>('date-style', 'relative'),
  /** Author pictures from GitHub and Gravatar. Gravatar gets a hash of the email, never the address. */
  avatars: usePersisted('avatars', true),
  terminalFontSize: usePersisted('terminal-font-size', 12.5),
  /** Lines each terminal keeps to scroll back through. Hidden terminals keep theirs, so this bounds their memory. */
  terminalScrollback: usePersisted('terminal-scrollback', 5000),
  /** Scale of the whole interface: 1 is 100%. */
  uiZoom: usePersisted('ui-zoom', 1),
  /** Tab colours picked per repository path. 'none' turns the colour off. */
  tabColors: usePersisted<Record<string, string>>('tab-colors', {}),
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
