<script setup lang="ts">
import { computed, watch } from 'vue'
import { conversations } from '@/composables/claude'
import { bringBack, isPoppedOut, popOut } from '@/composables/claudeWindow'
import { useWorkspace } from '@/composables/workspace'
import ClaudeChat from './ClaudeChat.vue'
import Icon from './Icon.vue'

/**
 * Claude in the panel: this tab's conversation, or, while it's popped out into its own window, a note saying so with
 * a way to bring it back. Closing that window brings it back too. Each tab's a conversation of its own, named after
 * what it's about once you've said something.
 */
const props = defineProps<{ tabId: string }>()
const ws = useWorkspace()
const root = computed(() => ws.repo.repo.value)
const out = computed(() => isPoppedOut(props.tabId))

const title = computed(() => conversations.value[props.tabId]?.title)
watch(
  title,
  (t) => {
    const tab = ws.panel.tabs.value.find((x) => x.id === props.tabId)
    if (t && tab?.title === 'Claude') ws.panel.rename(props.tabId, t.length > 28 ? `${t.slice(0, 27).trimEnd()}…` : t)
  },
  { immediate: true },
)
</script>

<template>
  <div class="claude-tab">
    <p v-if="!root" class="note">Open a repository to talk to Claude about it.</p>
    <div v-else-if="out" class="note out">
      <span class="spark">✳</span>
      <p>Claude is in its own window.</p>
      <div class="buttons">
        <button class="ghost" @click="popOut(tabId, root)"><Icon name="external" :size="12" /> Show it</button>
        <button class="ghost" @click="bringBack(tabId)"><Icon name="minimize" :size="12" /> Bring it back here</button>
      </div>
    </div>
    <ClaudeChat v-else :id="tabId" :key="`${tabId}:${root}`" :root="root" @open="(path) => ws.files.open(path)">
      <template #actions>
        <button class="ghost icon-btn" title="Pop out into its own window" @click="popOut(tabId, root)"><Icon name="external" :size="13" /></button>
      </template>
    </ClaudeChat>
  </div>
</template>

<style scoped>
.claude-tab {
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
.spark {
  color: #d97757;
  font-size: 28px;
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
