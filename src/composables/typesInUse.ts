import { invoke } from '@tauri-apps/api/core'

/** How long a repository's TypeScript keeps running once no file of its is being edited. */
export const TYPES_IDLE_MS = 2 * 60 * 1000

const editors = new Map<string, number>()
const stopping = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * An editor using a repository's TypeScript (see src-tauri/src/tsserver.rs). It runs while any does, and stops a
 * couple of minutes after the last one closes, freeing its memory; opening another meanwhile keeps it. Returns the
 * call for when the editor's done with it.
 */
export function holdTypes(repo: string) {
  clearTimeout(stopping.get(repo))
  editors.set(repo, (editors.get(repo) ?? 0) + 1)
  let held = true
  return () => {
    if (!held) return
    held = false
    const left = (editors.get(repo) ?? 1) - 1
    editors.set(repo, left)
    if (left > 0) return
    stopping.set(
      repo,
      setTimeout(() => {
        if (!editors.get(repo)) void invoke('ts_stop', { repo }).catch(() => {})
      }, TYPES_IDLE_MS),
    )
  }
}
