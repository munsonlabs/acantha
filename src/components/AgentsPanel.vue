<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentTab } from '@/composables/agents'
import { agentState, useAgentActivity } from '@/composables/agentStatus'
import { prefs } from '@/composables/prefs'
import { runCommand } from '@/composables/commands'
import { useSlidingPill, useTabDrag, useTabScroll } from '@/composables/tabs'
import { openMenu } from '@/composables/useContextMenu'
import { useWorkspace } from '@/composables/workspace'
import AgentGlyph from './AgentGlyph.vue'
import AgentMark from './AgentMark.vue'
import AgentView from './AgentView.vue'
import Icon from './Icon.vue'

/**
 * The Agents panel: a tab for each agent (a Claude Code conversation) in this repository, each saying what it's up to.
 * docked: under the terminal; otherwise over the graph. Any agent can also pop out to float on the desktop.
 */
const props = defineProps<{ docked?: boolean }>()
const ws = useWorkspace()
const { tabs, active, expanded, activate, addInWorktree, newAgentItems, close, removeWorktree, move, renameAgent, titleOf } = ws.agents
useAgentActivity()

const strip = ref<HTMLElement>()
const pill = useSlidingPill(strip, () => [active.value?.id, tabs.value.map((t) => `${t.id}:${titleOf(t)}`)])
const { dragging, onPointerDown } = useTabDrag(strip, move)
useTabScroll(strip, () => active.value?.id)
function onTabDown(e: PointerEvent, t: AgentTab, index: number) {
  if (e.button !== 0) return
  activate(t.id)
  onPointerDown(e, index)
}

function newAgent(e: MouseEvent) {
  openMenu(e, [
    ...newAgentItems(),
    'separator',
    { label: 'New Agent in a Worktree…', icon: 'folder', run: () => addInWorktree() },
    { label: 'Take a Tour of This Repository…', icon: 'eye', run: () => runCommand('tour') },
  ])
}

function tabMenu(e: MouseEvent, t: AgentTab) {
  openMenu(e, [
    { label: 'Rename…', icon: 'pencil', run: () => renameAgent(t) },
    ...(t.base ? [{ label: 'Review its Work', icon: 'eye' as const, run: () => (ws.ui.review.value = t.id) }] : []),
    'separator',
    { label: 'Close Agent', icon: 'x', run: () => close(t.id) },
    ...(t.cwd ? [{ label: 'Close and Remove its Worktree…', icon: 'trash' as const, danger: true, run: () => removeWorktree(t.cwd!) }] : []),
  ])
}

const current = computed(() => active.value)
const expand = () => (expanded.value = true)
function dock() {
  expanded.value = false
  prefs.agentsOpen.value = true
}
/** Puts the agents away, from under the terminal or over the graph alike; they carry on working, and come back where they were. */
const hide = () => (prefs.agentsOpen.value = false)
</script>

<template>
  <section class="agents-panel" :class="{ pane: props.docked, docked: props.docked }">
    <header class="pane-header">
      <div ref="strip" class="tabs pilled">
        <span class="tab-pill" :style="pill.style.value" />
        <div
          v-for="(t, i) in tabs"
          :key="t.id"
          class="tab"
          :class="{ active: t.id === current?.id, dragging: dragging === i }"
          :title="t.branch ? `${titleOf(t)} · on ${t.branch}, in its own worktree` : titleOf(t)"
          @pointerdown="onTabDown($event, t, i)"
          @dblclick="renameAgent(t)"
          @auxclick.middle="close(t.id)"
          @contextmenu.prevent="tabMenu($event, t)"
        >
          <AgentGlyph :state="agentState(t.id)" />
          <AgentMark :kind="t.kind" />
          <span class="label">{{ titleOf(t) }}</span>
          <Icon v-if="t.branch" name="branch" :size="11" class="worktree" />
          <button class="tab-close" title="Close Agent" @mousedown.stop @click.stop="close(t.id)"><Icon name="x" :size="12" /></button>
        </div>
      </div>
      <button class="ghost icon-btn" title="New agent" @click="newAgent"><Icon name="plus" /></button>
      <div class="spacer" />
      <button v-if="props.docked && tabs.length" class="ghost icon-btn" title="Expand over the graph" @click="expand">
        <Icon name="maximize" />
      </button>
      <button v-if="!props.docked" class="ghost icon-btn" title="Back under the terminal (Esc)" @click="dock"><Icon name="minimize" /></button>
      <button class="ghost icon-btn" title="Hide agents (they carry on working)" @click="hide"><Icon name="minus" /></button>
    </header>

    <div class="body">
      <div v-if="!current" class="empty">
        <Icon name="bot" :size="26" class="mark" />
        <p>Agents are Claude Code conversations, each working on its own task. Start one here, or in a worktree of its own.</p>
        <div class="buttons">
          <button class="ghost" @click="newAgent"><Icon name="plus" :size="12" /> New Agent</button>
          <button class="ghost" @click="addInWorktree()"><Icon name="folder" :size="12" /> In a Worktree…</button>
        </div>
      </div>
      <AgentView v-else :key="current.id" :agent="current" />
    </div>
  </section>
</template>

<style scoped>
.agents-panel {
  display: flex;
  flex-direction: column;
}
.tabs {
  position: relative;
  display: flex;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.label {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.worktree {
  flex: none;
  color: var(--fg-faint);
}
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.body > * {
  flex: 1;
  min-height: 0;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px 20px;
  color: var(--fg-faint);
  font-size: 12px;
  text-align: center;
}
.empty p {
  max-width: 320px;
  margin: 0;
}
.mark {
  color: var(--fg-faint);
}
.buttons {
  display: flex;
  gap: 6px;
}
.buttons button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
}
</style>
