import { computed, ref } from 'vue'
import type { TodoDraft } from '@/lib/todos'
import { prefs } from './prefs'
import type { Repo } from './repo'
import { usePersisted } from './usePersisted'

export interface Todo {
  id: string
  text: string
  done: boolean
}

/** A tab in the panel under the terminal: a Slack message or canvas, or a to-do list. */
export type PanelTab =
  | { id: string; kind: 'slack'; url: string; title?: string }
  | { id: string; kind: 'todos'; title: string; items: Todo[] }
  | { id: string; kind: 'notes'; title: string; text: string }

interface PanelState {
  tabs: PanelTab[]
  active: string | null
}

/** Every repository's panel tabs, so each repo tab reopens with its own Slack links and lists. */
const store = usePersisted<Record<string, PanelState>>('panel-tabs', {})

const newId = () => Math.random().toString(36).slice(2, 10)
const todo = (d: TodoDraft): Todo => ({ id: newId(), text: d.text, done: d.done })

export function createPanel({ repo }: Repo) {
  const state = computed<PanelState>(() => (repo.value && store.value[repo.value]) || { tabs: [], active: null })
  const tabs = computed(() => state.value.tabs)
  const active = computed(() => tabs.value.find((t) => t.id === state.value.active) ?? tabs.value[0] ?? null)
  /** Shown in place of the graph rather than under the terminal. */
  const expanded = ref(false)

  function update(change: (s: PanelState) => void) {
    const path = repo.value
    if (!path) return
    // A plain copy: the stored state is reactive, which structuredClone refuses.
    const next: PanelState = JSON.parse(JSON.stringify(state.value))
    change(next)
    store.value = { ...store.value, [path]: next }
  }

  const reveal = () => {
    if (!expanded.value) prefs.panelOpen.value = true
  }

  function activate(id: string) {
    update((s) => (s.active = id))
  }

  /** A Slack link in its own tab, or the tab already showing it. */
  function addSlack(url: string) {
    const existing = tabs.value.find((t) => t.kind === 'slack' && t.url === url)
    const id = existing?.id ?? newId()
    update((s) => {
      if (!existing) s.tabs.push({ id, kind: 'slack', url })
      s.active = id
    })
    reveal()
  }

  function addTodos(title: string, items: TodoDraft[] = []) {
    const id = newId()
    update((s) => {
      s.tabs.push({ id, kind: 'todos', title, items: items.map(todo) })
      s.active = id
    })
    reveal()
    return id
  }

  /** A Markdown notepad. */
  function addNotes(title = 'Notes') {
    const id = newId()
    update((s) => {
      s.tabs.push({ id, kind: 'notes', title, text: '' })
      s.active = id
    })
    reveal()
  }

  function setNotes(id: string, text: string) {
    update((s) => {
      const t = s.tabs.find((x) => x.id === id)
      if (t?.kind === 'notes') t.text = text
    })
  }

  function close(id: string) {
    update((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      if (i === -1) return
      s.tabs.splice(i, 1)
      if (s.active === id) s.active = s.tabs[Math.min(i, s.tabs.length - 1)]?.id ?? null
    })
    if (!tabs.value.length) expanded.value = false
  }

  function move(from: number, to: number) {
    update((s) => s.tabs.splice(to, 0, ...s.tabs.splice(from, 1)))
  }

  function rename(id: string, title: string) {
    update((s) => {
      const t = s.tabs.find((x) => x.id === id)
      if (t) t.title = title
    })
  }

  /** Changes one list's items. */
  function editList(id: string, change: (items: Todo[]) => Todo[] | void) {
    update((s) => {
      const t = s.tabs.find((x) => x.id === id)
      if (t?.kind !== 'todos') return
      const next = change(t.items)
      if (next) t.items = next
    })
  }

  const list = {
    add: (id: string, drafts: TodoDraft[], at?: number) => editList(id, (items) => void items.splice(at ?? items.length, 0, ...drafts.map(todo))),
    toggle: (id: string, item: string) =>
      editList(id, (items) => {
        const t = items.find((x) => x.id === item)
        if (t) t.done = !t.done
      }),
    edit: (id: string, item: string, text: string) =>
      editList(id, (items) => {
        const t = items.find((x) => x.id === item)
        if (t) t.text = text
      }),
    remove: (id: string, item: string) => editList(id, (items) => items.filter((x) => x.id !== item)),
    move: (id: string, from: number, to: number) => editList(id, (items) => void items.splice(to, 0, ...items.splice(from, 1))),
    clearDone: (id: string) => editList(id, (items) => items.filter((x) => !x.done)),
  }

  return { tabs, active, expanded, activate, addSlack, addTodos, addNotes, setNotes, close, move, rename, list }
}

export type Panel = ReturnType<typeof createPanel>
