import { computed, ref, shallowRef } from 'vue'
import { git, UNCOMMITTED, type Commit, type GitRef, type Log, type Stat } from '@/lib/git'
import { layoutGraph } from '@/lib/graph'
import { addRecent, prefs } from './prefs'
import { confirmAction } from './useDialog'
import { showToast } from './useToast'

const PAGE = 500

/**
 * How to undo an action:
 * - `head`: move the branch back to where it was. `soft` keeps the undone commit's changes staged (for commits and
 *   amends); `keep` is for everything else and leaves uncommitted work alone.
 * - `checkout`: switch back to the previous branch or commit.
 * - `run`: anything else, like deleting a tag that was just created.
 */
export type UndoSpec = { label: string } & ({ head: 'soft' | 'keep' } | { checkout: true } | { run: () => Promise<unknown> })

export interface UndoEntry {
  label: string
  run: () => Promise<void>
}

export interface RefGroup {
  /** Local branches, with the remotes that have a branch of the same name on the same commit. */
  branches: { name: string; remotes: string[] }[]
  remotes: GitRef[]
  tags: string[]
}

export function createRepo() {
  const repo = ref<string | null>(null)
  const log = shallowRef<Log | null>(null)
  const limit = ref(PAGE)
  /** Revisions picked in the branch filter. Empty shows everything. */
  const branches = ref<string[]>([])
  const showRemotes = prefs.showRemotes
  const showStashes = prefs.showStashes
  /** Lines changed per commit, filled in after the graph loads. Commits never change, so it only grows. */
  const stats = shallowRef(new Map<string, Stat>())

  const rows = computed<Commit[]>(() => {
    const l = log.value
    if (!l) return []
    // Only show the working tree when HEAD is part of the graph being viewed.
    const headVisible = l.head ? l.commits.some((c) => c.hash === l.head) : true
    const list = [...l.commits]
    // Each stash sits just above the commit it was made on, branching off it.
    if (showStashes.value) {
      for (const stash of l.stashes) {
        const i = list.findIndex((c) => c.hash === stash.base && !c.stash)
        if (i !== -1)
          list.splice(i, 0, {
            hash: stash.hash,
            parents: [stash.base],
            author: stash.author,
            email: stash.email,
            date: stash.date,
            subject: stash.subject,
            stash,
          })
      }
    }
    if (!l.uncommitted || !headVisible) return list
    const pseudo: Commit = {
      hash: UNCOMMITTED,
      parents: l.head ? [l.head] : [],
      author: '*',
      email: '',
      date: Math.floor(Date.now() / 1000),
      subject: `Uncommitted Changes (${l.uncommitted})`,
    }
    return [pseudo, ...list]
  })

  const layout = computed(() => layoutGraph(rows.value))

  const refsByHash = computed(() => {
    const map = new Map<string, RefGroup>()
    const group = (hash: string) => {
      let g = map.get(hash)
      if (!g) map.set(hash, (g = { branches: [], remotes: [], tags: [] }))
      return g
    }
    const refs = log.value?.refs ?? []
    for (const r of refs) {
      if (r.kind === 'branch') group(r.hash).branches.push({ name: r.name, remotes: [] })
      if (r.kind === 'tag') group(r.hash).tags.push(r.name)
    }
    if (showRemotes.value) {
      for (const r of refs.filter((r) => r.kind === 'remote')) {
        const g = group(r.hash)
        const local = g.branches.find((b) => b.name === r.name)
        if (local) local.remotes.push(r.remote!)
        else g.remotes.push(r)
      }
    }
    return map
  })

  let reloadSeq = 0

  async function reload() {
    if (!repo.value) return
    const seq = ++reloadSeq
    try {
      const result = await git.log(repo.value, { limit: limit.value, branches: branches.value, showRemotes: showRemotes.value })
      if (seq === reloadSeq) {
        log.value = result
        void loadStats(repo.value, result.commits)
      }
    } catch (e) {
      if (seq !== reloadSeq) return
      // A filtered branch may have been deleted or renamed: drop just the ones that are gone, keep the rest.
      if (branches.value.length) {
        const path = repo.value
        const exists = await Promise.all(branches.value.map((b) => git.revParse(path, b).catch(() => null)))
        if (seq !== reloadSeq) return
        const kept = branches.value.filter((_, i) => exists[i])
        if (kept.length < branches.value.length) {
          branches.value = kept
          return reload()
        }
      }
      showToast(String(e), 'error')
    }
  }

  async function loadStats(root: string, commits: Commit[]) {
    const missing = commits.map((c) => c.hash).filter((h) => !stats.value.has(h))
    if (!missing.length) return
    try {
      const found = await git.stats(root, missing)
      if (root !== repo.value) return
      const next = new Map(stats.value)
      for (const [hash, stat] of Object.entries(found)) next.set(hash, stat)
      stats.value = next
    } catch {
      // Stats are a nicety; the graph works without them.
    }
  }

  async function openRepo(path: string, { quiet = false } = {}) {
    let root: string
    try {
      root = await git.resolveRepo(path)
    } catch (e) {
      prefs.recents.value = prefs.recents.value.filter((r) => r !== path)
      if (!quiet) showToast(String(e), 'error')
      return false
    }
    repo.value = root
    log.value = null
    stats.value = new Map()
    undoStack.value = []
    lastFetch.value = 0
    limit.value = PAGE
    branches.value = []
    addRecent(root)
    await reload()
    return true
  }

  function setBranches(value: string[]) {
    branches.value = value
    limit.value = PAGE
    return reload()
  }

  function setShowRemotes(value: boolean) {
    showRemotes.value = value
    return reload()
  }

  function loadMore() {
    limit.value += PAGE
    return reload()
  }

  /** Runs one or more git commands in sequence, reporting the outcome and refreshing the graph. */
  async function run(
    commands: string[] | string[][],
    { busy = 'Working…', done = '', undo }: { busy?: string; done?: string; undo?: UndoSpec } = {},
  ) {
    if (!repo.value) return
    const list = (Array.isArray(commands[0]) ? commands : [commands]) as string[][]
    showToast(busy, 'busy')
    const finish = undo ? await prepareUndo(undo) : null
    try {
      let output = ''
      for (const args of list) output = await git.action(repo.value, args)
      const entry = finish ? await finish() : null
      showToast(done || output.split('\n').filter(Boolean).pop() || 'Done', 'ok', entry ? { label: 'Undo', run: undoLast } : undefined)
    } catch (e) {
      showToast(String(e), 'error')
    }
    await reload()
  }

  /** The last few undoable actions in this repository, newest last. */
  const undoStack = shallowRef<UndoEntry[]>([])

  /**
   * Records where things stand before an action, and returns a function to call once it has succeeded. That
   * function pushes an undo entry (or nothing, if the action turned out not to change anything) and returns it.
   */
  async function prepareUndo(spec: UndoSpec): Promise<() => Promise<UndoEntry | null>> {
    const root = repo.value!
    const before = 'run' in spec ? null : await git.headState(root)
    return async () => {
      let entry: UndoEntry | null = null
      if ('head' in spec) {
        const after = await git.headState(root)
        if (!before?.head || after.head === before.head) return null
        entry = {
          label: spec.label,
          run: async () => {
            const status = await git.status(root)
            // A rebase or merge that stopped part way is undone by aborting it.
            if (status.operation) {
              await git.action(root, [status.operation, '--abort'])
              return
            }
            const now = await git.headState(root)
            if (now.branch !== after.branch) throw new Error(`Switch back to ${after.branch ?? 'the detached HEAD'} to undo this`)
            if (
              now.head !== after.head &&
              !(await confirmAction('Undo', 'The branch has moved on since. Undo anyway? Later commits will be undone too.', 'Undo', true))
            )
              return
            await git.action(root, ['reset', `--${spec.head}`, before.head!])
          },
        }
      } else if ('checkout' in spec) {
        const after = await git.headState(root)
        const back = before?.branch ?? before?.head
        if (!back || (after.head === before?.head && after.branch === before?.branch)) return null
        entry = { label: spec.label, run: async () => void (await git.action(root, ['checkout', back])) }
      } else {
        entry = { label: spec.label, run: async () => void (await spec.run()) }
      }
      undoStack.value = [...undoStack.value.slice(-19), entry]
      return entry
    }
  }

  async function undoLast() {
    const entry = undoStack.value.at(-1)
    if (!entry) return showToast('Nothing to undo')
    undoStack.value = undoStack.value.slice(0, -1)
    showToast(`Undoing ${entry.label}…`, 'busy')
    try {
      await entry.run()
      showToast(`Undid ${entry.label}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
    await reload()
  }

  /** When this repository last fetched, by hand or in the background. */
  const lastFetch = ref(0)
  let fetching = false

  /** A background fetch: no toasts, and failures (offline, no credentials) are ignored until next time. */
  async function fetchQuietly() {
    if (!repo.value || fetching || !log.value?.remotes.length) return
    fetching = true
    try {
      await git.action(repo.value, ['fetch', '--all', '--prune', '--quiet'])
    } catch {
      // Tried again at the next interval.
    } finally {
      fetching = false
      lastFetch.value = Date.now()
    }
    await reload()
  }

  return {
    undoStack,
    prepareUndo,
    undoLast,
    lastFetch,
    fetchQuietly,
    repo,
    log,
    rows,
    layout,
    refsByHash,
    stats,
    branches,
    showRemotes,
    showStashes,
    reload,
    openRepo,
    setBranches,
    setShowRemotes,
    loadMore,
    run,
  }
}

export type Repo = ReturnType<typeof createRepo>
