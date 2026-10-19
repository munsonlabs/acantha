<script setup lang="ts">
import { computed } from 'vue'
import { UNCOMMITTED, type Commit } from '@/lib/git'
import { colorFor, edgePath, nodeX, rowY, NODE_R, ROW_H, type GraphLayout } from '@/lib/graph'

const props = defineProps<{ layout: GraphLayout; rows: Commit[]; head: string | null }>()

/** One <path> per colour keeps the DOM small even for thousands of commits. */
const paths = computed(() => {
  const groups = new Map<string, { d: string; stroke: string; dashed: boolean }>()
  for (const e of props.layout.edges) {
    const key = `${e.color}|${e.dashed}`
    const group = groups.get(key)
    if (group) group.d += edgePath(e)
    else groups.set(key, { d: edgePath(e), stroke: colorFor(e.color), dashed: e.dashed })
  }
  return [...groups.entries()]
})

const nodes = computed(() =>
  props.layout.nodes.map((n, i) => {
    const hash = props.rows[i].hash
    return {
      key: hash,
      cx: nodeX(n.col),
      cy: rowY(i),
      color: colorFor(n.color),
      kind: hash === UNCOMMITTED ? 'uncommitted' : props.rows[i].stash ? 'stash' : hash === props.head ? 'head' : 'commit',
    }
  }),
)
</script>

<template>
  <svg class="commit-graph" :width="layout.width" :height="rows.length * ROW_H" aria-hidden="true">
    <path v-for="[key, p] in paths" :key="key" :d="p.d" :stroke="p.stroke" :stroke-dasharray="p.dashed ? '3 3' : undefined" />
    <rect
      v-for="n in nodes.filter((n) => n.kind === 'stash')"
      :key="n.key"
      class="stash"
      :x="n.cx - NODE_R"
      :y="n.cy - NODE_R"
      :width="NODE_R * 2"
      :height="NODE_R * 2"
      rx="1.5"
      :stroke="n.color"
    />
    <circle
      v-for="n in nodes.filter((n) => n.kind !== 'stash')"
      :key="n.key"
      :class="n.kind"
      :cx="n.cx"
      :cy="n.cy"
      :r="n.kind === 'commit' ? NODE_R : NODE_R + 0.5"
      :fill="n.kind === 'commit' ? n.color : undefined"
      :stroke="n.color"
    />
  </svg>
</template>

<style scoped>
.commit-graph {
  display: block;
}
path {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}
circle.head,
circle.uncommitted,
rect.stash {
  fill: var(--bg);
  stroke-width: 2;
}
</style>
