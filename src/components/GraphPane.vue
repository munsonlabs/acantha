<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { prefs } from '@/composables/prefs'
import { isOn } from '@/features'
import { useWorkspace } from '@/composables/workspace'
import { bringToFront, overGraph, whatsOpen, type Over } from '@/composables/center'
import CommitTable from './CommitTable.vue'
import DetailsPanel from './DetailsPanel.vue'
import EmptyState from './EmptyState.vue'
import FilePreview from './FilePreview.vue'
import Skeleton from './Skeleton.vue'
import SidePanel from './SidePanel.vue'
import AgentsPanel from './AgentsPanel.vue'
import AgentReview from './AgentReview.vue'
import GraphToolbar from './GraphToolbar.vue'

const ws = useWorkspace()
const { repo, log } = ws.repo
const { preview } = ws.files
/** What's over the graph, in front (see composables/center.ts). A file isn't one of these any more: it's always
 * there in its own place below, rather than taking the graph's. */
const front = computed(() => overGraph(ws))
const open = computed(() => whatsOpen(ws))
const reviewHere = computed(() => open.value.review)
const agentsHere = computed(() => open.value.agents)
const panelOver = computed(() => open.value.panel)
/** A review, the agents or the panel: takes the whole place, the graph and the file editor both covered. */
const panelHere = computed(() => front.value !== null)
const bring = (what: Over) => (on: unknown) => on && bringToFront(ws, what)
watch(reviewHere, bring('review'))
watch(agentsHere, bring('agents'))
watch(panelOver, bring('panel'))

const hasFile = computed(() => !!preview.value)
/** The graph's own row, collapsed by the Graph button: only while a file still has somewhere to go underneath it.
 * With none open, the whole place swaps for the stamp instead (see WorkspaceView's `graphHidden`). */
const graphRowHidden = computed(() => prefs.graphCollapsed.value && hasFile.value)

/** Drags the bar between the graph (with its details) and the file editor; its share is kept as a fraction. */
const column = ref<HTMLElement>()
function startFileSplit(e: MouseEvent) {
  const box = column.value!.getBoundingClientRect()
  const move = (ev: MouseEvent) => (prefs.fileSplit.value = Math.min(Math.max((ev.clientY - box.top) / box.height, 0.15), 0.85))
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.classList.remove('resizing-rows')
  }
  document.body.classList.add('resizing-rows')
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  e.preventDefault()
}
</script>

<template>
  <div ref="column" class="graph-column" :class="{ 'dim-idle': prefs.dimIdleGraph.value && !panelHere }">
    <template v-if="panelHere">
      <Transition name="slide">
        <AgentReview v-if="front === 'review'" class="graph-body" />
        <AgentsPanel v-else-if="front === 'agents'" class="graph-body" />
        <SidePanel v-else-if="front === 'panel'" class="graph-body" />
      </Transition>
    </template>
    <template v-else>
      <div v-show="!graphRowHidden" class="graph-region" :style="hasFile ? { flex: `0 0 ${prefs.fileSplit.value * 100}%` } : undefined">
        <section class="pane graph-pane">
          <template v-if="repo">
            <GraphToolbar />
            <div class="graph-body">
              <CommitTable v-if="log" />
              <Skeleton v-else :lines="16" :gap="15" />
            </div>
          </template>
          <div v-else class="graph-body"><EmptyState /></div>
        </section>
        <DetailsPanel v-if="repo" />
      </div>
      <template v-if="hasFile">
        <div v-show="!graphRowHidden" class="row-resize" title="Drag to resize" @mousedown="startFileSplit" />
        <FilePreview class="file-pane" />
      </template>
    </template>
  </div>
</template>

<style scoped>
.graph-column {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* Faded while you work elsewhere: back to full as soon as the pointer or focus comes into the graph. */
.graph-column > * {
  transition: opacity 0.25s var(--ease-out);
}
.graph-column.dim-idle:not(:hover):not(:focus-within) > * {
  opacity: 0.45;
}
.graph-region {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.graph-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 160px;
}
.graph-body {
  flex: 1;
  min-height: 0;
}
.file-pane {
  flex: 1;
  min-height: 120px;
}
.row-resize {
  flex: none;
  height: 10px;
  cursor: row-resize;
}
</style>
