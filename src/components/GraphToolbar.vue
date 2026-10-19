<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { log, branch, showRemotes, reload, setBranch, setShowRemotes } = ws.repo
const { fetchAll } = ws.menus

const locals = computed(() => log.value?.refs.filter((r) => r.kind === 'branch') ?? [])
const remoteRefs = computed(() => (showRemotes.value ? (log.value?.refs.filter((r) => r.kind === 'remote') ?? []) : []))
</script>

<template>
  <header class="pane-header">
    <span class="title"><Icon name="history" :size="13" /> History</span>
    <label class="select">
      <Icon name="branch" :size="13" />
      <select :value="branch" @change="setBranch(($event.target as HTMLSelectElement).value)">
        <option value="">All branches</option>
        <optgroup v-if="locals.length" label="Local">
          <option v-for="r in locals" :key="r.name" :value="`refs/heads/${r.name}`">{{ r.name }}</option>
        </optgroup>
        <optgroup v-if="remoteRefs.length" label="Remote">
          <option v-for="r in remoteRefs" :key="`${r.remote}/${r.name}`" :value="`refs/remotes/${r.remote}/${r.name}`">
            {{ r.remote }}/{{ r.name }}
          </option>
        </optgroup>
      </select>
    </label>
    <div class="spacer" />
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
.select {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--fg-muted);
}
.select:hover {
  background: var(--hover);
  color: var(--fg);
}
.select select {
  max-width: 200px;
  height: 100%;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  appearance: none;
  outline: none;
}
.icon-btn:not(.on):not(:hover) {
  color: var(--fg-muted);
}
</style>
