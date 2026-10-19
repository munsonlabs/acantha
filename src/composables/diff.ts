import { shallowRef } from 'vue'
import { git, type FileChange, type StatusFile } from '@/lib/git'
import { parseDiff, type ParsedDiff } from '@/lib/diff'
import type { Repo } from './repo'

export function createDiff({ repo }: Repo) {
  const diff = shallowRef<{ file: { path: string; oldPath: string | null }; label: string; result: ParsedDiff | null; error: string | null } | null>(
    null,
  )
  let seq = 0

  async function show(file: { path: string; oldPath: string | null }, label: string, load: () => Promise<string>) {
    const id = ++seq
    diff.value = { file, label, result: null, error: null }
    try {
      const text = await load()
      if (id === seq) diff.value = { file, label, result: parseDiff(text), error: null }
    } catch (e) {
      if (id === seq) diff.value = { file, label, result: null, error: String(e) }
    }
  }

  const openDiff = (file: FileChange, from: string | null, to: string) =>
    show(file, '', () => git.fileDiff(repo.value!, { from, to, path: file.path, oldPath: file.oldPath, untracked: file.status === '?' }))

  /** A file from the source control panel: its staged or its unstaged changes. */
  const openStatusDiff = (file: StatusFile, staged: boolean) =>
    show(file, staged ? 'Staged' : file.kind === 'untracked' ? 'Untracked' : 'Working tree', () => git.statusDiff(repo.value!, file, staged))

  function closeDiff() {
    seq++
    diff.value = null
  }

  return { diff, openDiff, openStatusDiff, closeDiff }
}
