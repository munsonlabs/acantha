<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaces } from '@/composables/workspace'
import Icon from './Icon.vue'

const { active } = useWorkspaces()

const repo = computed(() => active.value?.repo.repo.value ?? null)
const log = computed(() => active.value?.repo.log.value ?? null)

/** The repo path as breadcrumbs, with the home directory shortened to "~". */
const crumbs = computed(() => {
  if (!repo.value) return []
  const parts = repo.value.split('/').filter(Boolean)
  return parts[0] === 'Users' && parts.length > 2 ? ['~', ...parts.slice(2)] : parts
})
</script>

<template>
  <footer class="statusbar">
    <template v-if="repo">
      <span class="crumbs" :title="repo">
        <Icon name="home" :size="12" />
        <template v-for="(c, i) in crumbs" :key="i">
          <Icon v-if="i" name="chevron" :size="10" class="sep" />
          <span :class="{ last: i === crumbs.length - 1 }">{{ c }}</span>
        </template>
      </span>
      <span v-if="log" class="item"><Icon name="branch" :size="12" />{{ log.headBranch ?? 'detached' }}</span>
      <span v-if="log?.uncommitted" class="item modified">{{ log.uncommitted }} changed</span>
    </template>
    <span v-else class="item">No repository</span>
    <div class="spacer" />
    <span v-if="log" class="item">{{ log.commits.length }}{{ log.hasMore ? '+' : '' }} commits</span>
    <button v-if="active && repo" class="ghost status-btn" :class="{ on: active.terminals.open.value }" @click="active.terminals.toggle()">
      <Icon name="terminal" :size="12" /> Terminal <kbd>⌘J</kbd>
    </button>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
  height: 28px;
  padding: 0 12px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.crumbs,
.item {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.crumbs .sep {
  opacity: 0.5;
}
.crumbs .last {
  color: var(--fg);
}
.modified {
  color: var(--modify);
}
.status-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  font-size: 11.5px;
}
.status-btn.on {
  color: var(--fg);
}
kbd {
  font: 10.5px var(--font);
  opacity: 0.6;
}
</style>
