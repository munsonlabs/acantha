<script setup lang="ts">
import { computed } from 'vue'
import type { FileChange } from '@/lib/git'
import { formatDate, shortHash, splitPath } from '@/lib/format'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

const ws = useWorkspace()
const { details, select, closeDetails } = ws.details
const { openDiff } = ws.diff
const { browse } = ws
const height = prefs.detailsHeight

const STATUS: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', '?': 'Untracked' }

const title = computed(() => {
  const d = details.value!
  if (d.kind === 'uncommitted') return 'Uncommitted Changes'
  if (d.kind === 'compare') return `Comparing ${shortHash(d.from!)} → ${d.to === '*' ? 'working tree' : shortHash(d.to)}`
  return d.commit?.body.split('\n')[0] ?? shortHash(d.to)
})

const totals = computed(() =>
  details.value!.files.reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 }),
)

function startResize(e: MouseEvent) {
  const startY = e.clientY
  const startH = height.value
  const move = (ev: MouseEvent) => {
    height.value = Math.min(Math.max(startH + startY - ev.clientY, 140), window.innerHeight - 180)
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

const open = (f: FileChange) => openDiff(f, details.value!.from, details.value!.to)
</script>

<template>
  <section v-if="details" class="details" :style="{ height: `${height}px` }">
    <div class="resize" @mousedown.prevent="startResize" />
    <header>
      <h2 :title="title">{{ title }}</h2>
      <button v-if="details.kind !== 'compare'" class="ghost browse" @click="browse(details.kind === 'uncommitted' ? null : details.to)">
        <Icon name="files" :size="13" /> Browse Files
      </button>
      <button class="ghost icon-btn" title="Close (Esc)" @click="closeDetails"><Icon name="x" /></button>
    </header>
    <div class="body">
      <div class="meta">
        <template v-if="details.commit">
          <dl>
            <dt>Commit</dt>
            <dd class="mono">{{ details.commit.hash }}</dd>
            <dt>Parents</dt>
            <dd class="mono">
              <template v-if="details.commit.parents.length">
                <a v-for="p in details.commit.parents" :key="p" href="#" @click.prevent="select(p)">{{ shortHash(p) }}</a>
              </template>
              <span v-else class="muted">None (root commit)</span>
            </dd>
            <dt>Author</dt>
            <dd>
              {{ details.commit.author }} <span class="muted">&lt;{{ details.commit.email }}&gt;</span>
            </dd>
            <dt>Date</dt>
            <dd>{{ formatDate(details.commit.authorDate) }}</dd>
            <template v-if="details.commit.committer !== details.commit.author || details.commit.commitDate !== details.commit.authorDate">
              <dt>Committer</dt>
              <dd>
                {{ details.commit.committer }}
                <span class="muted">&lt;{{ details.commit.committerEmail }}&gt; · {{ formatDate(details.commit.commitDate) }}</span>
              </dd>
            </template>
          </dl>
          <pre class="message">{{ details.commit.body }}</pre>
        </template>
        <p v-else-if="details.kind === 'uncommitted'" class="muted">
          Working tree and index compared to HEAD. Right-click the row to stash or discard.
        </p>
        <p v-else-if="details.kind === 'compare'" class="muted">
          Changes between the two selected commits. Cmd/Ctrl-click another row to change the comparison.
        </p>
      </div>
      <div class="files">
        <div class="files-head">
          <span>{{ details.loading ? 'Loading…' : `${details.files.length} file${details.files.length === 1 ? '' : 's'} changed` }}</span>
          <span v-if="!details.loading" class="stat"
            ><span class="add">+{{ totals.add }}</span> <span class="del">−{{ totals.del }}</span></span
          >
        </div>
        <Skeleton v-if="details.loading" :lines="5" :gap="14" />
        <ul>
          <li v-for="f in details.files" :key="f.path" :title="STATUS[f.status] ?? f.status" @click="open(f)">
            <span class="status" :class="`s-${f.status === '?' ? 'U' : f.status}`">{{ f.status === '?' ? 'U' : f.status }}</span>
            <FileIcon :path="f.path" />
            <span class="path">
              <span class="dir">{{ splitPath(f.path).dir }}</span
              >{{ splitPath(f.path).name }}
              <span v-if="f.oldPath" class="muted"> ← {{ f.oldPath }}</span>
            </span>
            <span v-if="f.additions != null" class="stat"
              ><span class="add">+{{ f.additions }}</span> <span class="del">−{{ f.deletions }}</span></span
            >
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.details {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--border);
}
.resize {
  position: absolute;
  inset: -3px 0 auto;
  height: 6px;
  cursor: row-resize;
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 14px;
  border-bottom: 1px solid var(--border);
}
.browse {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  color: var(--fg-muted);
  font-size: 12px;
}
h2 {
  flex: 1;
  overflow: hidden;
  margin: 0;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.meta,
.files {
  overflow: auto;
  padding: 10px 12px;
}
.meta {
  border-right: 1px solid var(--border);
}
dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0 0 12px;
}
dt {
  color: var(--fg-faint);
}
dd {
  overflow-wrap: anywhere;
  margin: 0;
}
dd a {
  margin-right: 8px;
  color: var(--fg);
  text-decoration: underline;
  text-decoration-color: var(--fg-faint);
  text-underline-offset: 2px;
}
.message {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.files-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--fg-muted);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
}
li:hover {
  background: var(--hover);
}
li {
  font-size: 12px;
}
.status {
  width: 16px;
  flex: none;
  font: 600 11px var(--mono);
  text-align: center;
}
.s-A,
.s-U {
  color: var(--add);
}
.s-M,
.s-T {
  color: var(--modify);
}
.s-D {
  color: var(--del);
}
.s-R,
.s-C {
  color: var(--rename);
}
.path {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dir {
  color: var(--fg-muted);
}
.stat {
  flex: none;
  font: 11px var(--mono);
}
.add {
  color: var(--add);
}
.del {
  color: var(--del);
}
</style>
