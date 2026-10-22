import { git, type Commit, type Stash, type Worktree } from '@/lib/git'
import { shortHash } from '@/lib/format'
import { folderOpenItems } from './openers'
import { ask, confirmAction, type DialogField } from './useDialog'
import type { Repo } from './repo'
import { showToast } from './useToast'
import type { MenuEntry, MenuItem } from './useContextMenu'

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
  /** base: rebase the commits after it; null for the whole history. */
  rebaseFrom: (base: string | null, label: string) => void
  /** Shows a worktree in its own tab: the one it's already open in, or a new one. */
  openWorktree: (path: string) => void
  /** Closes any tab showing a worktree, before it's removed. False when unsaved edits there were kept. */
  closeWorktree: (path: string) => Promise<boolean>
}

export function createMenus(
  { repo, log, rows, run, lastFetch, refsByHash, branches, setBranches }: Repo,
  { browse, rebaseFrom, openWorktree, closeWorktree }: MenuActions,
) {
  const currentBranch = () => log.value?.headBranch ?? null
  const remotes = () => log.value?.remotes ?? []
  const hasLocalBranch = (name: string) => !!log.value?.refs.some((r) => r.kind === 'branch' && r.name === name)
  /** The commit a branch or tag points at, so deleting it can be undone. */
  const refHash = (kind: 'branch' | 'tag', name: string) => log.value?.refs.find((r) => r.kind === kind && r.name === name)?.hash
  const worktrees = () => log.value?.worktrees ?? []
  /** The other worktree a branch is checked out in, if any: git won't check it out a second time. */
  const worktreeOf = (name: string) => worktrees().find((w) => w.branch === name && !w.current)
  const folderName = (path: string) => path.split('/').pop() || path
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

  const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`

  /**
   * Checks out a local branch. When it's behind its upstream (or `against`, a remote branch), it offers to bring it up
   * to date on the way, as Git Graph does: a fast-forward only, so nothing is merged and no commit of yours can be lost.
   * A branch with commits of its own as well can't simply catch up, so it's checked out as it is, with a note. Git
   * itself refuses a checkout that would overwrite uncommitted changes.
   */
  async function checkoutBranch(name: string, against?: string) {
    if (name === currentBranch()) return
    const elsewhere = worktreeOf(name)
    if (elsewhere) {
      showToast(`${name} is checked out in ${folderName(elsewhere.path)}`)
      return openWorktree(elsewhere.path)
    }
    const t = await git.tracking(repo.value!, name, against).catch(() => null)
    let pull = false
    if (t?.behind) {
      const v = await ask({
        title: 'Checkout Branch',
        message: t.ahead
          ? `\`${name}\` is ${commits(t.behind)} behind \`${t.upstream}\` and ${commits(t.ahead)} ahead, so it can't simply catch up. It's checked out as it is; pull to merge or rebase it.`
          : `\`${name}\` is ${commits(t.behind)} behind \`${t.upstream}\`.`,
        fields: t.ahead ? [] : [{ name: 'pull', label: `Bring it up to date with ${t.upstream} (fast-forward)`, type: 'checkbox', value: true }],
        confirm: 'Checkout',
      })
      if (!v) return
      pull = !!v.pull
    }
    await run(
      pull
        ? [
            ['checkout', name],
            ['merge', '--ff-only', t!.upstream],
          ]
        : ['checkout', name],
      {
        done: pull ? `Checked out ${name}, up to date with ${t!.upstream}` : `Checked out ${name}`,
        undo: { label: `checking out ${name}`, checkout: true },
      },
    )
  }

  async function checkoutRemoteBranch(remote: string, name: string) {
    const v = await ask({
      title: 'Checkout Remote Branch',
      message: hasLocalBranch(name)
        ? `There's already a local \`${name}\`: it's checked out, and brought up to date with \`${remote}/${name}\` if it's behind. Or name a new branch.`
        : `Create a local branch tracking \`${remote}/${name}\`.`,
      fields: [{ name: 'name', label: 'Local branch name', value: name, required: true }],
      confirm: 'Checkout',
    })
    if (!v) return
    if (hasLocalBranch(v.name)) await checkoutBranch(v.name, `${remote}/${name}`)
    else
      await run(['checkout', '-b', v.name, '--track', `${remote}/${name}`], {
        done: `Checked out ${v.name}`,
        undo: { label: `checking out ${v.name}`, checkout: true },
      })
    // Filtering on the remote branch: show the local one too, so what you just checked out stays in view.
    const remoteRef = `refs/remotes/${remote}/${name}`
    const localRef = `refs/heads/${v.name}`
    const picked = branches.value
    if (picked.includes(remoteRef) && !picked.includes(localRef) && hasLocalBranch(v.name)) await setBranches([...picked, localRef])
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
              // Pushing straight away saves a trip to the tag's own menu; Undo still only removes the local tag.
              ...(remotes().length
                ? [
                    {
                      name: 'push',
                      label:
                        remotes().length === 1
                          ? `Push to ${remotes()[0]} (Undo removes only the local tag)`
                          : 'Push it too (Undo removes only the local tag)',
                      type: 'checkbox' as const,
                      value: false,
                    },
                    ...(remotes().length > 1 ? [remoteField()] : []),
                  ]
                : []),
            ],
            confirm: 'Add Tag',
          })
          if (v) {
            const root = repo.value!
            const create = v.message ? ['tag', '-a', v.name, '-m', v.message, c.hash] : ['tag', v.name, c.hash]
            const remote = v.remote ?? remotes()[0]
            await run(v.push ? [create, ['push', remote, `refs/tags/${v.name}`]] : create, {
              busy: v.push ? 'Pushing…' : undefined,
              done: v.push ? `Created tag ${v.name} and pushed it to ${remote}` : `Created tag ${v.name}`,
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
      { label: 'New Worktree from Here…', icon: 'folder', run: () => addWorktree({ from: c.hash, label: `\`${s}\`` }) },
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
      // From here means including this commit, so the latest one can be reworded, and squashing the latest into the
      // one before starts from that one.
      {
        label: 'Interactive Rebase from Here…',
        icon: 'rebase',
        disabled: c.hash !== log.value?.head && !isAncestorOfHead(c.hash),
        run: () => rebaseFrom(c.parents[0] ?? null, c.parents[0] ? shortHash(c.parents[0]) : 'the root'),
      },
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
      ...branchCopyItems(c.hash),
      { label: 'Copy Commit Hash', icon: 'copy', run: () => copy(c.hash, 'commit hash') },
      { label: 'Copy Commit Subject', icon: 'copy', run: () => copy(c.subject, 'commit subject') },
    ]
  }

  /** Copy for the branches at a commit: local ones, or its remote ones when it has none. */
  function branchCopyItems(hash: string): MenuEntry[] {
    const refs = refsByHash.value.get(hash)
    const local = refs?.branches.map((b) => b.name) ?? []
    const names = local.length ? local : (refs?.remotes.map((r) => `${r.remote}/${r.name}`) ?? [])
    if (names.length === 1) return [{ label: 'Copy Branch Name', icon: 'copy', run: () => copy(names[0], 'branch name') }]
    return names.slice(0, 5).map((name) => ({ label: `Copy “${name}”`, icon: 'copy' as const, run: () => copy(name, 'branch name') }))
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
    const elsewhere = worktreeOf(name)
    return [
      { header: name, detail: isCurrent ? 'Current branch' : elsewhere ? `Checked out in ${folderName(elsewhere.path)}` : 'Local branch' },
      elsewhere
        ? { label: 'Open its Worktree', icon: 'external', run: () => openWorktree(elsewhere.path) }
        : { label: 'Checkout Branch', icon: 'checkout', disabled: isCurrent, run: () => checkoutBranch(name) },
      { label: 'Check Out in New Worktree…', icon: 'folder', disabled: isCurrent || !!elsewhere, run: () => addWorktree({ branch: name }) },
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
        disabled: isCurrent || !!elsewhere,
        danger: true,
        run: async () => {
          // The same branch on a remote can go too, but only when asked: that changes the remote for everyone.
          const onRemotes = (log.value?.refs ?? []).filter((r) => r.kind === 'remote' && r.name === name).map((r) => r.remote!)
          const v = await ask({
            title: 'Delete Branch',
            message: `Delete branch \`${name}\`?${onRemotes.length ? ' Deleting it on a remote changes it for everyone, and Undo only brings back the local branch.' : ''}`,
            fields: [
              { name: 'force', label: 'Force delete, even if not fully merged', type: 'checkbox', value: false },
              ...onRemotes.map((r) => ({
                name: `remote:${r}`,
                label: `Also delete ${r}/${name} on the remote`,
                type: 'checkbox' as const,
                value: false,
              })),
            ],
            confirm: 'Delete',
            danger: true,
          })
          if (v) {
            const root = repo.value!
            const hash = refHash('branch', name)
            const alsoRemote = onRemotes.filter((r) => v[`remote:${r}`])
            await run([['branch', v.force ? '-D' : '-d', name], ...alsoRemote.map((r) => ['push', r, '--delete', name])], {
              busy: alsoRemote.length ? 'Deleting…' : undefined,
              done: `Deleted ${[name, ...alsoRemote.map((r) => `${r}/${name}`)].join(' and ')}`,
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

  /** Where a new worktree goes unless told otherwise: next to the main one, named after it and the branch. */
  function worktreePath(branch: string) {
    const main = worktrees().find((w) => w.main)?.path ?? repo.value!
    return `${main}-${branch.replace(/[^\w.-]+/g, '-')}`
  }

  /** Adds a worktree, for an existing branch or a new one starting at `from`, and opens it in a tab of its own. */
  async function addWorktree(target: { branch: string } | { from: string; label: string }) {
    const existing = 'branch' in target
    const v = await ask({
      title: 'New Worktree',
      message: existing
        ? `Check out \`${target.branch}\` in a folder of its own, to work on it alongside this one.`
        : `A new branch from ${target.label}, checked out in a folder of its own.`,
      fields: [
        ...(existing ? [] : [{ name: 'name', label: 'New branch', required: true }]),
        { name: 'path', label: 'Folder', placeholder: 'Next to this repository, named after the branch' },
      ],
      confirm: 'Create',
    })
    if (!v) return
    const branch = existing ? target.branch : String(v.name).trim()
    const path = String(v.path ?? '').trim() || worktreePath(branch)
    await run(existing ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, target.from], {
      busy: 'Creating worktree…',
      done: `Checked out ${branch} in ${folderName(path)}`,
    })
    const made = worktreeOf(branch)
    if (made) openWorktree(made.path)
  }

  const lockedBy = (w: Worktree) => (w.lockReason ? `locked: ${w.lockReason}` : 'locked')

  async function removeWorktree(w: Worktree) {
    const v = await ask({
      title: 'Remove Worktree',
      message: `Delete the folder \`${w.path}\`? ${w.branch ? `The branch \`${w.branch}\` and its` : 'Its'} commits stay in the repository.${
        w.locked ? ` It's ${lockedBy(w)}, so something may still be using it.` : ''
      }`,
      fields: [
        // Git won't remove a locked worktree; unlocking first keeps the uncommitted-changes check separate.
        ...(w.locked ? [{ name: 'unlock', label: 'Unlock it and remove it anyway', type: 'checkbox' as const, value: true }] : []),
        { name: 'force', label: 'Even with uncommitted changes, which are lost', type: 'checkbox', value: false },
      ],
      confirm: 'Remove',
      danger: true,
    })
    if (!v) return
    if (w.locked && !v.unlock) return showToast(`${folderName(w.path)} is ${lockedBy(w)}; unlock it to remove it`, 'error')
    if (!(await closeWorktree(w.path))) return
    await run([...(w.locked ? [['worktree', 'unlock', w.path]] : []), ['worktree', 'remove', ...(v.force ? ['-f'] : []), w.path]], {
      busy: 'Removing worktree…',
      done: `Removed ${folderName(w.path)}`,
    })
  }

  function worktreeMenu(w: Worktree): MenuEntry[] {
    return [
      { header: folderName(w.path), detail: w.branch ?? (w.head ? `Detached at ${shortHash(w.head)}` : w.path) },
      { label: 'Open in New Tab', icon: 'external', disabled: w.current || w.prunable, run: () => openWorktree(w.path) },
      ...(w.prunable ? [] : folderOpenItems(w.path)),
      'separator',
      ...(w.locked
        ? [
            {
              label: 'Unlock Worktree',
              icon: 'check',
              run: () => run(['worktree', 'unlock', w.path], { done: `Unlocked ${folderName(w.path)}` }),
            } satisfies MenuItem,
          ]
        : []),
      w.prunable
        ? { label: 'Prune Missing Worktrees', icon: 'trash', run: () => run(['worktree', 'prune'], { done: 'Pruned missing worktrees' }) }
        : { label: 'Remove Worktree…', icon: 'trash', danger: true, disabled: w.main || w.current, run: () => removeWorktree(w) },
    ]
  }

  async function fetchAll() {
    if (!repo.value) return
    await run(['fetch', '--all', '--prune'], { busy: 'Fetching…', done: 'Fetched from all remotes' })
    lastFetch.value = Date.now()
  }

  return {
    commitMenu,
    stashMenu,
    uncommittedMenu,
    branchMenu,
    remoteBranchMenu,
    tagMenu,
    worktreeMenu,
    addWorktree,
    openWorktree,
    checkoutBranch,
    checkoutRemoteBranch,
    fetchAll,
  }
}
