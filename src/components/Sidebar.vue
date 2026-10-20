<script setup lang="ts">
import { ref } from 'vue'
import { useSlidingPill } from '@/composables/tabs'
import { useWorkspace } from '@/composables/workspace'
import FileBrowser from './FileBrowser.vue'
import Icon from './Icon.vue'
import SearchPanel from './SearchPanel.vue'
import SourceControl from './SourceControl.vue'

const ws = useWorkspace()
const { sidebarTab } = ws.ui
const { files } = ws.status
const nav = ref<HTMLElement>()
const pill = useSlidingPill(nav, () => [sidebarTab.value, files.value.length])
</script>

<template>
  <section class="pane sidebar-pane">
    <!-- The old tab goes at once and only the new one fades in: fading both (out, then in) could leave the previous
         tab's text showing when switching quickly, or as a WebKit repaint leftover. -->
    <Transition name="tab-in">
      <FileBrowser v-if="sidebarTab === 'files'" class="content" />
      <SearchPanel v-else-if="sidebarTab === 'search'" class="content" />
      <SourceControl v-else class="content" />
    </Transition>
    <nav ref="nav" class="switcher">
      <span class="tab-pill" :style="pill.style.value" />
      <button class="ghost" :class="{ active: sidebarTab === 'files' }" @click="sidebarTab = 'files'"><Icon name="files" :size="13" /> Files</button>
      <button class="ghost" :class="{ active: sidebarTab === 'search' }" title="Search in files (⇧⌘F)" @click="sidebarTab = 'search'">
        <Icon name="search" :size="13" /> Search
      </button>
      <button class="ghost" :class="{ active: sidebarTab === 'scm' }" @click="sidebarTab = 'scm'">
        <Icon name="scm" :size="13" /> Git
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
  position: relative;
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
.switcher button {
  position: relative;
  z-index: 1;
}
.switcher button.active {
  color: var(--fg);
}
.switcher button.active:hover {
  background: transparent;
}
.count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--pill);
  font-size: 10px;
}
</style>
