<script lang="ts">
import { wordsIn } from '@/lib/words'

/** Words found in files, by repository, commit and path, with when; shared by every editor. */
const fileWords = new Map<string, { words: readonly string[]; at: number }>()
/** How long a file on disk's words are used before it's read again. */
const DISK_WORDS_MS = 30_000
/** A draft's words, kept with the draft itself, so they're found again until it's edited. */
const draftWords = new WeakMap<object, readonly string[]>()
function wordsOfDraft(draft: { text: string }) {
  let found = draftWords.get(draft)
  if (!found) draftWords.set(draft, (found = [...wordsIn(draft.text)]))
  return found
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@/lib/editor'
import { git } from '@/lib/git'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isOn } from '@/features'
import { BIG_FILE, TYPED } from '@/lib/typed'
import { symbolsOf, type Symbol, type TsDiagnostic, type TypeService } from '@/lib/types'
import { holdTypes } from '@/composables/typesInUse'
import SymbolPicker from './SymbolPicker.vue'

const props = defineProps<{ path: string; text: string; line?: number }>()
const emit = defineEmits<{ change: [doc: string]; save: [] }>()

/** A big file's edited plainly (see BIG_FILE): no TypeScript, words or change markers. */
const big = props.text.length > BIG_FILE
const typed = !big && isOn('types') && TYPED.test(props.path)
/** Words from other files are for completing where TypeScript doesn't. */
const wantsWords = !big && !typed

const el = ref<HTMLElement>()
const ws = useWorkspace()
const loading = ref(true)
let editor: Editor | null = null
/** Lets the repository's TypeScript go, when this editor was using it. */
let releaseTypes = () => {}
let disposed = false

/** ⇧⌘O: this file's symbols, to jump to. */
const showSymbols = ref(false)
const symbols = ref<Symbol[]>([])
async function openSymbolPicker() {
  const root = ws.repo.repo.value
  if (!root) return
  const file = `${root}/${props.path}`
  const found = await invoke('ts_request', {
    repo: root,
    command: 'navto',
    arguments: { file, searchValue: '', maxResultCount: 300, currentFileOnly: true },
  }).catch(() => null)
  symbols.value = symbolsOf(found)
  showSymbols.value = true
}
function chooseSymbol(s: Symbol) {
  editor?.goTo(s.start.line, s.start.offset)
}

/**
 * Words from the other open files, for completion: their unsaved drafts, or what's on disk or at their commit. Each
 * file's are kept and reused: a commit's never change, a draft's change when it's edited, and a file on disk is read
 * again only after a while (they're suggestions, so a little out of date does no harm). Not gathered at all where
 * they're not used: a file TypeScript completes, or a big one.
 */
let words: readonly string[] = []
let gathering = 0
let gatherTimer: ReturnType<typeof setTimeout> | undefined
const gatherSoon = () => {
  clearTimeout(gatherTimer)
  gatherTimer = setTimeout(() => void gatherWords(), 500)
}
async function gatherWords() {
  const id = ++gathering
  const repo = ws.repo.repo.value
  if (!repo || !wantsWords) return
  const others = ws.files.openFiles.value.filter((f) => !(f.path === props.path && f.rev === null))
  const lists = await Promise.all(
    others.map(async (f): Promise<readonly string[]> => {
      const draft = f.rev === null ? ws.files.drafts.value.get(f.path) : undefined
      if (draft) return wordsOfDraft(draft)
      const key = `${repo}\0${f.rev ?? ''}\0${f.path}`
      const known = fileWords.get(key)
      if (known && (f.rev !== null || Date.now() - known.at < DISK_WORDS_MS)) return known.words
      const file = await git.readFile(repo, f.rev, f.path).catch(() => null)
      const found = file?.kind === 'text' && file.text.length <= BIG_FILE ? [...wordsIn(file.text)] : []
      fileWords.set(key, { words: found, at: Date.now() })
      return found
    }),
  )
  if (id !== gathering || disposed) return
  words = [...new Set(lists.flat())]
}

/**
 * TypeScript for this file, through the backend's tsserver for the repository: asked about the code, told of edits,
 * and followed for its errors. A definition elsewhere in the repository opens there, at its line.
 */
function typeService(root: string, file: string): TypeService {
  const request = (command: string, args: Record<string, unknown>) => invoke('ts_request', { repo: root, command, arguments: args })
  return {
    ask: (command, args) => request(command, args).catch(() => null),
    tell: (command, args) => void request(command, args).catch(() => {}),
    onDiagnostics(listener) {
      const stop = listen<{ repo: string; file: string; kind: string; diagnostics: TsDiagnostic[] }>('ts:diag', ({ payload }) => {
        if (payload.repo === root && payload.file === file) listener(payload.kind, payload.diagnostics)
      })
      return () => void stop.then((u) => u())
    },
    goTo(target, line, col) {
      if (target === file) editor?.goTo(line, col)
      else if (target.startsWith(`${root}/`)) void ws.files.open(target.slice(root.length + 1), undefined, null, line)
    },
  }
}

onMounted(async () => {
  // Import paths complete from the file list, which the sidebar may not have loaded yet.
  if (!ws.files.list.value.length) void ws.files.load()
  const { createEditor } = await import('@/lib/editor')
  if (disposed) return
  const root = ws.repo.repo.value
  editor = createEditor(el.value!, {
    doc: props.text,
    path: props.path,
    files: () => ws.files.list.value,
    words: () => words,
    changeMarkers: isOn('changeMarkers'),
    types: root && typed ? { file: `${root}/${props.path}`, service: typeService(root, `${root}/${props.path}`) } : undefined,
    onJumpToSymbol: typed ? openSymbolPicker : undefined,
    onChange: (doc) => emit('change', doc),
    onSave: () => emit('save'),
  })
  if (root && typed) releaseTypes = holdTypes(root)
  loading.value = false
  void loadBase()
  if (props.line) editor.goTo(props.line)
  editor.focus()
  void gatherWords()
})

// Files opened or closed since, or a draft edited; a change on disk is caught up with on the next of those.
watch([ws.files.openFiles, ws.files.drafts], gatherSoon)

/**
 * What the change markers compare with: the file as it is in the index, so staging a change clears its markers, as in
 * VS Code. A new file git doesn't have yet has nothing to compare with.
 */
async function loadBase() {
  const root = ws.repo.repo.value
  if (!editor || !root || !isOn('changeMarkers') || big) return
  const file = await git.readFile(root, '', props.path).catch(() => null)
  editor?.setBase(file?.kind === 'text' ? file.text : null)
}
// Staging, unstaging and commits change the index: looked at again only when this file's state, or the commit, does.
watch(
  () => {
    const s = ws.status.status.value
    const f = s?.files.find((x) => x.path === props.path)
    return `${s?.oid}|${f?.index ?? ''}|${f?.worktree ?? ''}`
  },
  () => void loadBase(),
)
// Opening the same file again at another line, from a search result or a path in the terminal.
watch(
  () => props.line,
  (line) => line && editor?.goTo(line),
)

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(gatherTimer)
  editor?.destroy()
  releaseTypes()
})

defineExpose({
  getDoc: () => editor?.getDoc() ?? props.text,
  setDoc: (text: string) => editor?.setDoc(text),
})
</script>

<template>
  <div class="code-editor">
    <p v-if="loading" class="note">Loading editor…</p>
    <div ref="el" class="host" />
    <SymbolPicker v-model:open="showSymbols" :symbols="symbols" @choose="chooseSymbol" />
  </div>
</template>

<style scoped>
.code-editor {
  position: relative;
  height: 100%;
}
.host {
  height: 100%;
  user-select: text;
}
.note {
  position: absolute;
  margin: 24px;
  color: var(--fg-muted);
}
</style>
