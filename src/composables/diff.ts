import { shallowRef } from 'vue'
import { git, type FileChange } from '@/lib/git'
import { parseDiff, type ParsedDiff } from '@/lib/diff'
import type { Repo } from './repo'

export function createDiff({ repo }: Repo) {
  const diff = shallowRef<{ file: FileChange; result: ParsedDiff | null; error: string | null } | null>(null)
  let seq = 0

  async function openDiff(file: FileChange, from: string | null, to: string) {
    const id = ++seq
    diff.value = { file, result: null, error: null }
    try {
      const text = await git.fileDiff(repo.value!, { from, to, path: file.path, oldPath: file.oldPath, untracked: file.status === '?' })
      if (id === seq) diff.value = { file, result: parseDiff(text), error: null }
    } catch (e) {
      if (id === seq) diff.value = { file, result: null, error: String(e) }
    }
  }

  function closeDiff() {
    seq++
    diff.value = null
  }

  return { diff, openDiff, closeDiff }
}
