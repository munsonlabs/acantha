<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { git } from '@/lib/git'
import { shortHash } from '@/lib/format'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import { openMenu } from '@/composables/useContextMenu'
import { fileOpenItems, folderOpenItems } from '@/composables/openers'
import { ask, confirmAction } from '@/composables/useDialog'
import { showToast } from '@/composables/useToast'
import type { MenuEntry } from '@/composables/useContextMenu'
import Skeleton from './Skeleton.vue'

const ws = useWorkspace()
const { rev, list, loading, filter, expanded, newFolders, preview, load, browse, toggle, open, closePreview, leaveEditor } = ws.files
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
  // Folders made here that git can't list yet, being empty.
  if (rev.value === null)
    for (const path of newFolders.value) {
      let dir = root
      for (const part of path.split('/')) {
        let next = dir.dirs.get(part)
        if (!next) dir.dirs.set(part, (next = { dirs: new Map(), files: [] }))
        dir = next
      }
    }
  return root
})

/** The working tree can be changed from here; past commits can't. */
const working = computed(() => rev.value === null)
const repoRoot = () => ws.repo.repo.value!

/** Opens every folder down to `path`, so what was just made or moved is in view. */
function reveal(path: string, includeSelf = false) {
  const parts = path.split('/')
  const next = new Set(expanded.value)
  for (let i = 1; i < parts.length + (includeSelf ? 1 : 0); i++) next.add(parts.slice(0, i).join('/'))
  expanded.value = next
}

async function afterChange() {
  await load()
  void ws.status.refresh()
}

/** New File… or New Folder… in `dir` ('' for the top). A name with slashes makes the folders on the way. */
async function create(kind: 'file' | 'folder', dir: string) {
  const v = await ask({
    title: kind === 'file' ? 'New File' : 'New Folder',
    message: dir ? `In \`${dir}/\`.` : 'At the top of the repository.',
    fields: [{ name: 'name', label: 'Name', required: true, placeholder: kind === 'file' ? 'notes.md, or src/new.ts' : 'components' }],
    confirm: 'Create',
  })
  const name = String(v?.name ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  if (!v || !name) return
  const path = dir ? `${dir}/${name}` : name
  try {
    if (kind === 'file') {
      await git.createFile(repoRoot(), path)
      await afterChange()
      reveal(path)
      await open(path)
    } else {
      await git.createFolder(repoRoot(), path)
      newFolders.value = new Set([...newFolders.value, path])
      reveal(path, true)
    }
  } catch (e) {
    showToast(String(e), 'error')
  }
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)

/** Rename… also moves: the new name can be a path elsewhere in the repository. */
async function rename(r: Row) {
  const v = await ask({
    title: r.kind === 'dir' ? 'Rename Folder' : 'Rename File',
    message: 'A new name, or a path to move it to.',
    fields: [{ name: 'to', label: 'Name', value: r.path, required: true }],
    confirm: 'Rename',
  })
  const to = String(v?.to ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  if (!v || !to || to === r.path) return
  const p = preview.value
  const wasOpen = p && p.rev === null && inside(p.path, r.path) ? p : null
  if (wasOpen && !(await leaveEditor())) return
  try {
    await git.renamePath(repoRoot(), r.path, to)
    newFolders.value = new Set([...newFolders.value].map((f) => (inside(f, r.path) ? to + f.slice(r.path.length) : f)))
    await afterChange()
    reveal(to, r.kind === 'dir')
    if (wasOpen) await open(to + wasOpen.path.slice(r.path.length), wasOpen.view, null)
    showToast(`Renamed to ${to}`)
  } catch (e) {
    showToast(String(e), 'error')
  }
}

async function trash(r: Row) {
  const what = r.kind === 'dir' ? 'folder' : 'file'
  if (!(await confirmAction('Move to Trash', `Move the ${what} \`${r.path}\` to the Trash? You can put it back from Finder.`, 'Move to Trash', true)))
    return
  const p = preview.value
  if (p && p.rev === null && inside(p.path, r.path)) {
    await closePreview()
    if (preview.value) return // kept open for unsaved edits
  }
  try {
    await git.trashPath(repoRoot(), r.path)
    newFolders.value = new Set([...newFolders.value].filter((f) => !inside(f, r.path)))
    await afterChange()
    showToast(`Moved ${r.path.split('/').pop()} to the Trash`)
  } catch (e) {
    showToast(String(e), 'error')
  }
}

const createItems = (dir: string): MenuEntry[] => [
  { label: 'New File…', icon: 'file', run: () => create('file', dir) },
  { label: 'New Folder…', icon: 'folder', run: () => create('folder', dir) },
]

const changeItems = (r: Row): MenuEntry[] => [
  { label: 'Rename…', icon: 'pencil', run: () => rename(r) },
  { label: 'Move to Trash', icon: 'trash', danger: true, run: () => trash(r) },
]

/** Right-clicking empty space in the tree, or the header's + button. */
function rootMenu(e: MouseEvent) {
  if (working.value) openMenu(e, createItems(''))
}

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

function rowMenu(e: MouseEvent, r: Row) {
  const root = repoRoot()
  const header = { header: r.path.split('/').pop()!, detail: r.path }
  if (r.kind === 'dir')
    return openMenu(e, [
      header,
      ...(working.value ? [...createItems(r.path), 'separator' as const, ...changeItems(r), 'separator' as const] : []),
      ...folderOpenItems(`${root}/${r.path}`, () => ws.terminals.add(`${root}/${r.path}`)),
    ])
  openMenu(e, [
    header,
    ...(working.value
      ? [
          { label: 'Edit', icon: 'pencil' as const, run: () => open(r.path, 'edit') },
          { label: 'Preview', icon: 'eye' as const, run: () => open(r.path, 'preview') },
          'separator' as const,
          ...changeItems(r),
        ]
      : [{ label: 'Preview', icon: 'eye' as const, run: () => open(r.path) }]),
    'separator',
    ...fileOpenItems(root, r.path),
  ])
}

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
      <button v-if="working" class="ghost icon-btn" title="New file or folder" @click="rootMenu"><Icon name="plus" /></button>
      <button class="ghost icon-btn" title="Refresh" @click="load"><Icon name="refresh" /></button>
    </header>
    <div class="filter">
      <Icon name="search" :size="12" />
      <input v-model="filter" type="text" placeholder="Filter files" spellcheck="false" autocomplete="off" />
    </div>
    <div class="tree" @contextmenu.self.prevent="rootMenu">
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
        @contextmenu.prevent="rowMenu($event, r)"
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
