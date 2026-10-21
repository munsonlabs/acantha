import { computed, ref, shallowRef, watch } from 'vue'
import { git, type Status, type StatusFile } from '@/lib/git'
import type { Repo, UndoEntry, UndoSpec } from './repo'
import { confirmAction } from './useDialog'
import { showToast } from './useToast'

/** Working tree state for the source control sidebar: what is staged, what isn't, and committing it. */
export function createStatus({ repo, log, reload, prepareUndo, undoLast }: Repo) {
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
  /**
   * Runs git commands for a sidebar action. Quiet actions (staging) only report failures; ones with `progress` also
   * report success, and ones with `undo` offer an Undo button. Returns the undo entry, so callers can extend it.
   */
  async function exec(commands: string[][], { progress, done, undo }: { progress?: string; done?: string; undo?: UndoSpec } = {}) {
    if (!repo.value) return { ok: false, entry: null }
    busy.value = true
    if (progress) showToast(progress, 'busy')
    const finish = undo ? await prepareUndo(undo) : null
    try {
      let output = ''
      for (const args of commands) output = await git.action(repo.value, args)
      const entry: UndoEntry | null = finish ? await finish() : null
      if (progress || done)
        showToast(done || output.split('\n').filter(Boolean).pop() || 'Done', 'ok', entry ? { label: 'Undo', run: undoLast } : undefined)
      return { ok: true, entry }
    } catch (e) {
      showToast(String(e), 'error')
      return { ok: false, entry: null }
    } finally {
      busy.value = false
      await refresh()
    }
  }

  const paths = (list: StatusFile[]) => list.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))

  const stage = async (list: StatusFile[]) => !!list.length && (await exec([['add', '--', ...paths(list)]])).ok

  const unstage = (list: StatusFile[]) =>
    list.length &&
    // Before the first commit there is no HEAD to restore the index from.
    exec([log.value?.head ? ['restore', '--staged', '--', ...paths(list)] : ['rm', '--cached', '-r', '-q', '--', ...paths(list)]]).then((r) => r.ok)

  async function discard(list: StatusFile[]) {
    if (!list.length) return
    const what = list.length === 1 ? `\`${list[0].path}\`` : `${list.length} files`
    if (!(await confirmAction('Discard Changes', `Discard changes to ${what}? You can undo this straight afterwards.`, 'Discard', true))) return
    const root = repo.value!
    const tracked = list.filter((f) => f.kind !== 'untracked')
    const untracked = list.filter((f) => f.kind === 'untracked')
    // The files are copied aside first, so Undo can put them back exactly.
    const backup = await git.backupFiles(root, paths(list))
    await exec(
      [
        ...(tracked.length ? [['restore', '--worktree', '--', ...paths(tracked)]] : []),
        ...(untracked.length ? [['clean', '-f', '--', ...paths(untracked)]] : []),
      ],
      {
        done: `Discarded changes to ${list.length === 1 ? list[0].path : `${list.length} files`}`,
        undo: { label: 'the discard', run: () => git.restoreFiles(root, backup) },
      },
    )
  }

  /**
   * Stages, unstages or discards some of a file's lines, given a patch of them (see `buildPatch`). Discarding copies
   * the file aside first, so it can be undone.
   */
  async function applyLines(file: StatusFile, patch: string, action: 'stage' | 'unstage' | 'discard') {
    const root = repo.value
    if (!root) return false
    busy.value = true
    try {
      if (action === 'discard') {
        const backup = await git.backupFiles(root, [file.path])
        const finish = await prepareUndo({ label: 'discarding the lines', run: () => git.restoreFiles(root, backup) })
        await git.applyPatch(root, patch, false, true)
        const entry = await finish()
        showToast('Discarded the lines', 'ok', entry ? { label: 'Undo', run: undoLast } : undefined)
      } else {
        await git.applyPatch(root, patch, true, action === 'unstage')
      }
      return true
    } catch (e) {
      showToast(String(e), 'error')
      return false
    } finally {
      busy.value = false
      await refresh()
    }
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
    const amending = amend.value
    const { ok, entry } = await exec([['commit', ...(amending ? ['--amend'] : []), '-m', text]], {
      progress: amending ? 'Amending…' : 'Committing…',
      done: amending ? 'Amended the last commit' : 'Committed',
      undo: { label: amending ? 'the amend' : 'the commit', head: 'soft' },
    })
    if (ok) {
      message.value = ''
      amend.value = false
    }
    // Undoing a commit puts its message back in the box, ready to edit and commit again.
    if (entry) {
      const undoCommit = entry.run
      entry.run = async () => {
        await undoCommit()
        message.value = text
      }
    }
    await reload()
  }

  async function push() {
    const s = status.value
    const remote = log.value?.remotes[0]
    if (!s || (!s.upstream && !remote)) return
    await exec([s.upstream ? ['push'] : ['push', '-u', remote!, 'HEAD']], { progress: 'Pushing…' })
    await reload()
  }

  async function pull() {
    await exec([['pull']], { progress: 'Pulling…', undo: { label: 'the pull', head: 'keep' } })
    await reload()
  }

  /** Finishes the merge, rebase or cherry-pick that stopped for conflicts. */
  async function continueOperation() {
    const op = status.value?.operation
    if (!op) return
    if (conflicts.value.length) return showToast('Resolve and stage every conflict first', 'error')
    const text = message.value.trim()
    const args = op === 'merge' ? ['commit', ...(text ? ['-m', text] : ['--no-edit'])] : [op, '--continue']
    if ((await exec([args], { progress: 'Continuing…' })).ok) message.value = ''
    await reload()
  }

  async function abortOperation() {
    const op = status.value?.operation
    if (!op) return
    if (!(await confirmAction(`Abort ${op}`, `Abort the ${op} and go back to where you started?`, 'Abort', true))) return
    await exec([[op, '--abort']], { progress: 'Aborting…' })
    await reload()
  }

  return {
    status,
    files,
    staged,
    unstaged,
    conflicts,
    message,
    amend,
    busy,
    refresh,
    stage,
    unstage,
    discard,
    applyLines,
    setAmend,
    commit,
    push,
    pull,
    continueOperation,
    abortOperation,
  }
}
