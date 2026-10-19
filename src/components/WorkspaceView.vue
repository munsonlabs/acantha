<script setup lang="ts">
import { ref } from 'vue'
import { prefs } from '@/composables/prefs'
import { provideWorkspace, type Workspace } from '@/composables/workspace'
import DiffModal from './DiffModal.vue'
import GraphPane from './GraphPane.vue'
import SourceControl from './SourceControl.vue'
import TerminalPane from './TerminalPane.vue'

const props = defineProps<{ ws: Workspace; visible: boolean }>()
provideWorkspace(props.ws)

const { repo } = props.ws.repo
const { open, sessions } = props.ws.terminals
const el = ref<HTMLElement>()
const width = prefs.terminalWidth
const sidebarWidth = prefs.sidebarWidth
const sidebarOpen = prefs.sidebarOpen

/** Drags a gutter: the sidebar is sized in pixels from the left, the terminal as a fraction from the right. */
function startResize(e: MouseEvent, side: 'sidebar' | 'terminal') {
  const box = el.value!.getBoundingClientRect()
  const move = (ev: MouseEvent) => {
    if (side === 'sidebar') sidebarWidth.value = Math.min(Math.max(ev.clientX - box.left - 8, 220), 520)
    else width.value = Math.min(Math.max((box.right - ev.clientX) / box.width, 0.2), 0.8)
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.classList.remove('resizing')
  }
  document.body.classList.add('resizing')
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  e.preventDefault()
}
</script>

<template>
  <div v-show="visible" ref="el" class="workspace">
    <template v-if="repo">
      <SourceControl v-show="sidebarOpen" class="sidebar" :style="{ width: `${sidebarWidth}px` }" />
      <div v-show="sidebarOpen" class="gutter" @mousedown="startResize($event, 'sidebar')" />
    </template>
    <GraphPane class="graph" />
    <!-- Terminals stay mounted while hidden so their shells keep running. -->
    <template v-if="repo && sessions.length">
      <div v-show="open" class="gutter" @mousedown="startResize($event, 'terminal')" />
      <TerminalPane v-show="open" class="terminal" :style="{ width: `${width * 100}%` }" :visible="visible && open" />
    </template>
    <DiffModal />
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0 8px;
}
.graph {
  flex: 1;
  min-width: 320px;
}
.sidebar {
  flex: none;
}
.terminal {
  flex: none;
  min-width: 280px;
}
.gutter {
  flex: none;
  width: 8px;
  cursor: col-resize;
}
</style>
