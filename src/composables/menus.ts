import { git, type Commit, type Stash } from '@/lib/git'
import { shortHash } from '@/lib/format'
import { ask, confirmAction, type DialogField } from './useDialog'
import type { Repo } from './repo'
import { showToast } from './useToast'
import type { MenuEntry } from './useContextMenu'

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`Copied ${what}`)
  } catch (e) {
    showToast(String(e), 'error')
  }
}

/** Cherry-picking or reverting a merge needs to know which parent is the mainline. */
const mainline = (c: Commit) => (c.parents.length > 1 ? ['-m', '1'] : [])

interface MenuActions {
  browse: (rev: string | null) => void
  rebaseFrom: (base: string, label: string) => void
}

export function createMenus({ repo, log, rows, run, lastFetch }: Repo, { browse, rebaseFrom }: MenuActions) {
  const currentBranch = () => log.value?.headBranch ?? null
  const remotes = () => log.value?.remotes ?? []
  const hasLocalBranch = (name: string) => !!log.value?.refs.some((r) => r.kind === 'branch' && r.name === name)
  /** The commit a branch or tag points at, so deleting it can be undone. */
  const refHash = (kind: 'branch' | 'tag', name: string) => log.value?.refs.find((r) => r.kind === kind && r.name === name)?.hash
  const into = () => (currentBranch() ? `\`${currentBranch()}\`` : 'the detached HEAD')

  const remoteField = (): DialogField => ({
    name: 'remote',
    label: 'Remote',
    type: 'select',
    value: remotes()[0],
    options: remotes().map((r) => ({ value: r, label: r })),
  })

  /** Whether `hash` is in HEAD's history, as far as the loaded graph shows. */
  function isAncestorOfHead(hash: string) {
    const head = log.value?.head
    if (!head || hash === head) return false
    const parents = new Map(rows.value.map((c) => [c.hash, c.parents]))
    const seen = new Set<string>()
    const stack = [head]
    while (stack.length) {
      const h = stack.pop()!
      if (h === hash) return true
      if (seen.has(h)) continue
      seen.add(h)
      stack.push(...(parents.get(h) ?? []))
    }
    return false
  }

  async function merge(target: string, label: string) {
    const v = await ask({
      title: 'Merge',
      message: `Merge ${label} into ${into()}.`,
      fields: [{ name: 'noFf', label: 'Always create a merge commit (--no-ff)', type: 'checkbox', value: false }],
      confirm: 'Merge',
    })
    if (v)
      await run(['merge', '--no-edit', ...(v.noFf ? ['--no-ff'] : []), target], {
        busy: 'Merging…',
        done: `Merged ${target}`,
        undo: { label: `the merge of ${target}`, head: 'keep' },
      })
  }

  async function checkoutBranch(name: string) {
    if (name === currentBranch()) return
    await run(['checkout', name], { done: `Checked out ${name}`, undo: { label: `checking out ${name}`, checkout: true } })
  }

  async function checkoutRemoteBranch(remote: string, name: string) {
    const v = await ask({
      title: 'Checkout Remote Branch',
      message: `Create a local branch tracking \`${remote}/${name}\`.`,
      fields: [{ name: 'name', label: 'Local branch name', value: name, required: true }],
      confirm: 'Checkout',
    })
    if (!v) return
    if (hasLocalBranch(v.name)) await checkoutBranch(v.name)
    else
      await run(['checkout', '-b', v.name, '--track', `${remote}/${name}`], {
        done: `Checked out ${v.name}`,
        undo: { label: `checking out ${v.name}`, checkout: true },
      })
  }

  function commitMenu(c: Commit): MenuEntry[] {
    const s = shortHash(c.hash)
    return [
      { header: c.subject, detail: `${s} · ${c.author}` },
      {
        label: 'Add Tag…',
        icon: 'tag',
        run: async () => {
          const v = await ask({
            title: 'Add Tag',
            message: `Add a tag to commit \`${s}\`.`,
            fields: [
              { name: 'name', label: 'Name', required: true },
              { name: 'message', label: 'Message', placeholder: 'Optional, makes an annotated tag' },
            ],
            confirm: 'Add Tag',
          })
          if (v) {
            const root = repo.value!
            await run(v.message ? ['tag', '-a', v.name, '-m', v.message, c.hash] : ['tag', v.name, c.hash], {
              done: `Created tag ${v.name}`,
              undo: { label: `tag ${v.name}`, run: () => git.action(root, ['tag', '-d', v.name]) },
            })
          }
        },
      },
      {
        label: 'Create Branch…',
        icon: 'branch',
        run: async () => {
          const v = await ask({
            title: 'Create Branch',
            message: `Create a branch at commit \`${s}\`.`,
            fields: [
              { name: 'name', label: 'Name', required: true },
              { name: 'checkout', label: 'Check out the new branch', type: 'checkbox', value: true },
            ],
            confirm: 'Create Branch',
          })
          if (v) {
            const root = repo.value!
            const back = currentBranch() ?? log.value?.head
            await run(v.checkout ? ['checkout', '-b', v.name, c.hash] : ['branch', v.name, c.hash], {
              done: `Created branch ${v.name}`,
              undo: {
                label: `branch ${v.name}`,
                run: async () => {
                  if (v.checkout && back) await git.action(root, ['checkout', back])
                  await git.action(root, ['branch', '-D', v.name])
                },
              },
            })
          }
        },
      },
      'separator',
      { label: 'Browse Files at this Commit', icon: 'files', run: () => browse(c.hash) },
      'separator',
      {
        label: 'Checkout…',
        icon: 'checkout',
        run: async () => {
          if (await confirmAction('Checkout Commit', `Check out commit \`${s}\`? This leaves you in a detached HEAD state.`, 'Checkout'))
            await run(['checkout', c.hash], { done: `Checked out ${s}`, undo: { label: `checking out ${s}`, checkout: true } })
        },
      },
      {
        label: 'Cherry Pick…',
        icon: 'cherry',
        run: async () => {
          if (await confirmAction('Cherry Pick', `Cherry pick commit \`${s}\` onto ${into()}?`, 'Cherry Pick'))
            await run(['cherry-pick', ...mainline(c), c.hash], {
              done: `Cherry picked ${s}`,
              undo: { label: `the cherry pick of ${s}`, head: 'keep' },
            })
        },
      },
      {
        label: 'Revert…',
        icon: 'undo',
        run: async () => {
          if (await confirmAction('Revert', `Create a commit that reverts \`${s}\`?`, 'Revert'))
            await run(['revert', '--no-edit', ...mainline(c), c.hash], { done: `Reverted ${s}`, undo: { label: `the revert of ${s}`, head: 'keep' } })
        },
      },
      { label: 'Merge into Current Branch…', icon: 'merge', disabled: c.hash === log.value?.head, run: () => merge(c.hash, `commit \`${s}\``) },
      { label: 'Interactive Rebase from Here…', icon: 'rebase', disabled: !isAncestorOfHead(c.hash), run: () => rebaseFrom(c.hash, s) },
      {
        label: 'Reset Current Branch to this Commit…',
        icon: 'reset',
        danger: true,
        run: async () => {
          const v = await ask({
            title: 'Reset',
            message: `Reset ${into()} to commit \`${s}\`.`,
            fields: [
              {
                name: 'mode',
                label: 'Mode',
                type: 'select',
                value: 'mixed',
                options: [
                  { value: 'soft', label: 'Soft: keep all changes, staged' },
                  { value: 'mixed', label: 'Mixed: keep working tree, reset index' },
                  { value: 'hard', label: 'Hard: discard all changes' },
                ],
              },
            ],
            confirm: 'Reset',
            danger: true,
          })
          if (v) await run(['reset', `--${v.mode}`, c.hash], { done: `Reset to ${s}`, undo: { label: `the reset to ${s}`, head: 'keep' } })
        },
      },
      'separator',
      { label: 'Copy Commit Hash', icon: 'copy', run: () => copy(c.hash, 'commit hash') },
      { label: 'Copy Commit Subject', icon: 'copy', run: () => copy(c.subject, 'commit subject') },
    ]
  }

  function stashMenu(stash: Stash): MenuEntry[] {
    const sel = stash.selector
    return [
      { header: stash.subject, detail: sel },
      { label: 'Apply Stash', icon: 'inbox', run: () => run(['stash', 'apply', sel], { done: `Applied ${sel}` }) },
      { label: 'Pop Stash', icon: 'inbox', run: () => run(['stash', 'pop', sel], { done: `Popped ${sel}` }) },
      {
        label: 'Create Branch from Stash…',
        icon: 'branch',
        run: async () => {
          const v = await ask({
            title: 'Create Branch from Stash',
            message: `Check out a new branch at the commit \`${sel}\` was made on, and apply it there.`,
            fields: [{ name: 'name', label: 'Name', required: true }],
            confirm: 'Create Branch',
          })
          if (v) await run(['stash', 'branch', v.name, sel], { done: `Created ${v.name}` })
        },
      },
      { label: 'Browse Files in Stash', icon: 'files', run: () => browse(stash.hash) },
      'separator',
      {
        label: 'Drop Stash…',
        icon: 'trash',
        danger: true,
        run: async () => {
          if (await confirmAction('Drop Stash', `Permanently delete \`${sel}\`?`, 'Drop', true)) {
            const root = repo.value!
            await run(['stash', 'drop', sel], {
              done: `Dropped ${sel}`,
              // A dropped stash's commit still exists, so it can be stored back.
              undo: { label: `dropping ${sel}`, run: () => git.action(root, ['stash', 'store', '-m', stash.subject, stash.hash]) },
            })
          }
        },
      },
      'separator',
      { label: 'Copy Stash Name', icon: 'copy', run: () => copy(sel, 'stash name') },
      { label: 'Copy Commit Hash', icon: 'copy', run: () => copy(stash.hash, 'commit hash') },
    ]
  }

  function uncommittedMenu(): MenuEntry[] {
    return [
      { header: 'Uncommitted changes', detail: `${log.value?.uncommitted ?? 0} changed file${log.value?.uncommitted === 1 ? '' : 's'}` },
      {
        label: 'Stash Uncommitted Changes…',
        icon: 'archive',
        run: async () => {
          const v = await ask({
            title: 'Stash',
            fields: [
              { name: 'message', label: 'Message', placeholder: 'Optional' },
              { name: 'untracked', label: 'Include untracked files', type: 'checkbox', value: true },
            ],
            confirm: 'Stash',
          })
          if (v) {
            const root = repo.value!
            const previousTop = await git.revParse(root, 'stash@{0}')
            await run(['stash', 'push', ...(v.untracked ? ['--include-untracked'] : []), ...(v.message ? ['-m', v.message] : [])], {
              done: 'Stashed changes',
              undo: {
                label: 'the stash',
                run: async () => {
                  // Only pop if the newest stash is still the one this made.
                  if ((await git.revParse(root, 'stash@{0}')) === previousTop) throw new Error('That stash has already been applied or dropped')
                  await git.action(root, ['stash', 'pop'])
                },
              },
            })
          }
        },
      },
      {
        label: 'Discard All Uncommitted Changes…',
        icon: 'trash',
        danger: true,
        run: async () => {
          const v = await ask({
            title: 'Discard Changes',
            message: 'This permanently discards every uncommitted change in the working tree and index.',
            fields: [{ name: 'clean', label: 'Also delete untracked files', type: 'checkbox', value: false }],
            confirm: 'Discard',
            danger: true,
          })
          if (v) {
            // Back the files up first, so the discard can be undone.
            const root = repo.value!
            const files = (await git.status(root)).files.filter((f) => v.clean || f.kind !== 'untracked')
            const backup = await git.backupFiles(
              root,
              files.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path])),
            )
            await run([['reset', '--hard', 'HEAD'], ...(v.clean ? [['clean', '-fd']] : [])], {
              done: 'Discarded changes',
              undo: { label: 'discarding changes', run: () => git.restoreFiles(root, backup) },
            })
          }
        },
      },
    ]
  }

  function branchMenu(name: string): MenuEntry[] {
    const isCurrent = name === currentBranch()
    return [
      { header: name, detail: isCurrent ? 'Current branch' : 'Local branch' },
      { label: 'Checkout Branch', icon: 'checkout', disabled: isCurrent, run: () => checkoutBranch(name) },
      {
        label: 'Rename Branch…',
        icon: 'pencil',
        run: async () => {
          const v = await ask({
            title: 'Rename Branch',
            fields: [{ name: 'name', label: 'New name', value: name, required: true }],
            confirm: 'Rename',
          })
          if (v && v.name !== name) {
            const root = repo.value!
            await run(['branch', '-m', name, v.name], {
              done: `Renamed to ${v.name}`,
              undo: { label: `renaming ${name}`, run: () => git.action(root, ['branch', '-m', v.name, name]) },
            })
          }
        },
      },
      {
        label: 'Delete Branch…',
        icon: 'trash',
        disabled: isCurrent,
        danger: true,
        run: async () => {
          const v = await ask({
            title: 'Delete Branch',
            message: `Delete branch \`${name}\`?`,
            fields: [{ name: 'force', label: 'Force delete, even if not fully merged', type: 'checkbox', value: false }],
            confirm: 'Delete',
            danger: true,
          })
          if (v) {
            const root = repo.value!
            const hash = refHash('branch', name)
            await run(['branch', v.force ? '-D' : '-d', name], {
              done: `Deleted ${name}`,
              undo: hash ? { label: `deleting ${name}`, run: () => git.action(root, ['branch', name, hash]) } : undefined,
            })
          }
        },
      },
      'separator',
      { label: 'Merge into Current Branch…', icon: 'merge', disabled: isCurrent, run: () => merge(name, `branch \`${name}\``) },
      {
        label: 'Rebase Current Branch on this Branch…',
        icon: 'rebase',
        disabled: isCurrent || !currentBranch(),
        run: async () => {
          if (await confirmAction('Rebase', `Rebase ${into()} onto \`${name}\`?`, 'Rebase'))
            await run(['rebase', name], { busy: 'Rebasing…', done: `Rebased onto ${name}`, undo: { label: `the rebase onto ${name}`, head: 'keep' } })
        },
      },
      {
        label: 'Push Branch…',
        icon: 'push',
        disabled: !remotes().length,
        run: async () => {
          const v = await ask({
            title: 'Push Branch',
            message: `Push \`${name}\` to a remote.`,
            fields: [
              remoteField(),
              { name: 'upstream', label: 'Set upstream', type: 'checkbox', value: true },
              { name: 'force', label: 'Force push (--force-with-lease)', type: 'checkbox', value: false },
            ],
            confirm: 'Push',
          })
          if (v)
            await run(['push', ...(v.upstream ? ['-u'] : []), ...(v.force ? ['--force-with-lease'] : []), v.remote, name], {
              busy: 'Pushing…',
              done: `Pushed ${name}`,
            })
        },
      },
      'separator',
      { label: 'Copy Branch Name', icon: 'copy', run: () => copy(name, 'branch name') },
    ]
  }

  function remoteBranchMenu(remote: string, name: string): MenuEntry[] {
    const full = `${remote}/${name}`
    return [
      { header: full, detail: 'Remote branch' },
      { label: 'Checkout Branch…', icon: 'checkout', run: () => checkoutRemoteBranch(remote, name) },
      { label: 'Merge into Current Branch…', icon: 'merge', run: () => merge(full, `\`${full}\``) },
      {
        label: 'Delete Remote Branch…',
        icon: 'trash',
        danger: true,
        run: async () => {
          if (
            await confirmAction(
              'Delete Remote Branch',
              `Delete \`${name}\` from \`${remote}\`? This changes the remote for everyone.`,
              'Delete',
              true,
            )
          )
            await run(['push', remote, '--delete', name], { busy: 'Deleting…', done: `Deleted ${full}` })
        },
      },
      'separator',
      { label: 'Copy Branch Name', icon: 'copy', run: () => copy(full, 'branch name') },
    ]
  }

  function tagMenu(name: string): MenuEntry[] {
    return [
      { header: name, detail: 'Tag' },
      {
        label: 'Push Tag…',
        icon: 'push',
        disabled: !remotes().length,
        run: async () => {
          const v = await ask({ title: 'Push Tag', message: `Push tag \`${name}\` to a remote.`, fields: [remoteField()], confirm: 'Push' })
          if (v) await run(['push', v.remote, `refs/tags/${name}`], { busy: 'Pushing…', done: `Pushed ${name}` })
        },
      },
      {
        label: 'Delete Tag…',
        icon: 'trash',
        danger: true,
        run: async () => {
          if (await confirmAction('Delete Tag', `Delete local tag \`${name}\`?`, 'Delete', true)) {
            const root = repo.value!
            const hash = refHash('tag', name)
            // Restored as a lightweight tag: an annotated tag's message isn't kept.
            await run(['tag', '-d', name], {
              done: `Deleted tag ${name}`,
              undo: hash ? { label: `deleting tag ${name}`, run: () => git.action(root, ['tag', name, hash]) } : undefined,
            })
          }
        },
      },
      'separator',
      { label: 'Copy Tag Name', icon: 'copy', run: () => copy(name, 'tag name') },
    ]
  }

  async function fetchAll() {
    if (!repo.value) return
    await run(['fetch', '--all', '--prune'], { busy: 'Fetching…', done: 'Fetched from all remotes' })
    lastFetch.value = Date.now()
  }

  return { commitMenu, stashMenu, uncommittedMenu, branchMenu, remoteBranchMenu, tagMenu, checkoutBranch, checkoutRemoteBranch, fetchAll }
}
