import { ref } from 'vue'
import type { Repo } from './repo'
import { prefs } from './prefs'

export interface TerminalSession {
  key: number
  cwd: string
  title: string
}

let nextKey = 1

/** The terminal tabs belonging to one workspace. The PTY itself lives in TerminalView, for as long as it is mounted. */
export function createTerminals({ repo }: Repo) {
  const sessions = ref<TerminalSession[]>([])
  const activeKey = ref<number | null>(null)
  const open = ref(prefs.terminalOpen.value)

  /** Opens a terminal tab, in the repository or a folder inside it. */
  function add(cwd?: string) {
    if (!repo.value) return
    const session = { key: nextKey++, cwd: cwd ?? repo.value, title: 'Terminal' }
    sessions.value.push(session)
    activeKey.value = session.key
    open.value = true
  }

  function close(key: number) {
    const i = sessions.value.findIndex((s) => s.key === key)
    if (i === -1) return
    sessions.value.splice(i, 1)
    if (activeKey.value === key) activeKey.value = (sessions.value[i] ?? sessions.value[i - 1])?.key ?? null
    if (!sessions.value.length) open.value = false
  }

  function closeActive() {
    if (activeKey.value != null) close(activeKey.value)
  }

  function step(delta: number) {
    const n = sessions.value.length
    if (n < 2) return
    const i = sessions.value.findIndex((s) => s.key === activeKey.value)
    activeKey.value = sessions.value[(i + delta + n) % n].key
  }

  function move(from: number, to: number) {
    const list = [...sessions.value]
    list.splice(to, 0, list.splice(from, 1)[0])
    sessions.value = list
  }

  function toggle() {
    open.value = !open.value
    prefs.terminalOpen.value = open.value
    if (open.value && !sessions.value.length) add()
  }

  return { sessions, activeKey, open, add, close, closeActive, step, move, toggle }
}

export type Terminals = ReturnType<typeof createTerminals>
