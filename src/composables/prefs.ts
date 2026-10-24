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
  /** The tab that was showing, the only one woken at launch; the others sleep until clicked. */
  activeWorkspace: usePersisted<string | null>('active-workspace', null),
  /** Put tabs to sleep after this many minutes unused; 0 never. */
  autoSleepMinutes: usePersisted('auto-sleep-minutes', 0),
  editorVim: usePersisted('editor-vim', false),
  /** Opening a working-tree file goes straight to the editor (text files; others still preview). */
  editByDefault: usePersisted('edit-by-default', true),
  /** The card with a commit's details that appears when hovering a row in the graph. */
  hoverCards: usePersisted('hover-cards', true),
  /** Fade the graph while you're working elsewhere (pointer away, nothing in it focused). */
  dimIdleGraph: usePersisted('dim-idle-graph', false),
  /** The graph folded away, its place showing Acantha's mark, for more room around the terminal and panels. */
  graphCollapsed: usePersisted('graph-collapsed', false),
  /** A popped-out Claude window: where it sits and its size, whether it floats over other apps; and how Claude works. */
  claudeOnTop: usePersisted('claude-on-top', true),
  /** One floating agent window at a time: popping out another swaps it in, the first going back to the panel. */
  agentOneWindow: usePersisted('agent-one-window', true),
  claudeRect: usePersisted<{ x: number; y: number; w: number; h: number } | null>('claude-rect', null),
  claudeMode: usePersisted<'auto' | 'plan' | 'default' | 'acceptEdits'>('claude-mode', 'auto'),
  claudeModel: usePersisted('claude-model', ''),
  /** The model OpenCode agents use (`provider/model`), or its own default when empty. */
  opencodeModel: usePersisted('opencode-model', ''),
  /** Agents' tool calls shown one by one; off, each reply folds them into a line of steps, opened one reply at a time. */
  agentSteps: usePersisted('agent-steps', true),
  /** How much a popped-out Claude dims the screen behind it while you're in it: 0 to leave it be. */
  claudeDim: usePersisted('claude-dim', 0.45),
  /** Past Claude conversations: kept this many days (0: for good) and at most this many a repository (0: any number). */
  claudeKeepDays: usePersisted('claude-keep-days', 30),
  claudeKeepPerRepo: usePersisted('claude-keep-per-repo', 20),
  /** Closing a repository's tab forgets its Claude conversations. */
  claudeForgetOnClose: usePersisted('claude-forget-on-close', true),
  /** Reopen a repository's terminal tabs (in their folders, with their names and splits) when it's opened again. */
  restoreTerminals: usePersisted('restore-terminals', true),
  /** Optional features switched off in Settings (see src/features); everything else is on. */
  disabledFeatures: usePersisted<string[]>('disabled-features', []),
  /** The file browser also lists what .gitignore leaves out (node_modules, build output), dimmed. */
  showIgnored: usePersisted('show-ignored', false),
  /** The best Commit Snake score, from the game where the collapsed graph was. */
  gameBest: usePersisted('game-best', 0),
  /** Commit Snake's mode: edges that wrap round, or classic, where they end the game; each has its own best. */
  gameClassic: usePersisted('game-classic', false),
  gameBestClassic: usePersisted('game-best-classic', 0),
  /** Merge conflicts: blocks that appear on the board as you go, ending the game if you hit one. */
  gameObstacles: usePersisted('game-obstacles', false),
  /** Best scores for each setup ("wrap", "classic+conflicts"…); gameBest and gameBestClassic are the older ones. */
  gameBests: usePersisted<Record<string, number>>('game-bests', {}),
  /** How fast Commit Snake starts; it speeds up from there with each commit. */
  gameSpeed: usePersisted<'slow' | 'normal' | 'fast'>('game-speed', 'normal'),
  /** Slack channel IDs whose messages and canvases may be opened. Empty allows any the token can see. */
  slackChannels: usePersisted<string[]>('slack-channels', []),
  /** The panel under the terminal (Slack and to-do tabs), and its share of that column's height when both show. */
  panelOpen: usePersisted('slack-open', false),
  panelHeight: usePersisted('slack-height', 0.45),
  /**
   * The Agents panel shown (while it has agents), and where: docked under the terminal, or expanded over the graph.
   * Hiding it keeps where it was, so showing it again puts it back there.
   */
  agentsOpen: usePersisted('agents-open', true),
  agentsExpanded: usePersisted('agents-expanded', false),
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
  /** Names given to repository tabs, by repository path, in place of the folder's name. */
  tabNames: usePersisted<Record<string, string>>('tab-names', {}),
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
