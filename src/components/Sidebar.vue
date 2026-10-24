<script setup lang="ts">
import { computed, ref } from 'vue'
import { agentState, useAgentActivity } from '@/composables/agentStatus'
import { isOn } from '@/features'
import AgentGlyph from './AgentGlyph.vue'
import AgentsSidebar from './AgentsSidebar.vue'
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
useAgentActivity()
/** Agents needing you, or done with a reply you haven't seen, flagged on the Agents tab. */
const agentsFlag = computed(() => {
  const states = ws.agents.tabs.value.map((t) => agentState(t.id))
  return states.includes('waiting') ? 'waiting' : states.includes('done') ? 'done' : states.includes('working') ? 'working' : null
})
const pill = useSlidingPill(nav, () => [sidebarTab.value, files.value.length, isOn('claude')])
</script>

<template>
  <section class="pane sidebar-pane">
    <!-- The old tab goes at once and only the new one fades in: fading both (out, then in) could leave the previous
         tab's text showing when switching quickly, or as a WebKit repaint leftover. -->
    <Transition name="tab-in">
      <FileBrowser v-if="sidebarTab === 'files'" class="content" />
      <SearchPanel v-else-if="sidebarTab === 'search'" class="content" />
      <AgentsSidebar v-else-if="sidebarTab === 'agents' && isOn('claude')" class="content" />
      <SourceControl v-else class="content" />
    </Transition>
    <!-- Narrow, the buttons keep just their icons (and counts); each says what it is on hover. -->
    <nav ref="nav" class="switcher" :class="{ four: isOn('claude') }">
      <span class="tab-pill" :style="pill.style.value" />
      <button class="ghost" :class="{ active: sidebarTab === 'files' }" title="Files" @click="sidebarTab = 'files'">
        <Icon name="files" :size="13" /> <span class="text">Files</span>
      </button>
      <button class="ghost" :class="{ active: sidebarTab === 'search' }" title="Search in files (⇧⌘F)" @click="sidebarTab = 'search'">
        <Icon name="search" :size="13" /> <span class="text">Search</span>
      </button>
      <button class="ghost" :class="{ active: sidebarTab === 'scm' }" title="Git" @click="sidebarTab = 'scm'">
        <Icon name="scm" :size="13" /> <span class="text">Git</span>
        <span v-if="files.length" class="count">{{ files.length }}</span>
      </button>
      <button v-if="isOn('claude')" class="ghost" :class="{ active: sidebarTab === 'agents' }" title="Agents" @click="sidebarTab = 'agents'">
        <Icon name="bot" :size="13" /> <span class="text">Agents</span>
        <AgentGlyph v-if="agentsFlag" :state="agentsFlag" />
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
/* Sized by its own width, so the labels go when the sidebar's too narrow for them. */
.switcher {
  container-type: inline-size;
}
@container (max-width: 250px) {
  .text {
    display: none;
  }
}
@container (max-width: 330px) {
  .four .text {
    display: none;
  }
}
</style>
