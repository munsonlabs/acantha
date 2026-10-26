import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isOn, type FeatureId, setFeature } from '@/features'
import { prefs } from './prefs'
import { showToast } from './useToast'
import { ask } from './useDialog'
import { isPoppedOut, popOut } from './claudeWindow'
import { graphShowing, toggleGraph } from './center'
import { promptSlackLink, togglePanel } from './slackLinks'
import { useWorkspaces } from './workspace'

/** App-wide overlays opened by commands. */
export const overlays = {
  settings: ref(false),
  shortcuts: ref(false),
  palette: ref(false),
  /** What the palette is for: finding a file, running a command, or checking out a branch. */
  paletteMode: ref<'files' | 'commands' | 'branches'>('files'),
  /** The open-files switcher (⌘E). */
  openFiles: ref(false),
  /** Every tab, to search, for when there are too many to see. */
  tabList: ref(false),
}

export interface Command {
  id: string
  label: string
  group: string
  /** Shown in menus, the palette and the shortcuts sheet. */
  keys?: string
  run: () => unknown
  /** The optional feature it belongs to: while that's switched off, it's left out and does nothing. */
  feature?: FeatureId
}

/** The commands whose features are on, for the palette and the shortcuts sheet. */
export const enabledCommands = () => commands.filter((c) => !c.feature || isOn(c.feature))

const { workspaces, active, activate, addWorkspace, closeWorkspace, stepWorkspace, pickRepo, sleepOtherWorkspaces } = useWorkspaces()

function openPalette(mode: 'files' | 'commands' | 'branches') {
  overlays.paletteMode.value = mode
  overlays.palette.value = true
}

const inTerminal = () => !!document.activeElement?.closest('.terminal-pane')
const withRepo = (fn: (ws: NonNullable<typeof active.value>) => unknown) => () => {
  const ws = active.value
  if (ws?.repo.repo.value) return fn(ws)
}

function openFileSearch(ws: NonNullable<typeof active.value>) {
  if (ws.files.search.scope.value === 'names') ws.files.search.scope.value = 'all'
  ws.ui.sidebarTab.value = 'search'
  prefs.sidebarOpen.value = true
  ws.ui.focusFileSearch.value++
}

export const commands: Command[] = [
  {
    id: 'toggle-claude',
    label: 'Agents',
    group: 'View',
    keys: '⇧⌘I',
    feature: 'claude',
    // Shows the agents (starting one if there are none), or the agent's window when it's popped out; hides them again.
    run: withRepo((ws) => {
      const { tabs, active, add, show } = ws.agents
      if (!tabs.value.length) return void add()
      if (active.value && isPoppedOut(active.value.id)) return void popOut(active.value.id, ws.repo.repo.value!)
      if (prefs.agentsOpen.value) prefs.agentsOpen.value = false
      else show()
    }),
  },
  {
    id: 'toggle-ai',
    label: 'Turn AI Features On or Off',
    group: 'View',
    // Not a feature's own: it's how they're all switched.
    run: () => {
      const on = !isOn('claude')
      setFeature('claude', on)
      showToast(on ? 'AI features on' : 'AI features off: agents stopped, and none of it shows')
    },
  },
  {
    id: 'tour',
    label: 'Take a Tour of This Repository…',
    group: 'View',
    feature: 'claude',
    run: withRepo(async (ws) => {
      // One already planned carries on where it was; a new one can be about something in particular.
      const last = ws.tour.current()
      const v = await ask({
        title: 'Tour This Repository',
        message:
          'Claude Code reads the code, changing nothing, and plans the stops a newcomer should see, in order: the editor then walks you through them.',
        fields: [
          ...(last
            ? [
                {
                  name: 'again',
                  label: `Carry on with the last tour (stop ${last.at + 1} of ${last.stops.length})`,
                  type: 'checkbox' as const,
                  value: true,
                },
              ]
            : []),
          { name: 'focus', label: 'About anything in particular?', placeholder: 'e.g. how requests are handled (or leave empty)' },
        ],
        confirm: 'Start',
      })
      if (!v) return
      if (v.again) ws.tour.resume()
      else void ws.tour.start(String(v.focus ?? '').trim() || undefined)
    }),
  },
  { id: 'new-claude', label: 'New Claude Code Agent', group: 'View', feature: 'claude', run: withRepo((ws) => void ws.agents.add()) },
  {
    id: 'new-opencode-agent',
    label: 'New OpenCode Agent',
    group: 'View',
    feature: 'claude',
    run: withRepo((ws) => void ws.agents.add(undefined, 'opencode')),
  },
  {
    id: 'new-agent-worktree',
    label: 'New Agent in a Worktree…',
    group: 'View',
    feature: 'claude',
    run: withRepo((ws) => void ws.agents.addInWorktree()),
  },
  {
    id: 'show-agents',
    label: 'Show Agents in the Sidebar',
    group: 'View',
    feature: 'claude',
    run: withRepo((ws) => {
      ws.ui.sidebarTab.value = 'agents'
      prefs.sidebarOpen.value = true
    }),
  },
  { id: 'go-to-file', label: 'Go to File', group: 'General', keys: '⌘P', run: () => openPalette('files') },
  { id: 'palette', label: 'Command Palette', group: 'General', keys: '⇧⌘P', run: () => openPalette('commands') },
  { id: 'checkout-branch', label: 'Check Out Branch…', group: 'Repository', run: withRepo(() => openPalette('branches')) },
  { id: 'clean-up-branches', label: 'Clean Up Branches…', group: 'Repository', run: withRepo((ws) => (ws.ui.branchCleanup.value = true)) },
  { id: 'settings', label: 'Settings', group: 'General', keys: '⌘,', run: () => (overlays.settings.value = true) },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', group: 'General', keys: '⌘/', run: () => (overlays.shortcuts.value = true) },

  { id: 'new-tab', label: 'New Tab', group: 'Tabs', keys: '⌘T', run: () => addWorkspace() },
  { id: 'open-repo', label: 'Open Repository…', group: 'Tabs', keys: '⌘O', run: () => pickRepo() },
  {
    id: 'close',
    label: 'Close Tab',
    group: 'Tabs',
    keys: '⌘W',
    // In a terminal, ⌘W closes that terminal rather than the whole repository tab.
    run: () => (inTerminal() ? active.value?.terminals.closeActive() : active.value && closeWorkspace(active.value.id)),
  },
  { id: 'all-tabs', label: 'Show All Tabs', group: 'Tabs', run: () => (overlays.tabList.value = true) },
  {
    id: 'sleep-other-tabs',
    label: 'Put Other Tabs to Sleep',
    group: 'Tabs',
    feature: 'tabSleep',
    run: () => active.value && sleepOtherWorkspaces(active.value.id),
  },
  { id: 'next-tab', label: 'Next Tab', group: 'Tabs', keys: '⇧⌘]', run: () => stepWorkspace(1) },
  { id: 'prev-tab', label: 'Previous Tab', group: 'Tabs', keys: '⇧⌘[', run: () => stepWorkspace(-1) },

  {
    id: 'toggle-sidebar',
    label: 'Toggle Sidebar',
    group: 'View',
    keys: '⌘B · ⌃`',
    run: () => (prefs.sidebarOpen.value = !prefs.sidebarOpen.value),
  },
  { id: 'toggle-terminal', label: 'Toggle Terminal', group: 'View', keys: '⌘J', run: withRepo((ws) => ws.terminals.toggle()) },
  {
    id: 'toggle-right-panels',
    label: 'Toggle Terminal & Panels',
    group: 'View',
    keys: '⌃⇥',
    run: () => (prefs.rightPanelsOpen.value = !prefs.rightPanelsOpen.value),
  },
  {
    id: 'focus-center',
    label: 'Focus the Center',
    group: 'View',
    keys: '⌃Esc',
    // Only the sidebar and the right column: whatever's in the middle - the graph, a file, an agent - stays as it was.
    run: () => {
      prefs.sidebarOpen.value = false
      prefs.rightPanelsOpen.value = false
    },
  },
  { id: 'new-terminal', label: 'New Terminal', group: 'View', keys: '⌃⇧`', run: withRepo((ws) => ws.terminals.add()) },
  { id: 'split-terminal', label: 'Split Terminal', group: 'View', keys: '⌘D', run: withRepo((ws) => ws.terminals.split()) },
  { id: 'toggle-hover-cards', label: 'Toggle Commit Hover Cards', group: 'View', run: () => (prefs.hoverCards.value = !prefs.hoverCards.value) },
  { id: 'refresh', label: 'Refresh', group: 'View', keys: '⌘R', run: withRepo((ws) => ws.repo.reload()) },
  {
    id: 'find',
    label: 'Search Commits',
    group: 'View',
    keys: '⌘F',
    // The graph's hidden behind a file, agents or a panel: searching its commits wouldn't show anything, so this
    // searches files instead, same as ⇧⌘F.
    run: withRepo((ws) => (graphShowing(ws) ? document.querySelector<HTMLInputElement>('.titlebar .search input')?.select() : openFileSearch(ws))),
  },
  {
    id: 'search-files',
    label: 'Search in Files',
    group: 'View',
    keys: '⇧⌘F',
    run: withRepo(openFileSearch),
  },
  {
    id: 'search-file-names',
    label: 'Search File Names',
    group: 'View',
    keys: '⌥⌘F',
    run: withRepo((ws) => {
      ws.files.search.scope.value = 'names'
      ws.ui.sidebarTab.value = 'search'
      prefs.sidebarOpen.value = true
      ws.ui.focusFileSearch.value++
    }),
  },
  {
    id: 'open-slack-link',
    label: 'Open Slack Link…',
    group: 'View',
    keys: '⇧⌘L',
    feature: 'slack',
    run: () => active.value && promptSlackLink(active.value),
  },
  { id: 'open-files', label: 'Open Files', group: 'View', keys: '⌘E', run: withRepo(() => (overlays.openFiles.value = !overlays.openFiles.value)) },
  // The graph to the front, or collapsed when it already is.
  { id: 'toggle-graph', label: 'Toggle Graph', group: 'View', run: withRepo((ws) => toggleGraph(ws)) },
  { id: 'toggle-panel', label: 'Toggle Panel', group: 'View', run: () => active.value && togglePanel(active.value) },
  { id: 'new-todo-list', label: 'New To-do List', group: 'View', feature: 'todos', run: withRepo((ws) => ws.panel.addTodos('To-dos')) },
  { id: 'new-notes', label: 'New Notes', group: 'View', feature: 'notes', run: withRepo((ws) => ws.panel.addNotes()) },
  { id: 'scripts', label: 'Scripts', group: 'View', feature: 'scripts', run: withRepo((ws) => ws.panel.addScripts()) },
  { id: 'compare-branches', label: 'Compare Branches', group: 'View', feature: 'compare', run: withRepo((ws) => ws.panel.addCompare()) },
  { id: 'reflog', label: 'Reflog: Recover Lost Commits', group: 'Repository', feature: 'reflog', run: withRepo((ws) => ws.panel.addReflog()) },
  { id: 'github', label: 'GitHub: Pull Requests & Actions', group: 'View', feature: 'github', run: withRepo((ws) => ws.panel.addGithub()) },
  {
    id: 'toggle-remotes',
    label: 'Toggle Remote Branches',
    group: 'View',
    run: withRepo((ws) => ws.repo.setShowRemotes(!ws.repo.showRemotes.value)),
  },
  { id: 'toggle-stashes', label: 'Toggle Stashes', group: 'View', run: () => (prefs.showStashes.value = !prefs.showStashes.value) },
  { id: 'zoom-in', label: 'Zoom In', group: 'View', keys: '⌘+', run: () => stepZoom(1) },
  { id: 'zoom-out', label: 'Zoom Out', group: 'View', keys: '⌘−', run: () => stepZoom(-1) },
  { id: 'zoom-reset', label: 'Actual Size', group: 'View', keys: '⌘0', run: () => (prefs.uiZoom.value = 1) },

  { id: 'undo', label: 'Undo Last Git Action', group: 'Repository', run: withRepo((ws) => ws.repo.undoLast()) },
  { id: 'fetch', label: 'Fetch', group: 'Repository', run: withRepo((ws) => ws.menus.fetchAll()) },
  { id: 'pull', label: 'Pull', group: 'Repository', run: withRepo((ws) => ws.status.pull()) },
  { id: 'push', label: 'Push', group: 'Repository', run: withRepo((ws) => ws.status.push()) },
  {
    id: 'browse-files',
    label: 'Browse Files',
    group: 'Repository',
    run: withRepo((ws) => ws.browse(ws.files.rev.value)),
  },
  {
    id: 'source-control',
    label: 'Git Panel',
    group: 'Repository',
    run: withRepo((ws) => {
      ws.ui.sidebarTab.value = 'scm'
      prefs.sidebarOpen.value = true
    }),
  },
]

/** Interface size steps, like a browser's zoom levels. */
export const ZOOM_MIN = 0.8
export const ZOOM_MAX = 1.5
const ZOOM_STEP = 0.1

function stepZoom(direction: number) {
  const next = Math.round((prefs.uiZoom.value + direction * ZOOM_STEP) * 100) / 100
  prefs.uiZoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
}

const byId = new Map(commands.map((c) => [c.id, c]))
const lastRun = new Map<string, number>()

/**
 * Runs a command by id. The same keystroke can reach both the page and the native menu, so a repeat of the same
 * command within a moment is ignored rather than toggling something twice.
 */
export function runCommand(id: string) {
  const command = byId.get(id)
  if (!command || (command.feature && !isOn(command.feature))) return
  const now = Date.now()
  if (now - (lastRun.get(id) ?? 0) < 250) return
  lastRun.set(id, now)
  void command.run()
}

/** Tab switching by number isn't a command of its own: ⌘1–8 pick a tab, ⌘9 the last. */
export function activateTabNumber(n: number) {
  const target = n === 9 ? workspaces.value.at(-1) : workspaces.value[n - 1]
  if (target) activate(target.id)
}

/**
 * The menu bar is built natively, so it's told which commands to leave out: those of features switched off. At launch
 * it starts with everything, so it's only rebuilt when something is off.
 */
let menuHidden = ''
watch(
  () => commands.filter((c) => c.feature && !isOn(c.feature)).map((c) => c.id),
  (ids) => {
    const key = ids.join(',')
    if (key === menuHidden) return
    menuHidden = key
    void invoke('set_hidden_menu_items', { ids }).catch(() => {})
  },
  { immediate: true },
)
