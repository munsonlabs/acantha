<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { shortHash } from '@/lib/format'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

const ws = useWorkspace()
const { rev, list, loading, filter, expanded, preview, load, browse, toggle, open } = ws.files
const { rows } = ws.repo
const { status } = ws.status

interface Dir {
  dirs: Map<string, Dir>
  files: string[]
}

interface Row {
  kind: 'dir' | 'file'
  path: string
  name: string
  depth: number
}

const tree = computed(() => {
  const root: Dir = { dirs: new Map(), files: [] }
  for (const path of list.value) {
    const parts = path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part)
      if (!next) dir.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      dir = next
    }
    dir.files.push(path)
  }
  return root
})

/** The tree flattened into the rows that are visible, folders first. A filter shows matching files as a flat list instead. */
const visible = computed<Row[]>(() => {
  const q = filter.value.trim().toLowerCase()
  if (q) return list.value.filter((p) => p.toLowerCase().includes(q)).map((path) => ({ kind: 'file', path, name: path, depth: 0 }))
  const out: Row[] = []
  const walk = (dir: Dir, prefix: string, depth: number) => {
    for (const name of [...dir.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      const path = prefix + name
      out.push({ kind: 'dir', path, name, depth })
      if (expanded.value.has(path)) walk(dir.dirs.get(name)!, `${path}/`, depth + 1)
    }
    for (const path of [...dir.files].sort((a, b) => a.localeCompare(b))) out.push({ kind: 'file', path, name: path.slice(prefix.length), depth })
  }
  walk(tree.value, '', 0)
  return out
})

const subject = computed(() => rows.value.find((c) => c.hash === rev.value)?.subject)

onMounted(() => {
  if (!list.value.length) void load()
})
// Keep the working tree listing current as files come and go.
watch(status, (now, before) => {
  if (rev.value === null && now?.files.length !== before?.files.length) void load()
})
</script>

<template>
  <div class="browser">
    <header class="pane-header">
      <span v-if="rev" class="at" :title="subject">
        <Icon name="history" :size="13" />
        <span class="hash">{{ shortHash(rev) }}</span>
        <span class="subject">{{ subject }}</span>
      </span>
      <span v-else class="at"><Icon name="folder" :size="13" /> Working tree</span>
      <div class="spacer" />
      <button v-if="rev" class="ghost icon-btn" title="Back to the working tree" @click="browse(null)"><Icon name="x" /></button>
      <button class="ghost icon-btn" title="Refresh" @click="load"><Icon name="refresh" /></button>
    </header>
    <div class="filter">
      <Icon name="search" :size="12" />
      <input v-model="filter" type="text" placeholder="Filter files" spellcheck="false" autocomplete="off" />
    </div>
    <div class="tree">
      <Skeleton v-if="loading && !list.length" :lines="10" />
      <p v-else-if="!visible.length" class="note">No files</p>
      <div
        v-for="r in visible"
        :key="r.path"
        class="row"
        :class="[r.kind, { active: r.kind === 'file' && preview?.path === r.path && preview?.rev === rev }]"
        :style="{ paddingLeft: `${(r.kind === 'file' ? 24 : 8) + r.depth * 14}px` }"
        :title="r.path"
        @click="r.kind === 'dir' ? toggle(r.path) : open(r.path)"
      >
        <Icon v-if="r.kind === 'dir'" name="chevron" :size="11" class="chev" :class="{ open: expanded.has(r.path) }" />
        <FileIcon :path="r.path" :folder="r.kind === 'dir'" :open="expanded.has(r.path)" />
        <span class="name">{{ r.name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser {
  display: flex;
  flex-direction: column;
}
.at {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 6px;
  font-weight: 600;
  white-space: nowrap;
}
.hash {
  font: 11.5px var(--mono);
}
.subject {
  overflow: hidden;
  color: var(--fg-muted);
  font-weight: 400;
  text-overflow: ellipsis;
}
.filter {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 8px 4px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--fg-faint);
}
.filter:focus-within {
  border-color: var(--ring);
}
.filter input {
  flex: 1;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
}
.tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 6px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding-right: 6px;
  border-radius: 6px;
  font-size: 12.5px;
  white-space: nowrap;
}
.row:hover {
  background: var(--hover);
}
.row.active {
  background: var(--selected);
}
.chev {
  color: var(--fg-faint);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.row.file .chev {
  display: none;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.note {
  margin: 12px 8px;
  color: var(--fg-faint);
  font-size: 12px;
}
</style>
