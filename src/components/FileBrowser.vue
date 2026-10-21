<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { git } from '@/lib/git'
import { resolveName } from '@/lib/paths'
import { shortHash } from '@/lib/format'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import { openMenu } from '@/composables/useContextMenu'
import { fileOpenItems, folderOpenItems } from '@/composables/openers'
import { confirmAction } from '@/composables/useDialog'
import { showToast } from '@/composables/useToast'
import type { MenuEntry } from '@/composables/useContextMenu'
import Skeleton from './Skeleton.vue'

const ws = useWorkspace()
const { rev, list, folders, loading, filter, expanded, newFolders, renameOpen, forgetOpen, preview, load, browse, toggle, open, closePreview } =
  ws.files
const { rows } = ws.repo
const { status } = ws.status

interface Dir {
  dirs: Map<string, Dir>
  files: string[]
}

interface Row {
  /** 'new' is the row a new file or folder is being named in. */
  kind: 'dir' | 'file' | 'new'
  path: string
  name: string
  depth: number
  /** Left out by .gitignore: shown dimmed, when asked for. */
  ignored?: boolean
}

/**
 * What .gitignore leaves out, while "Show ignored files" is on: the top-level entries git reports (an ignored folder is
 * one entry, `node_modules/`), and the contents of each ignored folder that's been opened, read a level at a time so a
 * huge one costs nothing until you look inside.
 */
const showIgnored = computed(() => prefs.showIgnored.value && rev.value === null)
const ignoredTop = shallowRef<string[]>([])
const ignoredInside = shallowRef(new Map<string, string[]>())
/** The ignored entries themselves, folders without their slash: everything at or under one is ignored. */
const ignoredRoots = computed(() => ignoredTop.value.map((p) => p.replace(/\/$/, '')))
const isIgnored = (path: string) => showIgnored.value && ignoredRoots.value.some((r) => path === r || path.startsWith(`${r}/`))

async function loadIgnored() {
  const root = ws.repo.repo.value
  ignoredInside.value = new Map()
  if (!showIgnored.value || !root) return void (ignoredTop.value = [])
  ignoredTop.value = await git.listIgnored(root).catch(() => [])
  await openIgnored()
}

/** Reads every opened ignored folder that hasn't been read yet. */
async function openIgnored() {
  const root = ws.repo.repo.value
  if (!showIgnored.value || !root) return
  const wanted = [...expanded.value].filter((p) => isIgnored(p) && !ignoredInside.value.has(p))
  if (!wanted.length) return
  const read = await Promise.all(wanted.map((p) => git.listDir(root, p).catch(() => [] as string[])))
  const next = new Map(ignoredInside.value)
  wanted.forEach((p, i) => next.set(p, read[i]))
  ignoredInside.value = next
}

watch(showIgnored, () => void loadIgnored(), { immediate: true })
// The listing was refreshed (files came or went), and folders opened.
watch(list, () => showIgnored.value && void loadIgnored())
watch(expanded, () => void openIgnored())

const tree = computed(() => {
  const root: Dir = { dirs: new Map(), files: [] }
  const folder = (path: string) => {
    let dir = root
    for (const part of path.split('/').filter(Boolean)) {
      let next = dir.dirs.get(part)
      if (!next) dir.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      dir = next
    }
    return dir
  }
  const file = (path: string) => folder(path.split('/').slice(0, -1).join('/')).files.push(path)
  for (const path of list.value) file(path)
  if (showIgnored.value) {
    for (const p of ignoredTop.value) void (p.endsWith('/') ? folder(p) : file(p))
    for (const [dir, names] of ignoredInside.value) for (const n of names) void (n.endsWith('/') ? folder(`${dir}/${n}`) : file(`${dir}/${n}`))
  }
  // Folders git can't list through their files: new and empty ones, from git and made here.
  if (rev.value === null)
    for (const path of [...folders.value, ...newFolders.value]) {
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

const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')

/** Naming a new file or folder, or renaming one, in place in the tree. */
type Editing =
  | { mode: 'rename'; path: string; kind: 'dir' | 'file'; value: string; error: string }
  | { mode: 'file' | 'folder'; dir: string; value: string; error: string }
const editing = ref<Editing | null>(null)
const editInput = ref<HTMLInputElement[]>()
let committing = false

/** Focuses the name box: a file's name is selected without its extension, as Finder does. */
async function focusEdit() {
  await nextTick()
  const el = editInput.value?.[0]
  const e = editing.value
  if (!el || !e) return
  el.focus()
  const dot = e.mode === 'rename' && e.kind === 'file' ? e.value.lastIndexOf('.') : -1
  el.setSelectionRange(0, dot > 0 ? dot : e.value.length)
}

function startCreate(kind: 'file' | 'folder', dir: string) {
  if (!working.value) return
  filter.value = ''
  if (dir) reveal(dir, true)
  editing.value = { mode: kind, dir, value: '', error: '' }
  void focusEdit()
}

function startRename(r: Row) {
  if (!working.value || r.kind === 'new') return
  filter.value = ''
  editing.value = { mode: 'rename', path: r.path, kind: r.kind, value: r.path.split('/').pop()!, error: '' }
  void focusEdit()
}

const cancelEdit = () => (editing.value = null)
const onEditBlur = () => !committing && cancelEdit()
const isEditing = (r: Row) =>
  (r.kind === 'new' && editing.value?.mode !== 'rename') || (editing.value?.mode === 'rename' && editing.value.path === r.path)

async function commitEdit() {
  const e = editing.value
  if (!e || committing) return
  const typed = e.value.trim()
  if (!typed) return cancelEdit()
  const target = resolveName(e.mode === 'rename' ? parentOf(e.path) : e.dir, typed)
  if (!target) return void (editing.value = { ...e, error: "That doesn't name a file or folder" })
  if (e.mode === 'rename' && target === e.path) return cancelEdit()
  committing = true
  try {
    if (e.mode === 'rename') await moveTo(e.path, e.kind, target)
    else if (e.mode === 'file') {
      await git.createFile(repoRoot(), target)
      editing.value = null
      await afterChange()
      reveal(target)
      await open(target)
    } else {
      await git.createFolder(repoRoot(), target)
      newFolders.value = new Set([...newFolders.value, target])
      editing.value = null
      await afterChange()
      reveal(target, true)
    }
    editing.value = null
  } catch (err) {
    // Stay in the box with the reason, so the name can be fixed.
    if (editing.value) {
      editing.value = { ...e, error: String(err) }
      void focusEdit()
    } else showToast(String(err), 'error')
  } finally {
    committing = false
  }
}

/** Renames or moves, keeping an open file open under its new name (asking first about unsaved edits). */
async function moveTo(from: string, kind: 'dir' | 'file', to: string) {
  const p = preview.value
  const wasOpen = p && p.rev === null && inside(p.path, from) ? p : null
  await git.renamePath(repoRoot(), from, to)
  renameOpen(from, to)
  editing.value = null
  newFolders.value = new Set([...newFolders.value].map((f) => (inside(f, from) ? to + f.slice(from.length) : f)))
  await afterChange()
  reveal(to, kind === 'dir')
  if (wasOpen) await open(to + wasOpen.path.slice(from.length), wasOpen.view, null)
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
    forgetOpen(r.path)
    newFolders.value = new Set([...newFolders.value].filter((f) => !inside(f, r.path)))
    await afterChange()
    showToast(`Moved ${r.path.split('/').pop()} to the Trash`)
  } catch (e) {
    showToast(String(e), 'error')
  }
}

const createItems = (dir: string): MenuEntry[] => [
  { label: 'New File', icon: 'file', run: () => startCreate('file', dir) },
  { label: 'New Folder', icon: 'folder', run: () => startCreate('folder', dir) },
]

const changeItems = (r: Row): MenuEntry[] => [
  { label: 'Rename', icon: 'pencil', run: () => startRename(r) },
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
      out.push({ kind: 'dir', path, name, depth, ignored: isIgnored(path) })
      if (expanded.value.has(path)) walk(dir.dirs.get(name)!, `${path}/`, depth + 1)
    }
    for (const path of [...dir.files].sort((a, b) => a.localeCompare(b)))
      out.push({ kind: 'file', path, name: path.slice(prefix.length), depth, ignored: isIgnored(path) })
  }
  walk(tree.value, '', 0)
  // The row a new file or folder is named in: first inside its folder (or at the top).
  const e = editing.value
  if (e && e.mode !== 'rename') {
    const at = e.dir ? out.findIndex((r) => r.kind === 'dir' && r.path === e.dir) : -1
    const depth = at === -1 ? 0 : out[at].depth + 1
    out.splice(at + 1, 0, { kind: 'new', path: '\u0000new', name: '', depth })
  }
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
          ...(/\.(md|markdown|mdx)$/i.test(r.path)
            ? [{ label: 'Preview in Panel', icon: 'eye' as const, run: () => ws.panel.addMarkdown(r.path) }]
            : []),
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
      <button
        v-if="working"
        class="ghost icon-btn"
        :class="{ on: prefs.showIgnored.value }"
        :title="prefs.showIgnored.value ? 'Hide ignored files' : 'Show ignored files (node_modules, build output…)'"
        @click="prefs.showIgnored.value = !prefs.showIgnored.value"
      >
        <Icon name="eye" />
      </button>
      <button class="ghost icon-btn" title="Refresh" @click="load"><Icon name="refresh" /></button>
    </header>
    <div class="filter">
      <Icon name="search" :size="12" />
      <input v-model="filter" type="text" placeholder="Filter files" spellcheck="false" autocomplete="off" />
    </div>
    <div class="tree" @contextmenu.self.prevent="rootMenu">
      <Skeleton v-if="loading && !list.length" :lines="10" />
      <p v-else-if="!visible.length" class="note">No files</p>
      <template v-for="r in visible" :key="r.path">
        <div
          class="row"
          :class="[
            r.kind,
            { active: r.kind === 'file' && preview?.path === r.path && preview?.rev === rev, editing: isEditing(r), ignored: r.ignored },
          ]"
          :style="{ paddingLeft: `${(r.kind === 'dir' ? 8 : 24) + r.depth * 14}px` }"
          :title="r.kind === 'new' ? undefined : r.path"
          @click="isEditing(r) || r.kind === 'new' ? undefined : r.kind === 'dir' ? toggle(r.path) : open(r.path)"
          @contextmenu.prevent="r.kind !== 'new' && rowMenu($event, r)"
        >
          <Icon v-if="r.kind === 'dir'" name="chevron" :size="11" class="chev" :class="{ open: expanded.has(r.path) }" />
          <FileIcon
            :path="r.kind === 'new' ? editing?.value || (editing?.mode === 'folder' ? 'folder' : 'untitled') : r.path"
            :folder="r.kind === 'dir' || (r.kind === 'new' && editing?.mode === 'folder')"
            :open="expanded.has(r.path)"
          />
          <input
            v-if="isEditing(r) && editing"
            ref="editInput"
            v-model="editing.value"
            class="inline"
            :class="{ invalid: editing.error }"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="editing.mode === 'folder' ? 'Folder name' : editing.mode === 'file' ? 'File name' : ''"
            @keydown.enter.prevent="commitEdit"
            @keydown.esc.stop.prevent="cancelEdit"
            @input="editing.error && (editing.error = '')"
            @blur="onEditBlur"
            @click.stop
          />
          <span v-else class="name">{{ r.name }}</span>
        </div>
        <p v-if="isEditing(r) && editing?.error" class="edit-error" :style="{ paddingLeft: `${24 + r.depth * 14}px` }">{{ editing.error }}</p>
      </template>
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
.row.editing,
.row.editing:hover {
  background: transparent;
}
.inline {
  flex: 1;
  min-width: 0;
  height: 20px;
  margin-right: 2px;
  padding: 0 5px;
  border: 1px solid var(--ring);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--fg);
  font-size: 12.5px;
  outline: none;
}
.inline.invalid {
  border-color: var(--danger, #e5534b);
}
.edit-error {
  margin: 0 6px 4px;
  color: var(--danger, #e5534b);
  font-size: 11px;
  white-space: normal;
}
.note {
  margin: 12px 8px;
  color: var(--fg-faint);
  font-size: 12px;
}
.row.ignored {
  opacity: 0.5;
}
.icon-btn.on {
  color: var(--accent);
}
</style>
