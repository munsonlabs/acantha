<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import type { AgentTab } from '@/composables/agents'
import { agentState, markSeen, useAgentActivity } from '@/composables/agentStatus'
import { bringBack, isPoppedOut, popOut } from '@/composables/claudeWindow'
import { useWorkspace, useWorkspaces } from '@/composables/workspace'
import ClaudeChat from './ClaudeChat.vue'
import Icon from './Icon.vue'

/**
 * An agent in the Agents panel: its conversation, or, while it's popped out into its own window, a note saying so with
 * a way to bring it back. Closing that window brings it back too. Showing it counts as looking at it, so a reply it
 * finished is no longer news.
 */
const props = defineProps<{ agent: AgentTab }>()
const ws = useWorkspace()
const { workspaces, active, showRepo } = useWorkspaces()
const root = computed(() => ws.repo.repo.value)
const cwd = computed(() => props.agent.cwd ?? root.value ?? undefined)
const out = computed(() => isPoppedOut(props.agent.id))

useAgentActivity()
const look = () => active.value === ws && document.hasFocus() && markSeen(props.agent.id)
onMounted(look)
watch(() => agentState(props.agent.id), look)

/** A file Claude points at: here, or, for an agent in a worktree, in that worktree's own tab. */
async function open(path: string) {
  if (!props.agent.cwd || props.agent.cwd === root.value) return void ws.files.open(path)
  await showRepo(props.agent.cwd)
  void workspaces.value.find((w) => w.repo.repo.value === props.agent.cwd)?.files.open(path)
}
</script>

<template>
  <div class="agent-view">
    <p v-if="!root" class="note">Open a repository to start an agent in it.</p>
    <div v-else-if="out" class="note out">
      <Icon name="bot" :size="26" class="mark" />
      <p>This agent is in its own window.</p>
      <div class="buttons">
        <button class="ghost" @click="popOut(agent.id, root)"><Icon name="external" :size="12" /> Show it</button>
        <button class="ghost" @click="bringBack(agent.id)"><Icon name="minimize" :size="12" /> Bring it back here</button>
      </div>
    </div>
    <ClaudeChat v-else :id="agent.id" :key="`${agent.id}:${root}`" :root="root" :cwd="cwd" @open="open">
      <template #actions>
        <button class="ghost icon-btn" title="Pop out into its own window" @click="popOut(agent.id, root)">
          <Icon name="external" :size="13" />
        </button>
      </template>
    </ClaudeChat>
  </div>
</template>

<style scoped>
.agent-view {
  height: 100%;
  min-height: 0;
}
.note {
  margin: 16px;
  color: var(--fg-faint);
  font-size: 12.5px;
}
.out {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: calc(100% - 32px);
  margin: 16px;
  text-align: center;
}
.out p {
  margin: 8px 0 12px;
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
