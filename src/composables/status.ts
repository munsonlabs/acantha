import { computed, ref, shallowRef, watch } from 'vue'
import { git, type Status, type StatusFile } from '@/lib/git'
import type { Repo } from './repo'
import { confirmAction } from './useDialog'
import { showToast } from './useToast'

/** Working tree state for the source control sidebar: what is staged, what isn't, and committing it. */
export function createStatus({ repo, log, reload }: Repo) {
  const status = shallowRef<Status | null>(null)
  const message = ref('')
  const amend = ref(false)
  const busy = ref(false)
  let seq = 0
  let signature = ''

  const files = computed(() => status.value?.files ?? [])
  const staged = computed(() => files.value.filter((f) => f.kind === 'changed' && f.index !== '.'))
  const unstaged = computed(() => files.value.filter((f) => f.kind === 'untracked' || (f.kind === 'changed' && f.worktree !== '.')))
  const conflicts = computed(() => files.value.filter((f) => f.kind === 'conflict'))

  async function refresh() {
    const root = repo.value
    if (!root) return
    const id = ++seq
    try {
      const next = await git.status(root)
      if (id !== seq || root !== repo.value) return
      const sig = [next.oid, next.branch, next.ahead, next.behind, ...next.files.map((f) => f.path + f.index + f.worktree)].join('|')
      const changed = signature !== '' && sig !== signature
      signature = sig
      status.value = next
      // Something outside the app (the terminal, an editor) changed the repo, so the graph is stale too.
      if (changed) void reload()
    } catch {
      // The graph's own reload reports repository errors.
    }
  }

  watch(repo, () => {
    signature = ''
    status.value = null
    message.value = ''
    amend.value = false
    void refresh()
  })
  watch(log, () => void refresh())

  /** Runs git commands for a sidebar action. Only failures are reported, since the lists show the result. */
  async function exec(commands: string[][], progress?: string) {
    if (!repo.value) return false
    busy.value = true
    if (progress) showToast(progress, 'busy')
    try {
      let output = ''
      for (const args of commands) output = await git.action(repo.value, args)
      if (progress) showToast(output.split('\n').filter(Boolean).pop() || 'Done')
      return true
    } catch (e) {
      showToast(String(e), 'error')
      return false
    } finally {
      busy.value = false
      await refresh()
    }
  }

  const paths = (list: StatusFile[]) => list.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))

  const stage = (list: StatusFile[]) => list.length && exec([['add', '--', ...paths(list)]])

  const unstage = (list: StatusFile[]) =>
    list.length &&
    // Before the first commit there is no HEAD to restore the index from.
    exec([log.value?.head ? ['restore', '--staged', '--', ...paths(list)] : ['rm', '--cached', '-r', '-q', '--', ...paths(list)]])

  async function discard(list: StatusFile[]) {
    if (!list.length) return
    const what = list.length === 1 ? `\`${list[0].path}\`` : `${list.length} files`
    if (!(await confirmAction('Discard Changes', `Discard changes to ${what}? This cannot be undone.`, 'Discard', true))) return
    const tracked = list.filter((f) => f.kind !== 'untracked')
    const untracked = list.filter((f) => f.kind === 'untracked')
    await exec([
      ...(tracked.length ? [['restore', '--worktree', '--', ...paths(tracked)]] : []),
      ...(untracked.length ? [['clean', '-f', '--', ...paths(untracked)]] : []),
    ])
  }

  async function setAmend(value: boolean) {
    amend.value = value
    // Start from the previous message, as `git commit --amend` would.
    if (value && !message.value.trim() && log.value?.head) {
      const head = await git.commit(repo.value!, log.value.head).catch(() => null)
      if (head && amend.value && !message.value.trim()) message.value = head.body
    }
  }

  async function commit() {
    const text = message.value.trim()
    if (!text) return showToast('Write a commit message first', 'error')
    if (conflicts.value.length) return showToast('Resolve and stage the conflicted files first', 'error')
    if (!staged.value.length && !amend.value) {
      if (!unstaged.value.length) return showToast('There is nothing to commit', 'error')
      if (!(await confirmAction('Commit All Changes', 'Nothing is staged. Stage every change and commit it?', 'Stage All & Commit'))) return
      if (!(await stage(unstaged.value))) return
    }
    const ok = await exec([['commit', ...(amend.value ? ['--amend'] : []), '-m', text]], amend.value ? 'Amending…' : 'Committing…')
    if (ok) {
      message.value = ''
      amend.value = false
    }
    await reload()
  }

  async function push() {
    const s = status.value
    const remote = log.value?.remotes[0]
    if (!s || (!s.upstream && !remote)) return
    await exec([s.upstream ? ['push'] : ['push', '-u', remote!, 'HEAD']], 'Pushing…')
    await reload()
  }

  async function pull() {
    await exec([['pull']], 'Pulling…')
    await reload()
  }

  return { status, files, staged, unstaged, conflicts, message, amend, busy, refresh, stage, unstage, discard, setAmend, commit, push, pull }
}
