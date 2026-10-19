<script setup lang="ts">
import { useWorkspace } from '@/composables/workspace'
import BranchFilter from './BranchFilter.vue'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { log, showRemotes, showStashes, reload, setShowRemotes } = ws.repo
const { fetchAll } = ws.menus
</script>

<template>
  <header class="pane-header">
    <span class="title"><Icon name="history" :size="13" /> History</span>
    <BranchFilter />
    <div class="spacer" />
    <button
      class="ghost icon-btn"
      :class="{ on: showStashes }"
      :title="showStashes ? 'Hide stashes' : `Show stashes${log?.stashes.length ? ` (${log.stashes.length})` : ''}`"
      @click="showStashes = !showStashes"
    >
      <Icon name="archive" />
    </button>
    <button
      class="ghost icon-btn"
      :class="{ on: showRemotes }"
      :title="showRemotes ? 'Hide remote branches' : 'Show remote branches'"
      @click="setShowRemotes(!showRemotes)"
    >
      <Icon name="cloud" />
    </button>
    <button class="ghost icon-btn" :disabled="!log?.remotes.length" title="Fetch from all remotes" @click="fetchAll"><Icon name="fetch" /></button>
    <button class="ghost icon-btn" title="Refresh (⌘R)" @click="reload"><Icon name="refresh" /></button>
  </header>
</template>

<style scoped>
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  font-weight: 500;
}
.icon-btn:not(.on):not(:hover) {
  color: var(--fg-faint);
}
</style>
