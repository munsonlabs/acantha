<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspace } from '@/composables/workspace'
import CommitTable from './CommitTable.vue'
import DetailsPanel from './DetailsPanel.vue'
import EmptyState from './EmptyState.vue'
import FilePreview from './FilePreview.vue'
import Skeleton from './Skeleton.vue'
import SlackView from './SlackView.vue'
import GraphToolbar from './GraphToolbar.vue'

const ws = useWorkspace()
const { repo, log } = ws.repo
const { preview } = ws.files
const { slack, slackExpanded } = ws.ui
/** A Slack message or canvas expanded to take the graph's place. */
const slackHere = computed(() => !!slack.value && slackExpanded.value)
</script>

<template>
  <!-- The graph and the commit details are separate panes stacked in one column, like the panes either side. -->
  <div class="graph-column">
    <section class="pane graph-pane">
      <Transition name="slide">
        <FilePreview v-if="preview" class="graph-body" />
        <SlackView v-else-if="slackHere" class="graph-body" />
      </Transition>
      <!-- The table stays mounted under a preview so its scroll position survives. -->
      <template v-if="repo">
        <GraphToolbar v-show="!preview && !slackHere" />
        <div v-show="!preview && !slackHere" class="graph-body">
          <CommitTable v-if="log" />
          <Skeleton v-else :lines="16" :gap="15" />
        </div>
      </template>
      <div v-else-if="!slackHere" class="graph-body"><EmptyState /></div>
    </section>
    <DetailsPanel v-if="repo" v-show="!preview && !slackHere" />
  </div>
</template>

<style scoped>
.graph-column {
  display: flex;
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
</style>
