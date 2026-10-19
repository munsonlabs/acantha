<script setup lang="ts">
import { useWorkspace } from '@/composables/workspace'
import CommitTable from './CommitTable.vue'
import DetailsPanel from './DetailsPanel.vue'
import EmptyState from './EmptyState.vue'
import GraphToolbar from './GraphToolbar.vue'

const { repo, log } = useWorkspace().repo
</script>

<template>
  <section class="pane graph-pane">
    <GraphToolbar v-if="repo" />
    <div class="graph-body">
      <CommitTable v-if="repo && log" />
      <EmptyState v-else-if="!repo" />
    </div>
    <DetailsPanel />
  </section>
</template>

<style scoped>
.graph-pane {
  display: flex;
  flex-direction: column;
}
.graph-body {
  flex: 1;
  min-height: 0;
}
</style>
