<script setup lang="ts">
import { computed, watch } from 'vue'
import { prefs } from '@/composables/prefs'
import { isOn } from '@/features'
import { useWorkspace } from '@/composables/workspace'
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
const { tabs, expanded } = ws.panel
/**
 * What can take the graph's place: a file, a worktree agent's work under review, the agents expanded, or the panel
 * expanded. Whichever was brought there last shows; closing it shows whichever's still open behind it, the graph once
 * none is.
 */
type Over = 'file' | 'review' | 'agents' | 'panel'
const reviewHere = computed(() => !!ws.ui.review.value && ws.agents.tabs.value.some((t) => t.id === ws.ui.review.value))
const agentsHere = computed(() => isOn('claude') && prefs.agentsOpen.value && ws.agents.expanded.value && ws.agents.tabs.value.length > 0)
const panelOver = computed(() => expanded.value && tabs.value.length > 0)
const open = computed<Record<Over, boolean>>(() => ({
  file: !!preview.value,
  review: reviewHere.value,
  agents: agentsHere.value,
  panel: panelOver.value,
}))
const front = computed<Over | null>(() => {
  const last = ws.ui.front.value
  if (last && open.value[last]) return last
  return (['file', 'review', 'agents', 'panel'] as const).find((k) => open.value[k]) ?? null
})
/** Something's over the graph. */
const panelHere = computed(() => front.value !== null)
// Bringing something there puts it in front: a file opened, a review started, the agents or the panel expanded.
const bring = (what: Over) => (on: unknown) => on && (ws.ui.front.value = what)
watch(preview, bring('file'))
watch(reviewHere, bring('review'))
watch(agentsHere, bring('agents'))
watch(panelOver, bring('panel'))
</script>

<template>
  <!-- The graph and the commit details are separate panes stacked in one column, like the panes either side. -->
  <div class="graph-column" :class="{ 'dim-idle': prefs.dimIdleGraph.value && !panelHere }">
    <section class="pane graph-pane">
      <Transition name="slide">
        <FilePreview v-if="front === 'file'" class="graph-body" />
        <AgentReview v-else-if="front === 'review'" class="graph-body" />
        <AgentsPanel v-else-if="front === 'agents'" class="graph-body" />
        <SidePanel v-else-if="front === 'panel'" class="graph-body" />
      </Transition>
      <!-- The table stays mounted under a preview so its scroll position survives. -->
      <template v-if="repo">
        <GraphToolbar v-show="!panelHere" />
        <div v-show="!panelHere" class="graph-body">
          <CommitTable v-if="log" />
          <Skeleton v-else :lines="16" :gap="15" />
        </div>
      </template>
      <div v-else-if="!panelHere" class="graph-body"><EmptyState /></div>
    </section>
    <DetailsPanel v-if="repo" v-show="!panelHere" />
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
</style>
