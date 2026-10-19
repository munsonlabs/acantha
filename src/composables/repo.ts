import { computed, ref, shallowRef } from 'vue'
import { git, UNCOMMITTED, type Commit, type GitRef, type Log } from '@/lib/git'
import { layoutGraph } from '@/lib/graph'
import { addRecent, prefs } from './prefs'
import { showToast } from './useToast'

const PAGE = 500

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
      if (seq === reloadSeq) log.value = result
    } catch (e) {
      if (seq !== reloadSeq) return
      // The filtered branch may have been deleted or renamed.
      if (branches.value.length) {
        branches.value = []
        return reload()
      }
      showToast(String(e), 'error')
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
  async function run(commands: string[] | string[][], { busy = 'Working…', done = '' } = {}) {
    if (!repo.value) return
    const list = (Array.isArray(commands[0]) ? commands : [commands]) as string[][]
    showToast(busy, 'busy')
    try {
      let output = ''
      for (const args of list) output = await git.action(repo.value, args)
      showToast(done || output.split('\n').filter(Boolean).pop() || 'Done')
    } catch (e) {
      showToast(String(e), 'error')
    }
    await reload()
  }

  return { repo, log, rows, layout, refsByHash, branches, showRemotes, showStashes, reload, openRepo, setBranches, setShowRemotes, loadMore, run }
}

export type Repo = ReturnType<typeof createRepo>
