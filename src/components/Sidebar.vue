<script setup lang="ts">
import { useWorkspace } from '@/composables/workspace'
import FileBrowser from './FileBrowser.vue'
import Icon from './Icon.vue'
import SourceControl from './SourceControl.vue'

const ws = useWorkspace()
const { sidebarTab } = ws.ui
const { files } = ws.status
</script>

<template>
  <section class="pane sidebar-pane">
    <FileBrowser v-if="sidebarTab === 'files'" class="content" />
    <SourceControl v-else class="content" />
    <nav class="switcher">
      <button class="ghost" :class="{ on: sidebarTab === 'files' }" @click="sidebarTab = 'files'"><Icon name="files" :size="13" /> Files</button>
      <button class="ghost" :class="{ on: sidebarTab === 'scm' }" @click="sidebarTab = 'scm'">
        <Icon name="scm" :size="13" /> Source Control
        <span v-if="files.length" class="count">{{ files.length }}</span>
      </button>
    </nav>
  </section>
</template>

<style scoped>
.sidebar-pane {
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  min-height: 0;
}
.switcher {
  display: flex;
  flex: none;
  gap: 4px;
  padding: 6px;
  border-top: 1px solid var(--border);
}
.switcher button {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  padding: 0 6px;
  white-space: nowrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  color: var(--fg-muted);
  font-size: 12px;
}
.switcher button.on {
  background: var(--pill);
  box-shadow: inset 0 0 0 1px var(--hover);
  color: var(--fg);
}
.count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--pill);
  font-size: 10px;
}
</style>
