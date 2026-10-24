import { computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { git } from '@/lib/git'
import { AGENT_NAMES, type AgentKind } from '@/lib/claudeView'
import type { MenuItem } from './useContextMenu'
import { closeConversation, conversations, forgetRepo } from './claude'
import { forgetSeen } from './agentStatus'
import { takeClaudeTabs } from './panel'
import { prefs } from './prefs'
import type { Repo } from './repo'
import { ask } from './useDialog'
import { showToast } from './useToast'
import { usePersisted } from './usePersisted'

/**
 * An agent: a Claude Code conversation in a tab of the Agents panel, working in the repository, or in a worktree it has
 * to itself (`cwd`, on `branch`, from `base`), so several can change files at once without treading on each other.
 */
export interface AgentTab {
  id: string
  title: string
  /** What runs it; Claude Code when not said. */
  kind?: AgentKind
  cwd?: string
  branch?: string
  /** The commit its worktree started from, to show everything it's changed since, committed or not. */
  base?: string
}

interface AgentsState {
  tabs: AgentTab[]
  active: string | null
}

/** Every repository's agents, so each repo tab reopens with its own. */
const store = usePersisted<Record<string, AgentsState>>('agent-tabs', {})

const newId = () => Math.random().toString(36).slice(2, 10)

/** Forgets a repository's agents (its tab's closed): their conversations go, and the tabs. Worktrees stay. */
export function forgetAgents(repo: string) {
  forgetSeen((store.value[repo]?.tabs ?? []).map((t) => t.id))
  forgetRepo(repo)
  if (!store.value[repo]) return
  const rest = { ...store.value }
  delete rest[repo]
  store.value = rest
}

/** A worktree folder for an agent's branch: next to the repository, named after it. */
const agentWorktreePath = (repo: string, branch: string) => `${repo}-${branch.replace(/[^\w.-]+/g, '-')}`

export function createAgents({ repo, reload }: Repo) {
  const state = computed<AgentsState>(() => (repo.value && store.value[repo.value]) || { tabs: [], active: null })
  const tabs = computed(() => state.value.tabs)
  const active = computed(() => tabs.value.find((t) => t.id === state.value.active) ?? tabs.value[0] ?? null)
  /** Shown in place of the graph rather than under the terminal (when shown at all). */
  const expanded = prefs.agentsExpanded

  function update(change: (s: AgentsState) => void) {
    const path = repo.value
    if (!path) return
    const next: AgentsState = JSON.parse(JSON.stringify(state.value))
    change(next)
    store.value = { ...store.value, [path]: next }
  }

  // Claude conversations from before agents had a panel of their own move here.
  watch(
    repo,
    (path) => {
      const moved = path ? takeClaudeTabs(path) : []
      if (moved.length) update((s) => s.tabs.push(...moved.filter((m) => !s.tabs.some((t) => t.id === m.id))))
    },
    { immediate: true },
  )

  /** Brings the panel into view, where it was: docked, or over the graph. */
  const show = () => (prefs.agentsOpen.value = true)

  function activate(id: string) {
    update((s) => (s.active = id))
    show()
  }

  /** A new agent run by `kind`, in the repository or (`at`) a worktree. Returns its id. */
  function add(at?: { cwd: string; branch: string; base?: string }, kind: AgentKind = 'claude') {
    const id = newId()
    update((s) => {
      s.tabs.push({ id, title: at ? at.branch : 'Agent', ...at, ...(kind !== 'claude' ? { kind } : {}) })
      s.active = id
    })
    show()
    return id
  }

  /** A new agent in a worktree of its own, on a new branch from what's checked out here. */
  async function addInWorktree(kind: AgentKind = 'claude') {
    const root = repo.value
    if (!root) return
    const v = await ask({
      title: 'New Agent in a Worktree',
      message: 'The agent gets a folder of its own, on a new branch from here, so it can change files without touching yours.',
      fields: [
        {
          name: 'kind',
          label: 'Agent',
          type: 'select',
          value: kind,
          options: (['claude', 'opencode'] as const).map((k) => ({ value: k, label: AGENT_NAMES[k] })),
        },
        { name: 'branch', label: 'Branch', value: `agent/${newId().slice(0, 5)}`, required: true },
        { name: 'path', label: 'Folder', placeholder: 'Next to this repository, named after the branch' },
      ],
      confirm: 'Create',
    })
    if (!v) return
    const branch = String(v.branch).trim()
    const cwd = String(v.path ?? '').trim() || agentWorktreePath(root, branch)
    showToast('Creating worktree…', 'busy')
    const base = (await git.revParse(root, 'HEAD').catch(() => null)) ?? undefined
    try {
      await git.action(root, ['worktree', 'add', '-b', branch, cwd, base ?? 'HEAD'])
    } catch (e) {
      return showToast(String(e), 'error')
    }
    showToast(`Agent on ${branch}, in its own worktree`, 'ok')
    void reload()
    return add({ cwd, branch, base }, v.kind === 'opencode' ? 'opencode' : 'claude')
  }

  /** Menu items to start an agent run by either tool: in the repository, or (`at`) alongside others in a worktree. */
  const newAgentItems = (at?: { cwd: string; branch: string; base?: string }): MenuItem[] =>
    (['claude', 'opencode'] as const).map((kind) => ({ label: `New ${AGENT_NAMES[kind]} Agent`, icon: 'bot', run: () => add(at, kind) }))

  /** Closes an agent: Claude stops, and the conversation goes in the past ones. Its worktree stays. */
  function close(id: string) {
    closeConversation(id)
    forgetSeen([id])
    update((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      if (i === -1) return
      s.tabs.splice(i, 1)
      if (s.active === id) s.active = s.tabs[Math.min(i, s.tabs.length - 1)]?.id ?? null
    })
  }

  /**
   * Removes a worktree's folder (and any tab showing it), closing the agents working in it; its branch and commits
   * stay. Asks first, and whether to remove it even with changes that weren't committed.
   */
  async function removeWorktree(cwd: string) {
    const root = repo.value
    if (!root || cwd === root) return
    const agents = tabs.value.filter((t) => t.cwd === cwd)
    const branch = agents.find((t) => t.branch)?.branch
    const v = await ask({
      title: 'Remove Worktree',
      message: `Delete the folder \`${cwd}\`${agents.length ? `, closing ${agents.length === 1 ? 'its agent' : `its ${agents.length} agents`}` : ''}?${branch ? ` The branch \`${branch}\` and its commits stay.` : ''}`,
      fields: [{ name: 'force', label: 'Even with changes that weren’t committed, which are lost', type: 'checkbox', value: false }],
      confirm: 'Remove',
      danger: true,
    })
    if (!v) return
    // A tab showing the worktree closes first (it may ask about unsaved edits there).
    const { useWorkspaces } = await import('./workspace')
    if (!(await useWorkspaces().closeRepo(cwd))) return
    for (const a of agents) close(a.id)
    try {
      await git.action(root, ['worktree', 'remove', ...(v.force ? ['--force'] : []), cwd])
      showToast(`Removed ${cwd.split('/').pop()}`, 'ok')
    } catch (e) {
      showToast(String(e), 'error')
    }
    void reload()
  }

  /** Puts an agent to sleep: Claude stops for now, and the next message wakes it, carrying on where it was. */
  const sleep = (id: string) => invoke('claude_stop', { id })

  /** Asks for an agent's new name. */
  async function renameAgent(t: AgentTab) {
    const v = await ask({ title: 'Rename Agent', fields: [{ name: 'title', label: 'Name', value: titleOf(t), required: true }], confirm: 'Rename' })
    if (v) rename(t.id, String(v.title).trim())
  }

  function move(from: number, to: number) {
    update((s) => void s.tabs.splice(to, 0, ...s.tabs.splice(from, 1)))
  }

  function rename(id: string, title: string) {
    update((s) => {
      const t = s.tabs.find((x) => x.id === id)
      if (t) t.title = title
    })
  }

  /**
   * What an agent's called: the name you gave it, or, until you do, what it's about once you've said something (its
   * conversation's first message).
   */
  function titleOf(t: AgentTab) {
    const named = t.title !== 'Agent' && t.title !== 'Claude' && t.title !== t.branch
    const about = conversations.value[t.id]?.title
    return named || !about ? t.title : about.length > 28 ? `${about.slice(0, 27).trimEnd()}…` : about
  }

  return {
    tabs,
    active,
    expanded,
    show,
    activate,
    add,
    addInWorktree,
    close,
    removeWorktree,
    sleep,
    move,
    rename,
    renameAgent,
    titleOf,
    newAgentItems,
  }
}

export type Agents = ReturnType<typeof createAgents>
