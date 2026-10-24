import { computed, ref } from 'vue'
import { tabShown } from '@/features/panelTabs'
import type { TodoDraft } from '@/lib/todos'
import { prefs } from './prefs'
import type { Repo } from './repo'
import { usePersisted } from './usePersisted'

export interface Todo {
  id: string
  text: string
  done: boolean
}

/** A tab in the panel under the terminal. */
export type PanelTab =
  | { id: string; kind: 'slack'; url: string; title?: string }
  | { id: string; kind: 'todos'; title: string; items: Todo[] }
  | { id: string; kind: 'notes'; title: string; text: string }
  | { id: string; kind: 'scripts'; title: string }
  /** Two branches side by side. null base: the repository's main branch; null head: the one checked out. */
  | { id: string; kind: 'compare'; title: string; base: string | null; head: string | null; uncommitted: boolean }
  | { id: string; kind: 'github'; title: string }
  | { id: string; kind: 'reflog'; title: string }
  /** A Markdown file from the repository, rendered, following its edits. */
  | { id: string; kind: 'markdown'; title: string; path: string }
  /** A package's README, from node_modules or npm. */
  | { id: string; kind: 'readme'; title: string; pkg: string }

interface PanelState {
  tabs: PanelTab[]
  active: string | null
}

/** Every repository's panel tabs, so each repo tab reopens with its own Slack links and lists. */
const store = usePersisted<Record<string, PanelState>>('panel-tabs', {})

/** Takes a repository's Claude tabs out of the panel, from before agents had a panel of their own, to move them there. */
export function takeClaudeTabs(repo: string): { id: string; title: string }[] {
  const s = store.value[repo]
  const isClaude = (t: PanelTab) => (t.kind as string) === 'claude'
  const claude = s?.tabs.filter(isClaude) ?? []
  if (!s || !claude.length) return []
  const tabs = s.tabs.filter((t) => !isClaude(t))
  store.value = { ...store.value, [repo]: { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[0]?.id ?? null) } }
  return claude.map((t) => ({ id: t.id, title: 'title' in t ? (t.title ?? 'Claude') : 'Claude' }))
}

const newId = () => Math.random().toString(36).slice(2, 10)
const todo = (d: TodoDraft): Todo => ({ id: newId(), text: d.text, done: d.done })

export function createPanel({ repo }: Repo) {
  const state = computed<PanelState>(() => (repo.value && store.value[repo.value]) || { tabs: [], active: null })
  /** The tabs whose features are on; the others are kept for when theirs is switched back on. */
  const tabs = computed(() => state.value.tabs.filter(tabShown))
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

  /** The repository's scripts; there's only ever one such tab. */
  function addScripts() {
    const existing = tabs.value.find((t) => t.kind === 'scripts')
    const id = existing?.id ?? newId()
    update((s) => {
      if (!existing) s.tabs.push({ id, kind: 'scripts', title: 'Scripts' })
      s.active = id
    })
    reveal()
  }

  /** Shows the first tab that `match`es, or adds `make()` when there's none. */
  function showOrAdd(match: (t: PanelTab) => boolean, make: (id: string) => PanelTab) {
    const existing = tabs.value.find(match)
    const id = existing?.id ?? newId()
    update((s) => {
      if (!existing) s.tabs.push(make(id))
      s.active = id
    })
    reveal()
    return id
  }

  const addCompare = () =>
    showOrAdd(
      () => false,
      (id) => ({ id, kind: 'compare', title: 'Compare', base: null, head: null, uncommitted: false }),
    )
  const addReflog = () =>
    showOrAdd(
      (t) => t.kind === 'reflog',
      (id) => ({ id, kind: 'reflog', title: 'Reflog' }),
    )
  const addGithub = () =>
    showOrAdd(
      (t) => t.kind === 'github',
      (id) => ({ id, kind: 'github', title: 'GitHub' }),
    )
  const addMarkdown = (path: string) =>
    showOrAdd(
      (t) => t.kind === 'markdown' && t.path === path,
      (id) => ({ id, kind: 'markdown', title: path.split('/').pop() ?? path, path }),
    )
  const addReadme = (pkg: string) =>
    showOrAdd(
      (t) => t.kind === 'readme' && t.pkg === pkg,
      (id) => ({ id, kind: 'readme', title: pkg, pkg }),
    )

  /** Changes a compare tab's branches or options. */
  function setCompare(id: string, change: Partial<{ base: string | null; head: string | null; uncommitted: boolean }>) {
    update((s) => {
      const t = s.tabs.find((x) => x.id === id)
      if (t?.kind === 'compare') Object.assign(t, change)
    })
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

  /** Moves a tab, by its place among the tabs showing. */
  function move(from: number, to: number) {
    const fromId = tabs.value[from]?.id
    const toId = tabs.value[to]?.id
    update((s) => {
      const i = s.tabs.findIndex((t) => t.id === fromId)
      const j = s.tabs.findIndex((t) => t.id === toId)
      if (i !== -1 && j !== -1) s.tabs.splice(j, 0, ...s.tabs.splice(i, 1))
    })
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

  return {
    tabs,
    active,
    expanded,
    activate,
    addSlack,
    addTodos,
    addNotes,
    setNotes,
    addScripts,
    addCompare,
    setCompare,
    addGithub,
    addReflog,
    addMarkdown,
    addReadme,
    close,
    move,
    rename,
    list,
  }
}

export type Panel = ReturnType<typeof createPanel>
