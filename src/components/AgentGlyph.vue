<script setup lang="ts">
import type { AgentState } from '@/composables/agentStatus'

/** What an agent's up to, at a glance: a spinner working, an amber ? needing you, a green dot done, a ring idle. */
defineProps<{ state: AgentState }>()
const TITLES: Record<AgentState, string> = {
  waiting: 'Needs you',
  working: 'Working',
  done: 'Done: a reply you haven’t seen',
  idle: 'Idle',
  off: 'Not started',
}
</script>

<template>
  <span class="glyph" :class="state" :title="TITLES[state]"><template v-if="state === 'waiting'">?</template></span>
</template>

<style scoped>
.glyph {
  display: inline-grid;
  flex: none;
  width: 10px;
  height: 10px;
  place-items: center;
  border-radius: 50%;
  box-sizing: border-box;
}
.working {
  border: 1.5px solid color-mix(in srgb, #d97757 25%, transparent);
  border-top-color: #d97757;
  animation: spin 0.8s linear infinite;
}
.waiting {
  width: 12px;
  height: 12px;
  background: var(--modify);
  color: #1a1a1a;
  font: 700 8.5px/1 var(--font);
}
.done {
  background: var(--add);
}
.idle {
  border: 1.5px solid var(--fg-faint);
}
.off {
  border: 1.5px dashed var(--border-strong);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
