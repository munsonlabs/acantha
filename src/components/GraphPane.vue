<script setup lang="ts">
import { computed } from 'vue'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import CommitTable from './CommitTable.vue'
import DetailsPanel from './DetailsPanel.vue'
import EmptyState from './EmptyState.vue'
import FilePreview from './FilePreview.vue'
import Skeleton from './Skeleton.vue'
import SidePanel from './SidePanel.vue'
import GraphToolbar from './GraphToolbar.vue'

const ws = useWorkspace()
const { repo, log } = ws.repo
const { preview } = ws.files
const { tabs, expanded } = ws.panel
/** The panel's tabs, expanded to take the graph's place. */
const panelHere = computed(() => expanded.value && tabs.value.length > 0)
</script>

<template>
  <!-- The graph and the commit details are separate panes stacked in one column, like the panes either side. -->
  <div class="graph-column" :class="{ 'dim-idle': prefs.dimIdleGraph.value && !preview && !panelHere }">
    <section class="pane graph-pane">
      <Transition name="slide">
        <FilePreview v-if="preview" class="graph-body" />
        <SidePanel v-else-if="panelHere" class="graph-body" />
      </Transition>
      <!-- The table stays mounted under a preview so its scroll position survives. -->
      <template v-if="repo">
        <GraphToolbar v-show="!preview && !panelHere" />
        <div v-show="!preview && !panelHere" class="graph-body">
          <CommitTable v-if="log" />
          <Skeleton v-else :lines="16" :gap="15" />
        </div>
      </template>
      <div v-else-if="!panelHere" class="graph-body"><EmptyState /></div>
    </section>
    <DetailsPanel v-if="repo" v-show="!preview && !panelHere" />
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
