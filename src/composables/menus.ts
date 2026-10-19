import type { Commit } from '@/lib/git'
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

export function createMenus({ repo, log, run }: Repo) {
  const currentBranch = () => log.value?.headBranch ?? null
  const remotes = () => log.value?.remotes ?? []
  const hasLocalBranch = (name: string) => !!log.value?.refs.some((r) => r.kind === 'branch' && r.name === name)
  const into = () => (currentBranch() ? `\`${currentBranch()}\`` : 'the detached HEAD')

  const remoteField = (): DialogField => ({
    name: 'remote',
    label: 'Remote',
    type: 'select',
    value: remotes()[0],
    options: remotes().map((r) => ({ value: r, label: r })),
  })

  async function merge(target: string, label: string) {
    const v = await ask({
      title: 'Merge',
      message: `Merge ${label} into ${into()}.`,
      fields: [{ name: 'noFf', label: 'Always create a merge commit (--no-ff)', type: 'checkbox', value: false }],
      confirm: 'Merge',
    })
    if (v) await run(['merge', '--no-edit', ...(v.noFf ? ['--no-ff'] : []), target], { busy: 'Merging…', done: `Merged ${target}` })
  }

  async function checkoutBranch(name: string) {
    if (name === currentBranch()) return
    await run(['checkout', name], { done: `Checked out ${name}` })
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
    else await run(['checkout', '-b', v.name, '--track', `${remote}/${name}`], { done: `Checked out ${v.name}` })
  }

  function commitMenu(c: Commit): MenuEntry[] {
    const s = shortHash(c.hash)
    return [
      {
        label: 'Add Tag…',
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
          if (v) await run(v.message ? ['tag', '-a', v.name, '-m', v.message, c.hash] : ['tag', v.name, c.hash], { done: `Created tag ${v.name}` })
        },
      },
      {
        label: 'Create Branch…',
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
          if (v) await run(v.checkout ? ['checkout', '-b', v.name, c.hash] : ['branch', v.name, c.hash], { done: `Created branch ${v.name}` })
        },
      },
      'separator',
      {
        label: 'Checkout…',
        run: async () => {
          if (await confirmAction('Checkout Commit', `Check out commit \`${s}\`? This leaves you in a detached HEAD state.`, 'Checkout'))
            await run(['checkout', c.hash], { done: `Checked out ${s}` })
        },
      },
      {
        label: 'Cherry Pick…',
        run: async () => {
          if (await confirmAction('Cherry Pick', `Cherry pick commit \`${s}\` onto ${into()}?`, 'Cherry Pick'))
            await run(['cherry-pick', ...mainline(c), c.hash], { done: `Cherry picked ${s}` })
        },
      },
      {
        label: 'Revert…',
        run: async () => {
          if (await confirmAction('Revert', `Create a commit that reverts \`${s}\`?`, 'Revert'))
            await run(['revert', '--no-edit', ...mainline(c), c.hash], { done: `Reverted ${s}` })
        },
      },
      { label: 'Merge into Current Branch…', disabled: c.hash === log.value?.head, run: () => merge(c.hash, `commit \`${s}\``) },
      {
        label: 'Reset Current Branch to this Commit…',
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
          if (v) await run(['reset', `--${v.mode}`, c.hash], { done: `Reset to ${s}` })
        },
      },
      'separator',
      { label: 'Copy Commit Hash', run: () => copy(c.hash, 'commit hash') },
      { label: 'Copy Commit Subject', run: () => copy(c.subject, 'commit subject') },
    ]
  }

  function uncommittedMenu(): MenuEntry[] {
    return [
      {
        label: 'Stash Uncommitted Changes…',
        run: async () => {
          const v = await ask({
            title: 'Stash',
            fields: [
              { name: 'message', label: 'Message', placeholder: 'Optional' },
              { name: 'untracked', label: 'Include untracked files', type: 'checkbox', value: true },
            ],
            confirm: 'Stash',
          })
          if (v)
            await run(['stash', 'push', ...(v.untracked ? ['--include-untracked'] : []), ...(v.message ? ['-m', v.message] : [])], {
              done: 'Stashed changes',
            })
        },
      },
      {
        label: 'Discard All Uncommitted Changes…',
        danger: true,
        run: async () => {
          const v = await ask({
            title: 'Discard Changes',
            message: 'This permanently discards every uncommitted change in the working tree and index.',
            fields: [{ name: 'clean', label: 'Also delete untracked files', type: 'checkbox', value: false }],
            confirm: 'Discard',
            danger: true,
          })
          if (v) await run([['reset', '--hard', 'HEAD'], ...(v.clean ? [['clean', '-fd']] : [])], { done: 'Discarded changes' })
        },
      },
    ]
  }

  function branchMenu(name: string): MenuEntry[] {
    const isCurrent = name === currentBranch()
    return [
      { label: 'Checkout Branch', disabled: isCurrent, run: () => checkoutBranch(name) },
      {
        label: 'Rename Branch…',
        run: async () => {
          const v = await ask({
            title: 'Rename Branch',
            fields: [{ name: 'name', label: 'New name', value: name, required: true }],
            confirm: 'Rename',
          })
          if (v && v.name !== name) await run(['branch', '-m', name, v.name], { done: `Renamed to ${v.name}` })
        },
      },
      {
        label: 'Delete Branch…',
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
          if (v) await run(['branch', v.force ? '-D' : '-d', name], { done: `Deleted ${name}` })
        },
      },
      'separator',
      { label: 'Merge into Current Branch…', disabled: isCurrent, run: () => merge(name, `branch \`${name}\``) },
      {
        label: 'Rebase Current Branch on this Branch…',
        disabled: isCurrent || !currentBranch(),
        run: async () => {
          if (await confirmAction('Rebase', `Rebase ${into()} onto \`${name}\`?`, 'Rebase'))
            await run(['rebase', name], { busy: 'Rebasing…', done: `Rebased onto ${name}` })
        },
      },
      {
        label: 'Push Branch…',
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
      { label: 'Copy Branch Name', run: () => copy(name, 'branch name') },
    ]
  }

  function remoteBranchMenu(remote: string, name: string): MenuEntry[] {
    const full = `${remote}/${name}`
    return [
      { label: 'Checkout Branch…', run: () => checkoutRemoteBranch(remote, name) },
      { label: 'Merge into Current Branch…', run: () => merge(full, `\`${full}\``) },
      {
        label: 'Delete Remote Branch…',
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
      { label: 'Copy Branch Name', run: () => copy(full, 'branch name') },
    ]
  }

  function tagMenu(name: string): MenuEntry[] {
    return [
      {
        label: 'Push Tag…',
        disabled: !remotes().length,
        run: async () => {
          const v = await ask({ title: 'Push Tag', message: `Push tag \`${name}\` to a remote.`, fields: [remoteField()], confirm: 'Push' })
          if (v) await run(['push', v.remote, `refs/tags/${name}`], { busy: 'Pushing…', done: `Pushed ${name}` })
        },
      },
      {
        label: 'Delete Tag…',
        danger: true,
        run: async () => {
          if (await confirmAction('Delete Tag', `Delete local tag \`${name}\`?`, 'Delete', true))
            await run(['tag', '-d', name], { done: `Deleted tag ${name}` })
        },
      },
      'separator',
      { label: 'Copy Tag Name', run: () => copy(name, 'tag name') },
    ]
  }

  async function fetchAll() {
    if (!repo.value) return
    await run(['fetch', '--all', '--prune'], { busy: 'Fetching…', done: 'Fetched from all remotes' })
  }

  return { commitMenu, uncommittedMenu, branchMenu, remoteBranchMenu, tagMenu, checkoutBranch, checkoutRemoteBranch, fetchAll }
}
