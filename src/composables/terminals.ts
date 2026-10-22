import { computed, ref, watch } from 'vue'
import type { Repo } from './repo'
import { prefs } from './prefs'
import { usePersisted } from './usePersisted'

export interface TerminalSession {
  key: number
  cwd: string
  /** What the shell calls itself (its window title), kept up to date as it changes. */
  title: string
  /** A name you gave the tab; it wins over the shell's title. */
  name?: string
  /** Typed into the shell once it starts, as if you'd typed it (e.g. `npm run dev`). */
  command?: string
  /** The script it runs, for the Scripts tab (see `scriptKey`). */
  script?: string
  /** Shown beside this tab's terminal, split, rather than as a tab of its own. */
  pane?: number
  /** For a terminal with one beside it: the share of the width it takes. */
  ratio?: number
}

/** A terminal tab as it's kept between launches: where it was, what it was called, and what was beside it. */
interface SavedTab {
  cwd: string
  name?: string
  split?: { cwd: string; name?: string }
  ratio?: number
}

/** Each repository's terminal tabs, so they come back when it's opened again (when Settings → Terminal says so). */
const saved = usePersisted<Record<string, { tabs: SavedTab[]; active: number }>>('terminal-tabs', {})

let nextKey = 1

/** The terminal tabs belonging to one workspace. The PTY itself lives in TerminalView, for as long as it is mounted. */
export function createTerminals({ repo }: Repo) {
  const sessions = ref<TerminalSession[]>([])
  const activeKey = ref<number | null>(null)
  const open = ref(prefs.terminalOpen.value)

  /** The terminals with tabs of their own; the others are split beside one of these. */
  const tabs = computed(() => sessions.value.filter((s) => s.pane == null))
  const partnerOf = (key: number) => sessions.value.find((s) => s.pane === key)

  /** Opens a terminal tab, in the repository or a folder inside it, optionally running a command. */
  function add(cwd?: string, { title = 'Terminal', command, script }: { title?: string; command?: string; script?: string } = {}) {
    if (!repo.value) return
    const session: TerminalSession = { key: nextKey++, cwd: cwd ?? repo.value, title, command, script }
    sessions.value.push(session)
    activeKey.value = session.key
    open.value = true
  }

  /** Splits a tab: a new terminal beside its own, in the same folder. One split a tab. */
  function split(key = activeKey.value) {
    const owner = sessions.value.find((s) => s.key === key && s.pane == null)
    if (!owner || partnerOf(owner.key)) return
    sessions.value.push({ key: nextKey++, cwd: owner.cwd, title: 'Terminal', pane: owner.key })
    owner.ratio = 0.5
    activeKey.value = owner.key
    open.value = true
  }

  /**
   * Closes one terminal. Closing a tab's own terminal leaves the one beside it as the tab; closing the one beside it
   * just ends the split.
   */
  function close(key: number) {
    const i = sessions.value.findIndex((s) => s.key === key)
    if (i === -1) return
    const closing = sessions.value[i]
    const partner = closing.pane == null ? partnerOf(key) : undefined
    const at = tabs.value.findIndex((s) => s.key === key)
    sessions.value.splice(i, 1)
    if (partner) {
      partner.pane = undefined
      if (activeKey.value === key) activeKey.value = partner.key
    } else if (closing.pane == null && activeKey.value === key) {
      activeKey.value = (tabs.value[at] ?? tabs.value[at - 1])?.key ?? null
    }
    if (!sessions.value.length) open.value = false
  }

  function closeActive() {
    if (activeKey.value != null) close(activeKey.value)
  }

  function step(delta: number) {
    const n = tabs.value.length
    if (n < 2) return
    const i = tabs.value.findIndex((s) => s.key === activeKey.value)
    activeKey.value = tabs.value[(i + delta + n) % n].key
  }

  /** Moves a tab, by its place in the tab strip. */
  function move(from: number, to: number) {
    const a = tabs.value[from]
    const b = tabs.value[to]
    if (!a || !b) return
    const list = [...sessions.value]
    list.splice(list.indexOf(b), 0, list.splice(list.indexOf(a), 1)[0])
    sessions.value = list
  }

  function toggle() {
    open.value = !open.value
    prefs.terminalOpen.value = open.value
    if (open.value && !sessions.value.length) add()
  }

  /** Brings a terminal tab into view. */
  function show(key: number) {
    activeKey.value = key
    open.value = true
  }

  /**
   * Opens the repository's terminals: the tabs it had last time (fresh shells in the same folders, with their names and
   * splits), or else one new terminal. Tabs that ran a script aren't brought back as empty shells.
   */
  function restoreOrAdd() {
    const root = repo.value
    const last = root && prefs.restoreTerminals.value ? saved.value[root] : undefined
    if (!root || !last?.tabs.length) return add()
    let active: number | null = null
    last.tabs.forEach((t, i) => {
      const key = nextKey++
      sessions.value.push({ key, cwd: t.cwd, title: 'Terminal', name: t.name, ratio: t.ratio })
      if (t.split) sessions.value.push({ key: nextKey++, cwd: t.split.cwd, title: 'Terminal', name: t.split.name, pane: key })
      if (i === last.active || active === null) active = key
    })
    activeKey.value = active
    open.value = true
  }

  // Kept as they change, for the next launch.
  watch(
    () =>
      tabs.value
        .filter((t) => !t.command)
        .map((t) => {
          const p = partnerOf(t.key)
          return { cwd: t.cwd, name: t.name, ratio: p ? t.ratio : undefined, split: p && !p.command ? { cwd: p.cwd, name: p.name } : undefined }
        }),
    (list) => {
      const root = repo.value
      if (!root) return
      const active = Math.max(
        0,
        tabs.value.filter((t) => !t.command).findIndex((t) => t.key === activeKey.value),
      )
      saved.value = { ...saved.value, [root]: { tabs: JSON.parse(JSON.stringify(list)), active } }
    },
    { deep: true },
  )

  return { sessions, tabs, partnerOf, activeKey, open, add, split, close, closeActive, step, move, toggle, show, restoreOrAdd }
}

export type Terminals = ReturnType<typeof createTerminals>
