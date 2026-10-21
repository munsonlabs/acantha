<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@/lib/editor'
import { git } from '@/lib/git'
import { wordsIn } from '@/lib/words'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'

const props = defineProps<{ path: string; text: string; line?: number }>()
const emit = defineEmits<{ change: [doc: string]; save: [] }>()

const el = ref<HTMLElement>()
const ws = useWorkspace()
const loading = ref(true)
let editor: Editor | null = null
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

onMounted(async () => {
  // Import paths complete from the file list, which the sidebar may not have loaded yet.
  if (!ws.files.list.value.length) void ws.files.load()
  const { createEditor } = await import('@/lib/editor')
  if (disposed) return
  editor = createEditor(el.value!, {
    doc: props.text,
    path: props.path,
    vim: prefs.editorVim.value,
    files: () => ws.files.list.value,
    words: () => words,
    onChange: (doc) => emit('change', doc),
    onSave: () => emit('save'),
  })
  loading.value = false
  if (props.line) editor.goTo(props.line)
  editor.focus()
  void gatherWords()
})

// Files opened or closed since, or changed on disk.
watch([ws.files.openFiles, ws.files.diskChanged], () => void gatherWords())

watch(prefs.editorVim, (on) => editor?.setVim(on))
// Opening the same file again at another line, from a search result or a path in the terminal.
watch(
  () => props.line,
  (line) => line && editor?.goTo(line),
)

onBeforeUnmount(() => {
  disposed = true
  editor?.destroy()
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
