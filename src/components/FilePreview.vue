<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { git, type Blame, type Commit, type FileContent } from '@/lib/git'
import { tokenize, type Token } from '@/lib/highlight'
import { compactDate, formatDate, nameHue, shortHash, splitPath } from '@/lib/format'
import type { PreviewView } from '@/composables/files'
import { useWorkspace } from '@/composables/workspace'
import CodeView, { type BlameCell } from './CodeView.vue'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'

const ws = useWorkspace()
const { preview, open, closePreview } = ws.files
const { repo, rows } = ws.repo
const { select } = ws.details
const { openDiff } = ws.diff

const content = shallowRef<FileContent | null>(null)
const tokens = shallowRef<Token[][] | null>(null)
const blame = shallowRef<Blame | null>(null)
const history = shallowRef<Commit[] | null>(null)
const error = ref<string | null>(null)
const rendered = ref(true)
let seq = 0

const isMarkdown = computed(() => /\.(md|markdown|mdx)$/i.test(preview.value?.path ?? ''))
const crumbs = computed(() => splitPath(preview.value?.path ?? ''))
const text = computed(() => (content.value?.kind === 'text' ? content.value.text : ''))

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
    content.value = file
    blame.value = b
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

const setView = (view: PreviewView) => preview.value && open(preview.value.path, view, preview.value.rev)

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
    <header class="pane-header">
      <button class="ghost icon-btn" title="Back to history (Esc)" @click="closePreview"><Icon name="history" /></button>
      <FileIcon :path="preview.path" />
      <span class="path" :title="preview.path">
        <span class="dir">{{ crumbs.dir }}</span
        ><span class="name">{{ crumbs.name }}</span>
      </span>
      <span class="rev">{{ preview.rev ? shortHash(preview.rev) : 'Working tree' }}</span>
      <div class="spacer" />
      <div class="segmented">
        <button :class="{ on: preview.view === 'preview' }" @click="setView('preview')"><Icon name="eye" :size="12" /> Preview</button>
        <button :class="{ on: preview.view === 'blame' }" @click="setView('blame')"><Icon name="user" :size="12" /> Blame</button>
        <button :class="{ on: preview.view === 'history' }" @click="setView('history')"><Icon name="history" :size="12" /> History</button>
      </div>
      <button v-if="isMarkdown && preview.view === 'preview'" class="ghost toggle" @click="rendered = !rendered">
        {{ rendered ? 'Source' : 'Rendered' }}
      </button>
      <button class="ghost icon-btn" title="Close" @click="closePreview"><Icon name="x" /></button>
    </header>

    <div class="body">
      <p v-if="error" class="note error">{{ error }}</p>

      <template v-else-if="preview.view === 'history'">
        <p v-if="!history" class="note">Loading…</p>
        <p v-else-if="!history.length" class="note">No commits touch this file.</p>
        <ul v-else class="history">
          <li v-for="c in history" :key="c.hash" @click="historyDiff(c)">
            <span class="sha">{{ shortHash(c.hash) }}</span>
            <span class="subject">{{ c.subject }}</span>
            <span class="author">{{ c.author }}</span>
            <span class="date" :title="formatDate(c.date)">{{ compactDate(c.date) }}</span>
            <button class="ghost icon-btn" title="View the file at this commit" @click.stop="open(preview.path, 'preview', c.hash)">
              <Icon name="eye" :size="13" />
            </button>
          </li>
        </ul>
      </template>

      <p v-else-if="!content" class="note">Loading…</p>
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
      <p v-else-if="!tokens" class="note">Loading…</p>
      <CodeView v-else :lines="tokens" :blame="preview.view === 'blame' ? blameCells : undefined" @commit="showCommit" />
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.path {
  min-width: 0;
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
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
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
.toggle {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
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
