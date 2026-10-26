<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { Details } from '@/composables/details'
import type { FileChange } from '@/lib/git'
import { formatDate, reflowMessage, shortHash, splitPath } from '@/lib/format'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'
import { openMenu } from '@/composables/useContextMenu'
import { fileOpenItems } from '@/composables/openers'

const ws = useWorkspace()
const { details, select, closeDetails } = ws.details
const { openDiff } = ws.diff
const { browse } = ws
const height = prefs.detailsHeight

/**
 * What the panel shows. It holds on to the last commit while the panel slides closed, so the content doesn't vanish
 * before the slide finishes. The height only animates while opening or closing: dragging to resize follows the mouse.
 */
const shown = shallowRef<Details | null>(details.value)
const isOpen = computed(() => !!details.value)
const sliding = ref(false)
watch(details, (d) => d && (shown.value = d))
watch(isOpen, () => (sliding.value = true), { flush: 'sync' })

function doneSliding(e: TransitionEvent) {
  if (e.propertyName !== 'height') return
  sliding.value = false
  if (!isOpen.value) shown.value = null
}

const STATUS: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', '?': 'Untracked' }

const title = computed(() => {
  const d = shown.value!
  if (d.kind === 'uncommitted') return 'Uncommitted Changes'
  if (d.kind === 'compare') return `Comparing ${shortHash(d.from!)} → ${d.to === '*' ? 'working tree' : shortHash(d.to)}`
  return d.commit?.body.split('\n')[0] ?? shortHash(d.to)
})

const totals = computed(() =>
  shown.value!.files.reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 }),
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

const open = (f: FileChange) => openDiff(f, shown.value!.from, shown.value!.to)

/** The changed files as the folders they're in, like the file browser's, instead of one flat list. */
interface DirNode {
  dirs: Map<string, DirNode>
  files: FileChange[]
}
type FileRow =
  | { kind: 'dir'; path: string; name: string; depth: number }
  | { kind: 'file'; path: string; name: string; depth: number; file: FileChange }

/** Folders closed by hand. Everything starts open, for each commit: there's rarely enough in one to want less. */
const collapsed = ref(new Set<string>())
watch(
  () => shown.value?.files,
  () => (collapsed.value = new Set()),
)
function toggleFolder(path: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(path)) next.add(path)
  collapsed.value = next
}

const fileRows = computed<FileRow[]>(() => {
  const files = shown.value?.files ?? []
  const root: DirNode = { dirs: new Map(), files: [] }
  for (const f of files) {
    let dir = root
    for (const part of f.path.split('/').slice(0, -1)) {
      let next = dir.dirs.get(part)
      if (!next) dir.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      dir = next
    }
    dir.files.push(f)
  }
  const out: FileRow[] = []
  const walk = (node: DirNode, prefix: string, depth: number) => {
    for (const name of [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      const path = prefix + name
      out.push({ kind: 'dir', path, name, depth })
      if (!collapsed.value.has(path)) walk(node.dirs.get(name)!, `${path}/`, depth + 1)
    }
    for (const f of [...node.files].sort((a, b) => a.path.localeCompare(b.path)))
      out.push({ kind: 'file', path: f.path, name: f.path.slice(prefix.length), depth, file: f })
  }
  walk(root, '', 0)
  return out
})

/** The working copy is what opens, so a file this commit deleted can't be. */
const fileMenu = (e: MouseEvent, f: FileChange) =>
  openMenu(e, [
    { header: splitPath(f.path).name, detail: f.path },
    { label: 'Open Changes', icon: 'eye', run: () => open(f) },
    'separator',
    ...fileOpenItems(ws.repo.repo.value!, f.path, { exists: f.status !== 'D' }),
  ])
</script>

<template>
  <!-- Opens and closes by animating the slot's height, like the side panels, so the graph above glides. -->
  <div
    class="details-slot"
    :class="{ sliding, shut: !isOpen }"
    :style="{ height: isOpen ? `${height + 10}px` : '0px' }"
    @transitionend.self="doneSliding"
  >
    <template v-if="shown">
      <!-- The gap above the pane is its resize handle. -->
      <div class="resize" title="Drag to resize" @mousedown.prevent="startResize" />
      <section class="pane details" :style="{ height: `${height}px` }">
        <header class="pane-header">
          <h2 :title="title">{{ title }}</h2>
          <button v-if="shown.kind !== 'compare'" class="ghost browse" @click="browse(shown.kind === 'uncommitted' ? null : shown.to)">
            <Icon name="files" :size="13" /> Browse Files
          </button>
          <button class="ghost icon-btn" title="Close (Esc)" @click="closeDetails"><Icon name="x" /></button>
        </header>
        <div class="body">
          <div class="meta">
            <template v-if="shown.commit">
              <dl>
                <dt>Commit</dt>
                <dd class="mono">{{ shown.commit.hash }}</dd>
                <dt>Parents</dt>
                <dd class="mono">
                  <template v-if="shown.commit.parents.length">
                    <a v-for="p in shown.commit.parents" :key="p" href="#" @click.prevent="select(p)">{{ shortHash(p) }}</a>
                  </template>
                  <span v-else class="muted">None (root commit)</span>
                </dd>
                <dt>Author</dt>
                <dd>
                  {{ shown.commit.author }} <span class="muted">&lt;{{ shown.commit.email }}&gt;</span>
                </dd>
                <dt>Date</dt>
                <dd>{{ formatDate(shown.commit.authorDate) }}</dd>
                <template v-if="shown.commit.committer !== shown.commit.author || shown.commit.commitDate !== shown.commit.authorDate">
                  <dt>Committer</dt>
                  <dd>
                    {{ shown.commit.committer }}
                    <span class="muted">&lt;{{ shown.commit.committerEmail }}&gt; · {{ formatDate(shown.commit.commitDate) }}</span>
                  </dd>
                </template>
              </dl>
              <pre class="message">{{ reflowMessage(shown.commit.body) }}</pre>
            </template>
            <p v-else-if="shown.kind === 'uncommitted'" class="muted">
              Working tree and index compared to HEAD. Right-click the row to stash or discard.
            </p>
            <p v-else-if="shown.kind === 'compare'" class="muted">
              Changes between the two selected commits. Cmd/Ctrl-click another row to change the comparison.
            </p>
          </div>
          <div class="files">
            <div class="files-head">
              <span>{{ shown.loading ? 'Loading…' : `${shown.files.length} file${shown.files.length === 1 ? '' : 's'} changed` }}</span>
              <span v-if="!shown.loading" class="stat"
                ><span class="add">+{{ totals.add }}</span> <span class="del">−{{ totals.del }}</span></span
              >
              <button
                class="ghost icon-btn"
                :class="{ on: prefs.detailsFilesTree.value }"
                :title="prefs.detailsFilesTree.value ? 'Show as a flat list' : 'Show as the folders they\'re in'"
                @click="prefs.detailsFilesTree.value = !prefs.detailsFilesTree.value"
              >
                <Icon :name="prefs.detailsFilesTree.value ? 'folder' : 'list'" :size="13" />
              </button>
            </div>
            <Skeleton v-if="shown.loading" :lines="5" :gap="14" />
            <ul v-else-if="!prefs.detailsFilesTree.value">
              <li
                v-for="f in shown.files"
                :key="f.path"
                :title="STATUS[f.status] ?? f.status"
                @click="open(f)"
                @contextmenu.prevent="fileMenu($event, f)"
              >
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
            <ul v-else class="tree">
              <li
                v-for="r in fileRows"
                :key="r.path"
                :class="{ dir: r.kind === 'dir' }"
                :style="{ paddingLeft: `${(r.kind === 'dir' ? 8 : 24) + r.depth * 14}px` }"
                :title="r.kind === 'dir' ? r.path : (STATUS[r.file.status] ?? r.file.status)"
                @click="r.kind === 'dir' ? toggleFolder(r.path) : open(r.file)"
                @contextmenu.prevent="r.kind === 'file' && fileMenu($event, r.file)"
              >
                <template v-if="r.kind === 'dir'">
                  <Icon name="chevron" :size="11" class="chev" :class="{ open: !collapsed.has(r.path) }" />
                  <FileIcon :path="r.path" folder :open="!collapsed.has(r.path)" />
                  <span class="path">{{ r.name }}</span>
                </template>
                <template v-else>
                  <span class="status" :class="`s-${r.file.status === '?' ? 'U' : r.file.status}`">{{
                    r.file.status === '?' ? 'U' : r.file.status
                  }}</span>
                  <FileIcon :path="r.path" />
                  <span class="path"
                    >{{ r.name }}<span v-if="r.file.oldPath" class="muted"> ← {{ splitPath(r.file.oldPath).name }}</span></span
                  >
                  <span v-if="r.file.additions != null" class="stat"
                    ><span class="add">+{{ r.file.additions }}</span> <span class="del">−{{ r.file.deletions }}</span></span
                  >
                </template>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.details-slot {
  display: flex;
  flex: none;
  flex-direction: column;
}
.details-slot.sliding {
  overflow: hidden;
  transition: height 0.26s var(--ease-out);
}
.details-slot.shut {
  overflow: hidden;
  pointer-events: none;
}
.resize {
  flex: none;
  height: 10px;
  cursor: row-resize;
}
.details {
  display: flex;
  flex: none;
  flex-direction: column;
  min-height: 0;
}
header {
  gap: 8px;
  padding-left: 14px;
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
  border-right: 1px solid var(--divider);
  /* The hash, author and message can be selected and copied. */
  user-select: text;
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
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--fg-muted);
}
.files-head span:first-child {
  flex: 1;
}
.files-head .icon-btn {
  flex: none;
  width: 22px;
  height: 22px;
}
.icon-btn.on {
  color: var(--accent);
}
.chev {
  flex: none;
  color: var(--fg-faint);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
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
