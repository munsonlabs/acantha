import { computed, effectScope, inject, provide, shallowRef, watch, type InjectionKey } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { createDetails } from './details'
import { createFiles } from './files'
import { createUi } from './ui'
import { createDiff } from './diff'
import { createMenus } from './menus'
import { createPanel } from './panel'
import { prefs } from './prefs'
import { createRepo } from './repo'
import { createReveal } from './reveal'
import { createSearch } from './search'
import { createStatus } from './status'
import { createTerminals } from './terminals'
import { createWatcher } from './watcher'

/** Everything belonging to one top-level tab: a repository's graph and the terminals beside it. */
function createWorkspace(id: number) {
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
      }),
      terminals: createTerminals(repo),
      panel: createPanel(repo),
    }
  })!
  return { id, scope, ...parts }
}

export type Workspace = ReturnType<typeof createWorkspace>

const KEY: InjectionKey<Workspace> = Symbol('workspace')
export const provideWorkspace = (ws: Workspace) => provide(KEY, ws)
export const useWorkspace = () => inject(KEY)!

const workspaces = shallowRef<Workspace[]>([])
const activeId = shallowRef(0)
let nextId = 1

const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) ?? null)

// Remember which repositories were open so the tabs come back on the next launch.
watch(
  () => workspaces.value.map((w) => w.repo.repo.value),
  (paths) => {
    prefs.workspaces.value = paths.filter((p): p is string => !!p)
  },
)

function activate(id: number) {
  activeId.value = id
  void active.value?.repo.reload()
}

async function addWorkspace(path: string | null = null, { quiet = false, activate: focus = true } = {}) {
  const ws = createWorkspace(nextId++)
  workspaces.value = [...workspaces.value, ws]
  if (focus) activeId.value = ws.id
  if (path && (await ws.repo.openRepo(path, { quiet })) && prefs.terminalOpen.value) ws.terminals.add()
  return ws
}

async function closeWorkspace(id: number) {
  const i = workspaces.value.findIndex((w) => w.id === id)
  if (i === -1) return
  if (!(await workspaces.value[i].files.discardDrafts())) return
  workspaces.value[i].scope.stop()
  const rest = workspaces.value.filter((w) => w.id !== id)
  workspaces.value = rest
  if (activeId.value === id) {
    const next = rest[i] ?? rest[i - 1]
    if (next) activate(next.id)
    else void addWorkspace()
  }
}

function closeOtherWorkspaces(id: number) {
  for (const w of workspaces.value) if (w.id !== id) w.scope.stop()
  workspaces.value = workspaces.value.filter((w) => w.id === id)
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

/** Shows the tab that has a repository open, or opens it in a new one. */
async function showRepo(path: string) {
  const open = workspaces.value.find((w) => w.repo.repo.value === path)
  if (open) activate(open.id)
  else await addWorkspace(path)
}

/** Closes the tabs showing a repository, before its folder goes. False when unsaved edits there were kept. */
async function closeRepo(path: string) {
  for (const w of workspaces.value.filter((w) => w.repo.repo.value === path)) {
    await closeWorkspace(w.id)
    if (workspaces.value.includes(w)) return false
  }
  return true
}

/** Opens a repository in the current tab when it is empty, otherwise in a new one. */
async function openInWorkspace(path: string) {
  const current = active.value
  if (current && !current.repo.repo.value) {
    if ((await current.repo.openRepo(path)) && prefs.terminalOpen.value && !current.terminals.sessions.value.length) current.terminals.add()
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
    closeWorkspace,
    closeOtherWorkspaces,
    moveWorkspace,
    stepWorkspace,
    openInWorkspace,
    pickRepo,
  }
}
