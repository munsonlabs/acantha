<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { prefs } from '@/composables/prefs'
import { provideWorkspace, type Workspace } from '@/composables/workspace'
import DiffModal from './DiffModal.vue'
import GraphPane from './GraphPane.vue'
import ConflictResolver from './ConflictResolver.vue'
import RebaseModal from './RebaseModal.vue'
import Sidebar from './Sidebar.vue'
import TerminalPane from './TerminalPane.vue'

const props = defineProps<{ ws: Workspace; visible: boolean }>()
provideWorkspace(props.ws)

const { repo } = props.ws.repo
const { open, sessions } = props.ws.terminals
const el = ref<HTMLElement>()
const width = prefs.terminalWidth
const sidebarWidth = prefs.sidebarWidth
const sidebarOpen = prefs.sidebarOpen

/** The terminal is sized as a share of the workspace, worked out in pixels so it keeps its width while sliding. */
const workspaceWidth = ref(0)
const terminalPx = computed(() => Math.max(280, Math.round(workspaceWidth.value * width.value)))
const observer = new ResizeObserver(([entry]) => (workspaceWidth.value = entry.contentRect.width))
onMounted(() => el.value && observer.observe(el.value))
onBeforeUnmount(() => observer.disconnect())

/**
 * Side panels open and close by animating the width of a slot around them, so the graph glides rather than jumps.
 * The transition is only switched on while toggling: resizing a panel or the window should follow the mouse.
 */
const sliding = ref<'sidebar' | 'terminal' | null>(null)
watch(sidebarOpen, () => (sliding.value = 'sidebar'), { flush: 'sync' })
watch(open, () => (sliding.value = 'terminal'), { flush: 'sync' })
const doneSliding = (e: TransitionEvent) => e.propertyName === 'width' && (sliding.value = null)

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
    <div
      v-if="repo"
      class="slot left"
      :class="{ sliding: sliding === 'sidebar', shut: !sidebarOpen }"
      :style="{ width: sidebarOpen ? `${sidebarWidth + 10}px` : '0px' }"
      @transitionend.self="doneSliding"
    >
      <Sidebar class="sidebar" :style="{ width: `${sidebarWidth}px` }" />
      <div class="gutter" @mousedown="startResize($event, 'sidebar')" />
    </div>
    <GraphPane class="graph" />
    <!-- Terminals stay mounted while hidden so their shells keep running. -->
    <div
      v-if="repo && sessions.length"
      class="slot right"
      :class="{ sliding: sliding === 'terminal', shut: !open }"
      :style="{ width: open ? `${terminalPx + 10}px` : '0px' }"
      @transitionend.self="doneSliding"
    >
      <div class="gutter" @mousedown="startResize($event, 'terminal')" />
      <TerminalPane class="terminal" :style="{ width: `${terminalPx}px` }" :visible="visible && open" />
    </div>
    <DiffModal />
    <ConflictResolver />
    <RebaseModal />
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0 10px;
}
.graph {
  flex: 1;
  min-width: 320px;
}
.slot {
  display: flex;
  flex: none;
}
/* Panels keep their own width inside the slot, so they slide out of view rather than squash. */
.slot.left {
  justify-content: flex-end;
}
.slot.sliding {
  overflow: hidden;
  transition: width 0.26s var(--ease-out);
}
.slot.shut {
  overflow: hidden;
  pointer-events: none;
}
.sidebar,
.terminal {
  flex: none;
}
.gutter {
  flex: none;
  width: 10px;
  cursor: col-resize;
}
</style>
