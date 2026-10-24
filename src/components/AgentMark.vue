<script setup lang="ts">
import { AGENT_NAMES, type AgentKind } from '@/lib/claudeView'

/** What runs an agent, at a glance: Claude's asterisk, or OpenCode's square, in their colours. */
defineProps<{ kind?: AgentKind }>()
</script>

<template>
  <span class="mark" :class="kind ?? 'claude'" :title="`Run by ${AGENT_NAMES[kind ?? 'claude']}`">{{ kind === 'opencode' ? '▣' : '✳' }}</span>
</template>

<style scoped>
.mark {
  flex: none;
  font-size: 11px;
  line-height: 1;
}
.claude {
  color: #d97757;
}
.opencode {
  color: #8b8bf0;
}
</style>
