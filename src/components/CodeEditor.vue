<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@/lib/editor'
import { git } from '@/lib/git'
import { wordsIn } from '@/lib/words'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isOn } from '@/features'
import { TYPED } from '@/lib/typed'
import type { TsDiagnostic, TypeService } from '@/lib/types'
import { holdTypes } from '@/composables/typesInUse'

const props = defineProps<{ path: string; text: string; line?: number }>()
const emit = defineEmits<{ change: [doc: string]; save: [] }>()

const el = ref<HTMLElement>()
const ws = useWorkspace()
const loading = ref(true)
let editor: Editor | null = null
/** Lets the repository's TypeScript go, when this editor was using it. */
let releaseTypes = () => {}
let disposed = false

/** Words from the other open files, for completion: their unsaved drafts, or what's on disk or at their commit. */
let words: readonly string[] = []
let gathering = 0
async function gatherWords() {
  const id = ++gathering
  const repo = ws.repo.repo.value
  if (!repo) return
  const found = new Set<string>()
  const others = ws.files.openFiles.value.filter((f) => !(f.path === props.path && f.rev === null))
  const texts = await Promise.all(
    others.map(async (f) => {
      const draft = f.rev === null ? ws.files.drafts.value.get(f.path) : undefined
      if (draft) return draft.text
      const file = await git.readFile(repo, f.rev, f.path).catch(() => null)
      return file?.kind === 'text' ? file.text : ''
    }),
  )
  if (id !== gathering || disposed) return
  for (const text of texts) for (const w of wordsIn(text)) found.add(w)
  words = [...found]
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
    types:
      root && isOn('types') && TYPED.test(props.path)
        ? { file: `${root}/${props.path}`, service: typeService(root, `${root}/${props.path}`) }
        : undefined,
    onChange: (doc) => emit('change', doc),
    onSave: () => emit('save'),
  })
  if (root && isOn('types') && TYPED.test(props.path)) releaseTypes = holdTypes(root)
  loading.value = false
  void loadBase()
  if (props.line) editor.goTo(props.line)
  editor.focus()
  void gatherWords()
})

// Files opened or closed since, or changed on disk.
watch([ws.files.openFiles, ws.files.diskChanged], () => void gatherWords())

/**
 * What the change markers compare with: the file as it is in the index, so staging a change clears its markers, as in
 * VS Code. A new file git doesn't have yet has nothing to compare with.
 */
async function loadBase() {
  const root = ws.repo.repo.value
  if (!editor || !root || !isOn('changeMarkers')) return
  const file = await git.readFile(root, '', props.path).catch(() => null)
  editor?.setBase(file?.kind === 'text' ? file.text : null)
}
// Staging, unstaging and commits change the index.
watch(
  () => ws.status.status.value,
  () => void loadBase(),
)
// Opening the same file again at another line, from a search result or a path in the terminal.
watch(
  () => props.line,
  (line) => line && editor?.goTo(line),
)

onBeforeUnmount(() => {
  disposed = true
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
