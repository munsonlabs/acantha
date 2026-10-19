import { ref, shallowRef, watch } from 'vue'
import { git, UNCOMMITTED, type CommitDetails, type FileChange } from '@/lib/git'
import type { Repo } from './repo'
import type { Reveal } from './reveal'
import { showToast } from './useToast'

export interface Details {
  kind: 'commit' | 'uncommitted' | 'compare'
  from: string | null
  to: string
  commit: CommitDetails | null
  files: FileChange[]
  loading: boolean
}

export function createDetails({ repo, log, rows }: Repo, { revealRow }: Reveal) {
  const selected = ref<string | null>(null)
  const compareWith = ref<string | null>(null)
  const details = shallowRef<Details | null>(null)
  let seq = 0

  const rowIndex = (hash: string) => rows.value.findIndex((c) => c.hash === hash)

  async function load(next: Omit<Details, 'files' | 'commit' | 'loading'>, fetchCommit: boolean) {
    const id = ++seq
    details.value = { ...next, commit: details.value?.to === next.to ? details.value.commit : null, files: [], loading: true }
    try {
      const [commit, files] = await Promise.all([
        fetchCommit ? git.commit(repo.value!, next.to) : Promise.resolve(null),
        git.changes(repo.value!, next.from, next.to),
      ])
      if (id === seq) details.value = { ...next, commit, files, loading: false }
    } catch (e) {
      if (id === seq) details.value = { ...next, commit: null, files: [], loading: false }
      showToast(String(e), 'error')
    }
  }

  function select(hash: string) {
    const row = rowIndex(hash)
    if (row === -1) return showToast('That commit is not loaded in the graph', 'error')
    selected.value = hash
    compareWith.value = null
    revealRow(row)
    if (hash === UNCOMMITTED) return load({ kind: 'uncommitted', from: log.value?.head ?? null, to: UNCOMMITTED }, false)
    return load({ kind: 'commit', from: rows.value[row].parents[0] ?? null, to: hash }, true)
  }

  /** Compares two commits, oldest to newest by their position in the graph. */
  function compare(a: string, b: string) {
    const [older, newer] = rowIndex(a) > rowIndex(b) ? [a, b] : [b, a]
    selected.value = a
    compareWith.value = b
    return load({ kind: 'compare', from: older, to: newer }, false)
  }

  function closeDetails() {
    seq++
    selected.value = null
    compareWith.value = null
    details.value = null
  }

  function step(delta: number) {
    if (!selected.value) return
    const next = rows.value[rowIndex(selected.value) + delta]
    if (next) void select(next.hash)
  }

  // Keep the panel in step with the graph after a refresh.
  watch(rows, () => {
    if (!selected.value) return
    if (rowIndex(selected.value) === -1 || (compareWith.value && rowIndex(compareWith.value) === -1)) closeDetails()
    else if (selected.value === UNCOMMITTED && !compareWith.value) void select(UNCOMMITTED)
  })

  return { selected, compareWith, details, select, compare, closeDetails, step }
}

export type DetailsState = ReturnType<typeof createDetails>
