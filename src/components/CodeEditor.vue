<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@/lib/editor'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'

const props = defineProps<{ path: string; text: string }>()
const emit = defineEmits<{ change: [doc: string]; save: [] }>()

const el = ref<HTMLElement>()
const ws = useWorkspace()
const loading = ref(true)
let editor: Editor | null = null
let disposed = false

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
    onChange: (doc) => emit('change', doc),
    onSave: () => emit('save'),
  })
  loading.value = false
  editor.focus()
})

watch(prefs.editorVim, (on) => editor?.setVim(on))

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
