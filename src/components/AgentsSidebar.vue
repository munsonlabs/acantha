<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { usageText } from '@/lib/claudeView'
import type { AgentTab } from '@/composables/agents'
import { agentState, mostPressing, stateWords, usageOf, useAgentActivity, type AgentState } from '@/composables/agentStatus'
import { isPoppedOut, popOut } from '@/composables/claudeWindow'
import { copyText } from '@/composables/openers'
import { openMenu } from '@/composables/useContextMenu'
import { useWorkspace, useWorkspaces, type Workspace } from '@/composables/workspace'
import AgentGlyph from './AgentGlyph.vue'
import Icon from './Icon.vue'

/**
 * The sidebar's Agents tab: this repository's agents grouped by where they work (this folder on its branch, then each
 * worktree on its own), the most pressing first in each, with what each has used. A worktree opens in a tab of its own
 * (on its Git panel) for its changes; this folder's are the Git panel's. Then other repositories' agents that are busy
 * or done, to jump to.
 */
const ws = useWorkspace()
const { workspaces, activate: activateWorkspace, showRepo } = useWorkspaces()
const { tabs, active, activate, add, addInWorktree, close, removeWorktree, sleep, renameAgent, titleOf } = ws.agents
const activity = useAgentActivity()
// Ticks the "working 3m" along.
const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(tick))

const root = computed(() => ws.repo.repo.value!)
const ORDER: AgentState[] = ['waiting', 'working', 'done', 'idle', 'off']
const byState = (a: AgentTab, b: AgentTab) => ORDER.indexOf(agentState(a.id)) - ORDER.indexOf(agentState(b.id))

/** Where agents work: this folder, on whatever's checked out, or a worktree of its own on its branch. */
interface Place {
  cwd: string
  main: boolean
  branch: string | null
  /** For a worktree: the commit it started from, when that's known. */
  base?: string
  agents: AgentTab[]
}
const places = computed<Place[]>(() => {
  const here = tabs.value.filter((t) => !t.cwd || t.cwd === root.value)
  const list: Place[] = [{ cwd: root.value, main: true, branch: ws.repo.log.value?.headBranch ?? null, agents: [...here].sort(byState) }]
  for (const t of tabs.value) {
    if (!t.cwd || t.cwd === root.value) continue
    let p = list.find((x) => x.cwd === t.cwd)
    if (!p) list.push((p = { cwd: t.cwd, main: false, branch: t.branch ?? null, agents: [] }))
    p.base ??= t.base
    p.agents.push(t)
  }
  for (const p of list) p.agents.sort(byState)
  // This folder shows even without agents, as where a new one starts; worktrees only while they have some.
  return list.filter((p) => p.main || p.agents.length)
})
const placeName = (p: Place) => p.branch ?? (p.main ? 'detached HEAD' : (p.cwd.split('/').pop() ?? p.cwd))
const placeState = (p: Place) => mostPressing(p.agents.map((a) => agentState(a.id)))
const usage = (agents: AgentTab[]) =>
  usageText(
    agents.reduce(
      (sum, a) => {
        const u = usageOf(a.id)
        return { spent: sum.spent + (u.spent ?? 0), tokensIn: sum.tokensIn + (u.tokensIn ?? 0), tokensOut: sum.tokensOut + (u.tokensOut ?? 0) }
      },
      { spent: 0, tokensIn: 0, tokensOut: 0 },
    ),
  )

/** Other repositories' agents worth a look: needing you, working, or done. */
const elsewhere = computed(() =>
  workspaces.value
    .filter((w) => w !== ws && w.repo.repo.value)
    .flatMap((w) => w.agents.tabs.value.map((agent) => ({ w, agent, state: agentState(agent.id) })))
    .filter((x) => x.state !== 'idle' && x.state !== 'off'),
)

function pick(agent: AgentTab) {
  activate(agent.id)
  if (isPoppedOut(agent.id)) void popOut(agent.id, root.value)
}
function jump(w: Workspace, agent: AgentTab) {
  activateWorkspace(w.id)
  w.agents.activate(agent.id)
  if (isPoppedOut(agent.id) && w.repo.repo.value) void popOut(agent.id, w.repo.repo.value)
}

/** A new agent where `p` is: this folder, or alongside the others in its worktree. */
const addHere = (p: Place) => (p.main ? add() : add({ cwd: p.cwd, branch: p.branch ?? placeName(p), base: p.base }))
const copyName = (p: Place) => copyText(placeName(p), p.main ? 'branch name' : 'worktree name')

function agentMenu(e: MouseEvent, agent: AgentTab) {
  const p = places.value.find((x) => x.agents.includes(agent))!
  const running = !!activity.value[agent.id]?.running
  openMenu(e, [
    { header: titleOf(agent), detail: p.main ? `In this folder, on ${placeName(p)}` : `In a worktree, on ${placeName(p)}` },
    { label: 'Rename…', icon: 'pencil', run: () => renameAgent(agent) },
    { label: isPoppedOut(agent.id) ? 'Show its Window' : 'Pop Out', icon: 'external', run: () => popOut(agent.id, root.value) },
    { label: 'Sleep', icon: 'moon', disabled: !running, run: () => sleep(agent.id) },
    'separator',
    { label: p.main ? 'Copy Branch Name' : 'Copy Worktree Name', icon: 'copy', run: () => copyName(p) },
    { label: 'Copy Folder Path', icon: 'copy', run: () => copyText(p.cwd, 'folder path') },
    'separator',
    { label: 'Close Agent', icon: 'x', run: () => close(agent.id) },
    ...(!p.main ? [{ label: 'Close and Remove its Worktree…', icon: 'trash' as const, danger: true, run: () => removeWorktree(p.cwd) }] : []),
  ])
}

function placeMenu(e: MouseEvent, p: Place) {
  const awake = p.agents.filter((a) => activity.value[a.id]?.running)
  openMenu(e, [
    { header: placeName(p), detail: p.cwd },
    { label: 'New Agent Here', icon: 'plus', run: () => addHere(p) },
    { label: 'Put its Agents to Sleep', icon: 'moon', disabled: !awake.length, run: () => awake.forEach((a) => sleep(a.id)) },
    'separator',
    { label: p.main ? 'Copy Branch Name' : 'Copy Worktree Name', icon: 'copy', run: () => copyName(p) },
    { label: 'Copy Folder Path', icon: 'copy', run: () => copyText(p.cwd, 'folder path') },
    ...(!p.main
      ? [
          { label: 'Open in a Tab', icon: 'external' as const, run: () => openWorktree(p) },
          'separator' as const,
          { label: 'Remove Worktree…', icon: 'trash' as const, danger: true, run: () => removeWorktree(p.cwd) },
        ]
      : []),
  ])
}

/** A worktree's own tab, on its Git panel: its changes, commits and branch, as for any repository. */
async function openWorktree(p: Place) {
  await showRepo(p.cwd)
  const tab = workspaces.value.find((w) => w.repo.repo.value === p.cwd)
  if (tab) tab.ui.sidebarTab.value = 'scm'
}
/** This folder's changes are the Git panel's, a tab over. */
const showGit = () => (ws.ui.sidebarTab.value = 'scm')
</script>

<template>
  <div class="agents-sidebar">
    <div class="scroll">
      <p v-if="!tabs.length" class="none">No agents in this repository yet.</p>
      <p v-else-if="usage(tabs)" class="summary-line">{{ tabs.length === 1 ? '1 agent' : `${tabs.length} agents` }} · {{ usage(tabs) }}</p>

      <section v-for="p in places" :key="p.cwd" class="place">
        <h3 :title="p.cwd" @contextmenu.prevent="placeMenu($event, p)">
          <Icon :name="p.main ? 'home' : 'branch'" :size="12" />
          <span class="place-name">{{ placeName(p) }}</span>
          <span class="where">{{ p.main ? 'this folder' : 'worktree' }}</span>
          <AgentGlyph v-if="p.agents.length && placeState(p) !== 'idle' && placeState(p) !== 'off'" :state="placeState(p)" />
          <span class="spacer" />
          <button v-if="p.main && ws.status.files.value.length" class="ghost link" title="Its changes, in the Git panel" @click="showGit">
            <Icon name="scm" :size="11" /> {{ ws.status.files.value.length }}
          </button>
          <button v-if="!p.main" class="ghost mini" title="Open the worktree in a tab of its own, on its Git panel" @click="openWorktree(p)">
            <Icon name="external" :size="11" />
          </button>
          <button class="ghost mini" title="New agent here" @click="addHere(p)"><Icon name="plus" :size="11" /></button>
        </h3>

        <div
          v-for="agent in p.agents"
          :key="agent.id"
          class="agent"
          :class="{ on: agent.id === active?.id }"
          role="button"
          tabindex="0"
          @click="pick(agent)"
          @keydown.enter="pick(agent)"
          @contextmenu.prevent="agentMenu($event, agent)"
        >
          <AgentGlyph :state="agentState(agent.id)" />
          <span class="what">
            <span class="title">{{ titleOf(agent) }}</span>
            <span class="sub"
              >{{ stateWords(agent.id, now) }}<template v-if="usage([agent])"> · {{ usage([agent]) }}</template></span
            >
          </span>
          <Icon v-if="isPoppedOut(agent.id)" name="external" :size="11" class="popped" />
          <button class="ghost close" title="Close Agent (right-click for more)" @click.stop="close(agent.id)"><Icon name="x" :size="11" /></button>
        </div>
        <p v-if="!p.agents.length" class="quiet-line">No agents here.</p>
      </section>

      <section v-if="elsewhere.length">
        <h3>Other repositories</h3>
        <button v-for="x in elsewhere" :key="x.agent.id" class="ghost agent" @click="jump(x.w, x.agent)">
          <AgentGlyph :state="x.state" />
          <span class="what">
            <span class="title">{{ x.w.agents.titleOf(x.agent) }}</span>
            <span class="sub">{{ x.w.repo.repo.value?.split('/').pop() }} · {{ stateWords(x.agent.id, now) }}</span>
          </span>
        </button>
      </section>
    </div>
    <footer>
      <button class="ghost" @click="add()"><Icon name="plus" :size="12" /> New Agent</button>
      <button class="ghost" title="A new agent in a worktree of its own" @click="addInWorktree()">
        <Icon name="folder" :size="12" /> In Worktree
      </button>
    </footer>
  </div>
</template>

<style scoped>
.agents-sidebar {
  display: flex;
  flex-direction: column;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}
.none {
  margin: 14px 8px;
  color: var(--fg-faint);
  font-size: 12px;
}
h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 6px 4px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
}
.count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--pill);
  font: 500 10px var(--font);
}
.agent {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: auto;
  padding: 6px 8px;
  border-radius: 8px;
  text-align: left;
}
.agent.on {
  background: var(--selected);
}
.what {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.title {
  overflow: hidden;
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sub {
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.popped {
  flex: none;
  color: var(--fg-faint);
}
.agent {
  cursor: pointer;
}
.agent:hover {
  background: var(--hover);
}
.agent.on:hover {
  background: var(--selected);
}
.close {
  display: grid;
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  place-items: center;
  border-radius: 5px;
  color: var(--fg-faint);
  opacity: 0;
}
.agent:hover .close,
.close:focus-visible {
  opacity: 1;
}
.close:hover {
  color: var(--fg);
}
.summary-line,
.quiet-line {
  margin: 4px 8px 2px;
  color: var(--fg-faint);
  font-size: 11px;
}
.place + .place {
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.place-name {
  overflow: hidden;
  color: var(--fg-muted);
  font-family: var(--mono);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.where {
  flex: none;
  font-weight: 400;
}
.spacer {
  flex: 1;
}
.link {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  color: var(--fg-faint);
  font-size: 11px;
}
.mini {
  display: grid;
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  place-items: center;
  color: var(--fg-faint);
}
footer {
  display: flex;
  flex: none;
  gap: 6px;
  padding: 6px;
  border-top: 1px solid var(--border);
}
footer button {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  font-size: 12px;
}
</style>
