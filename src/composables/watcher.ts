import { onScopeDispose, watch } from 'vue'
import { git } from '@/lib/git'
import type { Repo } from './repo'

/**
 * Keeps a workspace in step with changes made outside the app (the terminal, an editor, another git client) the
 * moment they happen. Git changes reload the graph; working-tree changes refresh the Git panel, which reloads the
 * graph itself if the set of changes moved.
 */
export function createWatcher({ repo, reload }: Repo, refreshStatus: () => Promise<void>) {
  let id: number | null = null

  const stop = () => {
    if (id !== null) void git.unwatch(id).catch(() => {})
    id = null
  }

  watch(
    repo,
    async (root) => {
      stop()
      if (!root) return
      try {
        const started = await git.watch(root, (kind) => void (kind === 'git' ? reload() : refreshStatus()))
        // The repository may have changed while the watcher was starting.
        if (repo.value === root) id = started
        else void git.unwatch(started)
      } catch {
        // Without a watcher the periodic refresh still catches changes, just more slowly.
      }
    },
    { immediate: true },
  )

  onScopeDispose(stop)
}
