<script setup lang="ts">
import { useWorkspace } from '@/composables/workspace'
import CommitTable from './CommitTable.vue'
import DetailsPanel from './DetailsPanel.vue'
import EmptyState from './EmptyState.vue'
import FilePreview from './FilePreview.vue'
import Skeleton from './Skeleton.vue'
import GraphToolbar from './GraphToolbar.vue'

const ws = useWorkspace()
const { repo, log } = ws.repo
const { preview } = ws.files
</script>

<template>
  <section class="pane graph-pane">
    <FilePreview v-if="preview" class="graph-body" />
    <!-- The table stays mounted under a preview so its scroll position survives. -->
    <template v-if="repo">
      <GraphToolbar v-show="!preview" />
      <div v-show="!preview" class="graph-body">
        <CommitTable v-if="log" />
        <Skeleton v-else :lines="16" :gap="15" />
      </div>
      <DetailsPanel v-show="!preview" />
    </template>
    <div v-else class="graph-body"><EmptyState /></div>
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
