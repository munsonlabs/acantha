<script setup lang="ts">
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import BranchFilter from './BranchFilter.vue'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { log, showRemotes, showStashes, reload, setShowRemotes } = ws.repo
const { fetchAll } = ws.menus
const hoverCards = prefs.hoverCards
const dimIdle = prefs.dimIdleGraph
const collapsed = prefs.graphCollapsed
</script>

<template>
  <header class="pane-header">
    <span class="title"><Icon name="history" :size="13" /> History</span>
    <BranchFilter />
    <div class="spacer" />
    <button
      class="ghost icon-btn"
      :class="{ on: dimIdle }"
      :title="dimIdle ? 'Keep the graph at full strength' : 'Fade the graph while you work elsewhere'"
      @click="dimIdle = !dimIdle"
    >
      <Icon name="moon" />
    </button>
    <button
      class="ghost icon-btn"
      :class="{ on: hoverCards }"
      :title="hoverCards ? 'Turn off commit cards on hover' : 'Show commit cards on hover'"
      @click="hoverCards = !hoverCards"
    >
      <Icon name="message" />
    </button>
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
    <button class="ghost icon-btn" title="Collapse the graph (show it again from the status bar)" @click="collapsed = true">
      <Icon name="minimize" />
    </button>
  </header>
</template>

<style scoped>
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  font-weight: 600;
}
.icon-btn:not(.on):not(:hover) {
  color: var(--fg-faint);
}
</style>
