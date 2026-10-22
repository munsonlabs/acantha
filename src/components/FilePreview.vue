<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { git, type Blame, type Commit, type FileContent } from '@/lib/git'
import { tokenize, type Token } from '@/lib/highlight'
import { compactDate, formatDate, nameHue, shortHash, splitPath } from '@/lib/format'
import { displayDate } from '@/composables/dates'
import type { PreviewView } from '@/composables/files'
import { prefs } from '@/composables/prefs'
import { overlays } from '@/composables/commands'
import { openMenu, type MenuEntry } from '@/composables/useContextMenu'
import { fileOpenItems } from '@/composables/openers'
import { confirmAction } from '@/composables/useDialog'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import CodeEditor from './CodeEditor.vue'
import CodeView, { type BlameCell } from './CodeView.vue'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'
import Skeleton from './Skeleton.vue'

const ws = useWorkspace()
const { preview, dirty, open, closePreview, diskChanged, openFiles, drafts, setDraft } = ws.files
const { stage, refresh } = ws.status
const { repo, rows } = ws.repo
const { select } = ws.details
const { openDiff } = ws.diff

const content = shallowRef<FileContent | null>(null)
const tokens = shallowRef<Token[][] | null>(null)
const blame = shallowRef<Blame | null>(null)
const history = shallowRef<Commit[] | null>(null)
const error = ref<string | null>(null)
const rendered = ref(true)
const editor = ref<InstanceType<typeof CodeEditor>>()
/** The file's text as it was last loaded or saved, to tell whether the editor has changes. */
const saved = ref('')
const saving = ref(false)

/**
 * The file's new text when it changed on disk (a formatter, git, another editor) while you had unsaved edits here.
 * Without unsaved edits it's simply loaded; a preview always just updates.
 */
const diskText = ref<string | null>(null)

async function catchUp() {
  const p = preview.value
  if (!p || p.rev !== null || p.view === 'history' || !repo.value || saving.value) return
  const file = await git.readFile(repo.value, null, p.path).catch(() => null)
  const now = preview.value
  if (!file || file.kind !== 'text' || !now || now.path !== p.path || now.view !== p.view || now.rev !== null) return
  if (p.view !== 'edit') {
    if (content.value?.kind !== 'text' || content.value.text !== file.text) void load()
    return
  }
  if (file.text === saved.value) return void (diskText.value = null)
  if (dirty.value) return void (diskText.value = file.text)
  saved.value = file.text
  editor.value?.setDoc(file.text)
}
watch(diskChanged, () => void catchUp())

/** Takes the version on disk, dropping the edits made here. */
function reloadFromDisk() {
  if (diskText.value === null) return
  saved.value = diskText.value
  editor.value?.setDoc(diskText.value)
  dirty.value = false
  if (preview.value) setDraft(preview.value.path, null)
  diskText.value = null
}

watch(
  () => preview.value && `${preview.value.path}|${preview.value.view}`,
  () => (diskText.value = null),
)
let seq = 0

const EDITORS = ['', 'Visual Studio Code', 'Cursor', 'Zed', 'Sublime Text', 'TextEdit']

const isMarkdown = computed(() => /\.(md|markdown|mdx)$/i.test(preview.value?.path ?? ''))
const crumbs = computed(() => splitPath(preview.value?.path ?? ''))
const text = computed(() => (content.value?.kind === 'text' ? content.value.text : ''))
/** What the editor starts with: the file, or your unsaved draft of it. */
const editorText = ref('')

async function load() {
  const p = preview.value
  if (!p || !repo.value) return
  const id = ++seq
  error.value = null
  try {
    if (p.view === 'history') {
      history.value = null
      const h = await git.fileHistory(repo.value, p.rev, p.path)
      if (id === seq) history.value = h
      return
    }
    const [file, b] = await Promise.all([git.readFile(repo.value, p.rev, p.path), p.view === 'blame' ? git.blame(repo.value, p.rev, p.path) : null])
    if (id !== seq) return
    // Only text can be edited: anything else (an image, say) opened for editing shows as a preview instead.
    if (p.view === 'edit' && file.kind !== 'text') return void open(p.path, 'preview', p.rev)
    if (p.view === 'edit' && file.kind === 'text') {
      // Coming back to a file with unsaved edits: pick them up where they were left.
      const draft = drafts.value.get(p.path)
      saved.value = draft?.base ?? file.text
      editorText.value = draft?.text ?? file.text
      dirty.value = !!draft
      // It changed on disk while you were away.
      diskText.value = draft && file.text !== draft.base ? file.text : null
    }
    content.value = file
    blame.value = b
    if (p.view === 'edit') return
    // Other views show the saved file; the dot still says there's an unsaved draft of it.
    dirty.value = p.rev === null && drafts.value.has(p.path)
    tokens.value = file.kind === 'text' ? await tokenize(file.text.replace(/\n$/, ''), p.path) : null
  } catch (e) {
    if (id === seq) error.value = String(e)
  }
}

watch(
  () => preview.value && `${preview.value.path}|${preview.value.rev}|${preview.value.view}`,
  () => {
    content.value = null
    tokens.value = null
    void load()
  },
  { immediate: true },
)

// A search result in a Markdown file points at a line of its source.
watch(
  () => preview.value?.line,
  (line) => line && (rendered.value = false),
  { immediate: true },
)

const setView = (view: PreviewView) => preview.value && open(preview.value.path, view, preview.value.rev)

/** Every edit updates the file's draft, so switching away and back keeps it. */
function onEdit(doc: string) {
  const p = preview.value
  dirty.value = doc !== saved.value
  if (p && p.rev === null) setDraft(p.path, dirty.value ? { text: doc, base: saved.value } : null)
}

async function save(stageAfter = false) {
  const p = preview.value
  if (!p || p.view !== 'edit' || !repo.value || !editor.value || saving.value) return
  const doc = editor.value.getDoc()
  const name = crumbs.value.name
  saving.value = true
  try {
    // Don't silently overwrite edits made elsewhere (the terminal, another editor) since the file was opened.
    const onDisk = await git.readFile(repo.value, null, p.path).catch(() => null)
    const changedElsewhere = onDisk?.kind === 'text' && onDisk.text !== saved.value && onDisk.text !== doc
    if (
      changedElsewhere &&
      !(await confirmAction('File Changed on Disk', `\`${name}\` changed outside the app since you opened it. Overwrite it?`, 'Overwrite', true))
    )
      return
    await git.writeFile(repo.value, p.path, doc)
    saved.value = doc
    dirty.value = false
    setDraft(p.path, null)
    if (stageAfter) await stage([{ path: p.path, oldPath: null, index: '.', worktree: 'M', kind: 'changed' }])
    else void refresh()
    showToast(stageAfter ? `Saved and staged ${name}` : `Saved ${name}`)
  } catch (e) {
    showToast(String(e), 'error')
  } finally {
    saving.value = false
  }
}

/** Picks the app "Open in" uses, from where the menu that asked was. */
function chooseEditor(at: { clientX: number; clientY: number }) {
  openMenu(
    at as MouseEvent,
    EDITORS.map((app) => ({
      label: app || 'Default App',
      icon: app === prefs.externalEditor.value ? ('check' as const) : undefined,
      run: () => (prefs.externalEditor.value = app),
    })),
  )
}

/** Editing a text file: Save shows, and the menu has the editor's own things. */
const editingText = computed(() => preview.value?.view === 'edit' && content.value?.kind === 'text')

/** Everything but the view switcher, Save and Close, kept out of the way: from ⋯, or right-clicking the toolbar. */
function moreMenu(e: MouseEvent) {
  const p = preview.value
  if (!p) return
  const at = { clientX: e.clientX, clientY: e.clientY }
  const items: MenuEntry[] = [{ header: crumbs.value.name, detail: p.rev ? `${p.path} at ${shortHash(p.rev)}` : p.path }]
  if (editingText.value)
    items.push(
      { label: 'Save', icon: 'check', shortcut: '⌘S', disabled: saving.value || !dirty.value, run: () => save() },
      { label: 'Save & Stage', icon: 'plus', disabled: saving.value || !dirty.value, run: () => save(true) },
      {
        label: prefs.editorVim.value ? 'Vim Keys: On' : 'Vim Keys: Off',
        icon: 'pencil',
        run: () => (prefs.editorVim.value = !prefs.editorVim.value),
      },
      'separator',
    )
  if (isMarkdown.value && p.view === 'preview')
    items.push({ label: rendered.value ? 'Show Source' : 'Show Rendered', icon: 'eye', run: () => (rendered.value = !rendered.value) }, 'separator')
  if (p.rev === null && repo.value)
    items.push(...fileOpenItems(repo.value, p.path), { label: 'Choose Editor…', icon: 'app', run: () => chooseEditor(at) }, 'separator')
  items.push({ label: `Open Files (${openFiles.value.length})`, icon: 'files', shortcut: '⌘E', run: () => (overlays.openFiles.value = true) })
  openMenu(e, items)
}

const ZERO = /^0+$/

const blameCells = computed<BlameCell[] | undefined>(() => {
  const b = blame.value
  if (!b) return undefined
  return b.lines.map((line, i) => {
    const c = b.commits[line.hash]
    const uncommitted = ZERO.test(line.hash)
    return {
      start: i === 0 || b.lines[i - 1].hash !== line.hash,
      hash: uncommitted ? '' : line.hash,
      label: uncommitted ? 'Not committed yet' : `${c?.author ?? ''} · ${c ? compactDate(c.date) : ''}`,
      title: uncommitted ? 'Uncommitted change' : `${shortHash(line.hash)} ${c?.summary ?? ''}\n${c?.author ?? ''}, ${c ? formatDate(c.date) : ''}`,
      hue: uncommitted ? 0 : nameHue(line.hash),
    }
  })
})

/** Shows a commit in the graph, if it is loaded. */
function showCommit(hash: string) {
  if (!rows.value.some((c) => c.hash === hash)) return
  closePreview()
  void select(hash)
}

function historyDiff(c: Commit) {
  const p = preview.value!
  void openDiff({ status: 'M', path: p.path, oldPath: null, additions: null, deletions: null }, c.parents[0] ?? null, c.hash)
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`)
</script>

<template>
  <div v-if="preview" class="preview">
    <!-- Just the file, how to view it, Save and Close; everything else is in ⋯, also on right-click. -->
    <header class="pane-header" :class="{ editing: editingText }" @contextmenu.prevent="moreMenu">
      <FileIcon :path="preview.path" />
      <span class="path" :title="preview.path">
        <span class="dir">{{ crumbs.dir }}</span
        ><span class="name">{{ crumbs.name }}</span>
        <span v-if="dirty" class="dirty" title="Unsaved changes">●</span>
      </span>
      <span v-if="preview.rev" class="rev" title="At this commit">{{ shortHash(preview.rev) }}</span>
      <div class="segmented">
        <button :class="{ on: preview.view === 'preview' }" title="Preview" @click="setView('preview')"><Icon name="eye" :size="13" /></button>
        <button :class="{ on: preview.view === 'blame' }" title="Blame" @click="setView('blame')"><Icon name="user" :size="13" /></button>
        <button :class="{ on: preview.view === 'history' }" title="History" @click="setView('history')"><Icon name="history" :size="13" /></button>
        <button v-if="preview.rev === null" :class="{ on: preview.view === 'edit' }" title="Edit" @click="setView('edit')">
          <Icon name="pencil" :size="13" />
        </button>
      </div>
      <button v-if="editingText" class="primary save" :disabled="saving || !dirty" title="Save (⌘S)" @click="save()">Save</button>
      <button class="ghost icon-btn" title="More" @click="moreMenu"><Icon name="ellipsis" /></button>
      <button class="ghost icon-btn" title="Close (Esc)" @click="closePreview"><Icon name="x" /></button>
    </header>

    <div class="body">
      <div v-if="diskText !== null && preview.view === 'edit'" class="disk-bar">
        <Icon name="warning" :size="13" />
        <span>This file changed on disk while you were editing it.</span>
        <button class="ghost" @click="reloadFromDisk">Reload</button>
        <button class="ghost" title="Keep your edits; saving will ask before overwriting" @click="diskText = null">Keep mine</button>
      </div>
      <p v-if="error" class="note error">{{ error }}</p>

      <template v-else-if="preview.view === 'history'">
        <Skeleton v-if="!history" :lines="6" :gap="18" />
        <p v-else-if="!history.length" class="note">No commits touch this file.</p>
        <ul v-else class="history">
          <li v-for="c in history" :key="c.hash" @click="historyDiff(c)">
            <span class="sha">{{ shortHash(c.hash) }}</span>
            <span class="subject">{{ c.subject }}</span>
            <span class="author">{{ c.author }}</span>
            <span class="date" :title="formatDate(c.date)">{{ displayDate(c.date) }}</span>
            <button class="ghost icon-btn" title="View the file at this commit" @click.stop="open(preview.path, 'preview', c.hash)">
              <Icon name="eye" :size="13" />
            </button>
          </li>
        </ul>
      </template>

      <Skeleton v-else-if="!content" :lines="14" />
      <p v-else-if="preview.view === 'edit' && content.kind !== 'text'" class="note">
        Only text files can be edited here. Use Open to edit it elsewhere.
      </p>
      <CodeEditor
        v-else-if="preview.view === 'edit'"
        ref="editor"
        :key="preview.path"
        :path="preview.path"
        :text="editorText"
        :line="preview.line"
        @change="onEdit"
        @save="save()"
      />
      <div v-else-if="content.kind === 'image'" class="image">
        <img :src="`data:${content.mime};base64,${content.data}`" :alt="preview.path" />
        <span class="meta">{{ size(content.size) }}</span>
      </div>
      <p v-else-if="content.kind === 'binary'" class="note">Binary file, {{ size(content.size) }}.</p>
      <p v-else-if="content.kind === 'tooLarge'" class="note">This file is too large to preview ({{ size(content.size) }}).</p>
      <MarkdownView
        v-else-if="isMarkdown && rendered && preview.view === 'preview'"
        :source="text"
        :path="preview.path"
        :repo="repo!"
        :rev="preview.rev"
        @open="(path) => open(path, 'preview', preview!.rev)"
      />
      <Skeleton v-else-if="!tokens" :lines="14" />
      <CodeView v-else :lines="tokens" :blame="preview.view === 'blame' ? blameCells : undefined" :focus="preview.line" @commit="showCommit" />
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  container-type: inline-size;
}
.pane-header button {
  flex: none;
  white-space: nowrap;
}
.path {
  flex: 1 1 auto;
  min-width: 60px;
  overflow: hidden;
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dir {
  color: var(--fg-faint);
}
.name {
  font-weight: 500;
}
.rev {
  flex: none;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--pill);
  color: var(--fg-muted);
  font: 11px var(--mono);
}
.segmented {
  display: flex;
  flex: none;
  padding: 2px;
  border-radius: 8px;
  background: var(--input-bg);
}
.segmented button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
}
.segmented button.on {
  background: var(--pill);
  box-shadow: inset 0 0 0 1px var(--hover);
  color: var(--fg);
}
.save {
  height: 26px;
  padding: 0 12px;
  font-size: 12px;
}
.dirty {
  margin-left: 6px;
  color: var(--modify);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.disk-bar {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in oklab, var(--modify) 40%, transparent);
  background: color-mix(in oklab, var(--modify) 12%, var(--bg));
  font-size: 12px;
}
.disk-bar span {
  flex: 1;
}
.disk-bar button {
  height: 22px;
  padding: 0 8px;
  font-size: 11.5px;
}
.note {
  margin: 24px;
  color: var(--fg-muted);
}
.note.error {
  color: var(--del);
  white-space: pre-wrap;
}
.image {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px;
}
.image img {
  max-width: 100%;
  border-radius: 6px;
  /* A checkerboard behind transparent images. */
  background: repeating-conic-gradient(var(--pill) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
}
.meta {
  color: var(--fg-faint);
  font-size: 11.5px;
}
.history {
  margin: 0;
  padding: 6px;
  list-style: none;
}
.history li {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 140px 110px 26px;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
}
.history li:hover {
  background: var(--hover);
}
.history span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sha,
.date {
  color: var(--fg-faint);
  font: 11.5px var(--mono);
}
.author {
  color: var(--fg-muted);
}
</style>
