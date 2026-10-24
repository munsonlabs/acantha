import { computed, effectScope, inject, provide, shallowRef, watch, type InjectionKey } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { createDetails } from './details'
import { createFiles } from './files'
import { createUi } from './ui'
import { createDiff } from './diff'
import { createMenus } from './menus'
import { createAgents, forgetAgents } from './agents'
import { agentState } from './agentStatus'
import { createPanel } from './panel'
import { createTour } from './tour'
import { prefs } from './prefs'
import { createRepo } from './repo'
import { createReveal } from './reveal'
import { createSearch } from './search'
import { createStatus } from './status'
import { createTerminals } from './terminals'
import { createWatcher } from './watcher'
import { usePersisted } from './usePersisted'
import { confirmAction } from './useDialog'
import { showToast } from './useToast'
import type { OpenFile, PreviewView } from './files'

/** Each repository's open files and the one showing, so they come back after a restart or a tab's sleep. */
const savedFiles = usePersisted<Record<string, { files: OpenFile[]; showing?: { path: string; rev: string | null; view: PreviewView } }>>(
  'open-files',
  {},
)

let nextGen = 1

/**
 * Everything belonging to one top-level tab: a repository's graph and the terminals beside it. `asleep`: a repository
 * this tab will open when it's next shown, holding nothing else until then (see `sleepWorkspace`).
 */
function createWorkspace(id: number, asleep: string | null = null) {
  const scope = effectScope(true)
  const parts = scope.run(() => {
    const repo = createRepo()
    const reveal = createReveal()
    const diff = createDiff(repo)
    const ui = createUi()
    const files = createFiles(repo)
    // Opening a commit's files switches the sidebar to the file browser.
    const browse = (rev: string | null) => {
      files.browse(rev)
      ui.sidebarTab.value = 'files'
      prefs.sidebarOpen.value = true
    }
    const agents = createAgents(repo)
    const status = createStatus(repo)
    createWatcher(repo, async () => {
      files.diskChanged.value++
      await status.refresh()
    })
    return {
      repo,
      reveal,
      ui,
      files,
      browse,
      details: createDetails(repo, reveal),
      search: createSearch(repo, reveal),
      diff,
      status,
      menus: createMenus(repo, {
        browse,
        rebaseFrom: (base, label) => (ui.rebase.value = { base, label }),
        openWorktree: (path) => void showRepo(path),
        closeWorktree: closeRepo,
        askAgent: (text) => void agents.askAgent(text),
      }),
      terminals: createTerminals(repo),
      panel: createPanel(repo),
      agents,
      tour: createTour(repo, files),
    }
  })!
  // Kept as they change, for the next time this repository opens.
  scope.run(() =>
    watch(
      () => [parts.repo.repo.value, parts.files.openFiles.value, parts.files.preview.value] as const,
      ([path, files, showing], [before]) => {
        // Opening a repository clears its files first; that's not something to remember.
        if (!path || path !== before) return
        savedFiles.value = {
          ...savedFiles.value,
          [path]: {
            files: JSON.parse(JSON.stringify(files)),
            showing: showing ? { path: showing.path, rev: showing.rev, view: showing.view } : undefined,
          },
        }
      },
      { deep: true },
    ),
  )
  return {
    id,
    /** Changes when a tab sleeps or wakes, so its view is made afresh. */
    gen: nextGen++,
    scope,
    /** The repository a sleeping tab will open when it's next shown; null while it's awake. */
    sleeping: shallowRef<string | null>(asleep),
    ...parts,
  }
}

/** The repository a tab is for, awake or asleep. */
export const pathOf = (ws: Workspace) => ws.repo.repo.value ?? ws.sleeping.value

/** Brings back a repository's open files and the file that was showing, as they were last time. */
async function restoreFiles(ws: Workspace) {
  const path = ws.repo.repo.value
  const saved = path ? savedFiles.value[path] : undefined
  if (!saved || ws.files.openFiles.value.length) return
  ws.files.openFiles.value = saved.files
  if (saved.showing) await ws.files.open(saved.showing.path, saved.showing.view, saved.showing.rev)
}

export type Workspace = ReturnType<typeof createWorkspace>

const KEY: InjectionKey<Workspace> = Symbol('workspace')
export const provideWorkspace = (ws: Workspace) => provide(KEY, ws)
export const useWorkspace = () => inject(KEY)!

const workspaces = shallowRef<Workspace[]>([])
const activeId = shallowRef(0)
let nextId = 1

const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) ?? null)

// Remember which repositories were open, and which was showing, so the tabs come back on the next launch.
watch(
  () => workspaces.value.map((w) => pathOf(w)),
  (paths) => {
    prefs.workspaces.value = paths.filter((p): p is string => !!p)
  },
)
watch(active, (ws) => {
  const path = ws && pathOf(ws)
  if (path) prefs.activeWorkspace.value = path
})

/** When each tab was last showing, for the tab list's order and for putting unused tabs to sleep. */
export const lastUsed = new Map<number, number>()

function activate(id: number) {
  if (activeId.value !== id) lastUsed.set(activeId.value, Date.now())
  activeId.value = id
  lastUsed.set(id, Date.now())
  const ws = active.value
  if (ws?.sleeping.value) void wake(ws)
  else void ws?.repo.reload()
}

/**
 * Opens a repository in a new tab. asleep: only its name shows until it's clicked, for the tabs brought back at launch
 * other than the one that was showing.
 */
async function addWorkspace(path: string | null = null, { quiet = false, activate: focus = true, asleep = false } = {}) {
  const ws = createWorkspace(nextId++, asleep ? path : null)
  workspaces.value = [...workspaces.value, ws]
  if (focus) activeId.value = ws.id
  if (path && !asleep && (await ws.repo.openRepo(path, { quiet }))) {
    if (prefs.terminalOpen.value) ws.terminals.restoreOrAdd()
    await restoreFiles(ws)
  }
  return ws
}

/**
 * Puts a tab to sleep: its graph, files, status, watcher, editor and terminals are let go, leaving only its name in
 * the tab bar until it's clicked. Unsaved edits stay with it; open files come back when it wakes, and its terminals
 * too (as fresh shells) with Settings → Terminal → Reopen terminals on.
 */
async function sleepWorkspace(id: number, { ask = true } = {}) {
  const i = workspaces.value.findIndex((w) => w.id === id)
  const ws = workspaces.value[i]
  const path = ws?.repo.repo.value
  if (!ws || !path || id === activeId.value) return
  // Idle shells come back as they were; only something running in one would be lost.
  const running = ask ? await ws.terminals.checkRunning() : []
  if (running.length && !(await confirmAction('Put Tab to Sleep', `${stops(running)} Open files and unsaved edits stay.`, 'Sleep'))) return
  // Its agents sleep too, unless one's working or waiting for you: their processes go, their conversations stay.
  for (const t of ws.agents.tabs.value)
    if (!['working', 'waiting'].includes(agentState(t.id))) void invoke('claude_stop', { id: t.id }).catch(() => {})
  const next = createWorkspace(id, path)
  next.files.drafts.value = ws.files.drafts.value
  workspaces.value = workspaces.value.map((w) => (w.id === id ? next : w))
  ws.scope.stop()
  stopTypes(path)
}

/** A repository's TypeScript (see tsserver.rs) stops with the last tab showing it: it takes a fair bit of memory. */
function stopTypes(path: string | null) {
  if (path && !workspaces.value.some((w) => w.repo.repo.value === path)) void invoke('ts_stop', { repo: path }).catch(() => {})
}

/** What closing terminals would stop, said plainly: "`npm run dev` is running and will stop." */
function stops(running: string[]) {
  const list = running.map((r) => `\`${r}\``)
  const named = list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.join(list.length === 2 ? ' and ' : ', ')
  return `${named} ${running.length === 1 ? 'is' : 'are'} running in its terminals and will stop.`
}

/** Wakes a sleeping tab: opens its repository again, with its open files, unsaved edits and terminals. */
async function wake(ws: Workspace) {
  const path = ws.sleeping.value
  if (!path) return
  ws.sleeping.value = null
  // Opening a repository starts its files afresh, so the edits it held while asleep are put back after.
  const drafts = ws.files.drafts.value
  if (!(await ws.repo.openRepo(path, { quiet: true }))) return void closeWorkspace(ws.id)
  ws.files.drafts.value = drafts
  if (prefs.terminalOpen.value) ws.terminals.restoreOrAdd()
  await restoreFiles(ws)
}

/**
 * A repository no tab shows any more: its Claude conversations, open and past, are forgotten, so they don't pile up.
 * Claude Code keeps the sessions themselves (`claude --resume`).
 */
function forgetClosed(closed: Workspace[]) {
  if (!prefs.claudeForgetOnClose.value) return
  for (const path of new Set(closed.map(pathOf))) {
    if (!path || workspaces.value.some((w) => pathOf(w) === path)) continue
    forgetAgents(path)
  }
}

async function closeWorkspace(id: number) {
  const i = workspaces.value.findIndex((w) => w.id === id)
  if (i === -1) return
  const closing = workspaces.value[i]
  if (!(await closing.files.discardDrafts())) return
  closing.scope.stop()
  const rest = workspaces.value.filter((w) => w.id !== id)
  workspaces.value = rest
  stopTypes(closing.repo.repo.value)
  forgetClosed([closing])
  if (activeId.value === id) {
    const next = rest[i] ?? rest[i - 1]
    if (next) activate(next.id)
    else void addWorkspace()
  }
}

/** Puts every tab but this one to sleep, asking once if any terminals will close. */
async function sleepOtherWorkspaces(id: number) {
  const others = workspaces.value.filter((w) => w.id !== id && w.repo.repo.value && w.id !== activeId.value)
  const running = (await Promise.all(others.map((w) => w.terminals.checkRunning()))).flat()
  if (running.length && !(await confirmAction('Put Other Tabs to Sleep', `${stops(running)} Open files and unsaved edits stay.`, 'Sleep'))) return
  for (const w of others) await sleepWorkspace(w.id, { ask: false })
}

function closeOtherWorkspaces(id: number) {
  const others = workspaces.value.filter((w) => w.id !== id)
  for (const w of others) w.scope.stop()
  workspaces.value = workspaces.value.filter((w) => w.id === id)
  forgetClosed(others)
  for (const w of others) stopTypes(w.repo.repo.value)
  activate(id)
}

function moveWorkspace(from: number, to: number) {
  const list = [...workspaces.value]
  list.splice(to, 0, list.splice(from, 1)[0])
  workspaces.value = list
}

function stepWorkspace(delta: number) {
  const list = workspaces.value
  const i = list.findIndex((w) => w.id === activeId.value)
  if (list.length > 1) activate(list[(i + delta + list.length) % list.length].id)
}

/**
 * A changed file that's really a folder: a repository nested in `root`, which git lists whole (`path/`) rather than
 * file by file. It opens as a repository in a tab of its own; any other folder can't be shown as a file. True when
 * `file` was such a folder, so it's dealt with.
 */
export function openNestedRepo(root: string, file: { path: string; nestedRepo?: boolean }) {
  if (!file.path.endsWith('/')) return false
  if (file.nestedRepo) void showRepo(`${root}/${file.path.replace(/\/$/, '')}`)
  else showToast(`${file.path} is a folder`, 'error')
  return true
}

/** Shows the tab that has a repository open, or opens it in a new one. */
async function showRepo(path: string) {
  const open = workspaces.value.find((w) => pathOf(w) === path)
  if (open) activate(open.id)
  else await addWorkspace(path)
}

/** Closes the tabs showing a repository, before its folder goes. False when unsaved edits there were kept. */
async function closeRepo(path: string) {
  for (const w of workspaces.value.filter((w) => pathOf(w) === path)) {
    await closeWorkspace(w.id)
    if (workspaces.value.includes(w)) return false
  }
  return true
}

/** Opens a repository in the current tab when it is empty, otherwise in a new one. */
async function openInWorkspace(path: string) {
  const current = active.value
  if (current && !current.repo.repo.value) {
    if ((await current.repo.openRepo(path)) && prefs.terminalOpen.value && !current.terminals.sessions.value.length) current.terminals.restoreOrAdd()
  } else {
    await addWorkspace(path)
  }
}

async function pickRepo() {
  const path = await open({ directory: true, multiple: false, title: 'Open Git Repository' })
  if (typeof path === 'string') await openInWorkspace(path)
}

export function useWorkspaces() {
  return {
    workspaces,
    activeId,
    active,
    activate,
    addWorkspace,
    sleepWorkspace,
    sleepOtherWorkspaces,
    closeWorkspace,
    closeOtherWorkspaces,
    moveWorkspace,
    stepWorkspace,
    openInWorkspace,
    pickRepo,
    showRepo,
    closeRepo,
  }
}
