import { shallowRef } from 'vue'
import { git, type FileChange, type StatusFile } from '@/lib/git'
import { parseDiff, type ParsedDiff } from '@/lib/diff'
import type { Repo } from './repo'

interface DiffView {
  file: { path: string; oldPath: string | null }
  label: string
  result: ParsedDiff | null
  error: string | null
  /** For a file from the source control panel: which side, so its lines can be staged, unstaged or discarded. */
  status?: { file: StatusFile; staged: boolean }
}

export function createDiff({ repo }: Repo) {
  const diff = shallowRef<DiffView | null>(null)
  let seq = 0
  let lastLoad: (() => Promise<string>) | null = null

  async function show(view: Omit<DiffView, 'result' | 'error'>, load: () => Promise<string>, { quiet = false } = {}) {
    const id = ++seq
    lastLoad = load
    // A reload keeps showing the old diff until the new one is in, so it doesn't flash "Loading…".
    if (!quiet) diff.value = { ...view, result: null, error: null }
    try {
      const text = await load()
      if (id === seq) diff.value = { ...view, result: parseDiff(text), error: null }
    } catch (e) {
      if (id === seq) diff.value = { ...view, result: null, error: String(e) }
    }
  }

  /** Loads the diff on screen again, after some of it was staged or discarded. */
  async function reloadDiff() {
    const d = diff.value
    if (d && lastLoad) await show(d, lastLoad, { quiet: true })
  }

  const openDiff = (file: FileChange, from: string | null, to: string) =>
    show({ file, label: '' }, () => git.fileDiff(repo.value!, { from, to, path: file.path, oldPath: file.oldPath, untracked: file.status === '?' }))

  /** A file from the source control panel: its staged or its unstaged changes. */
  const openStatusDiff = (file: StatusFile, staged: boolean) =>
    show({ file, label: staged ? 'Staged' : file.kind === 'untracked' ? 'Untracked' : 'Working tree', status: { file, staged } }, () =>
      git.statusDiff(repo.value!, file, staged),
    )

  function closeDiff() {
    seq++
    diff.value = null
  }

  return { diff, openDiff, openStatusDiff, reloadDiff, closeDiff }
}
