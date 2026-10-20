<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useWorkspace } from '@/composables/workspace'
import { showToast } from '@/composables/useToast'
import Icon from './Icon.vue'

/** A Markdown notepad tab of the panel, kept per repository. It opens for editing while empty. */
const props = defineProps<{ tabId: string; text: string }>()
const { setNotes } = useWorkspace().panel

const draft = ref(props.text)
const editing = ref(!props.text.trim())
const area = ref<HTMLTextAreaElement>()
let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Saved a moment after you stop typing, and straight away when you leave the box or the tab. */
function save() {
  clearTimeout(saveTimer)
  if (draft.value !== props.text) setNotes(props.tabId, draft.value)
}
watch(draft, () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 400)
})
onBeforeUnmount(save)

async function edit() {
  editing.value = true
  await nextTick()
  area.value?.focus()
}

function preview() {
  save()
  editing.value = false
}

// The notes render in the app's webview, so anything executable is stripped.
const html = computed(() => DOMPurify.sanitize(marked.parse(draft.value, { async: false, gfm: true })))

function onClick(e: MouseEvent) {
  const href = (e.target as Element).closest('a')?.getAttribute('href')
  if (!href) return
  e.preventDefault()
  if (/^(https?|mailto):/.test(href)) openUrl(href).catch((err) => showToast(`Couldn't open the link: ${String(err)}`, 'error'))
}

/** ⌘↵ or Escape goes back to the preview. */
function onKey(e: KeyboardEvent) {
  if ((e.key === 'Enter' && e.metaKey) || e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    preview()
  }
}
</script>

<template>
  <div class="notes">
    <div class="bar">
      <div class="modes">
        <button class="ghost" :class="{ on: editing }" @click="edit"><Icon name="pencil" :size="12" /> Edit</button>
        <button class="ghost" :class="{ on: !editing }" @click="preview"><Icon name="eye" :size="12" /> Preview</button>
      </div>
      <span class="hint">{{ editing ? 'Markdown · ⌘↵ or Esc to preview' : 'Double-click to edit' }}</span>
    </div>
    <textarea
      v-if="editing"
      ref="area"
      v-model="draft"
      class="editor"
      placeholder="Notes for this repository, in Markdown: plans, commands, things to remember…"
      spellcheck="true"
      @blur="save"
      @keydown="onKey"
    />
    <!-- eslint-disable-next-line vue/no-v-html -- sanitised with DOMPurify above -->
    <article v-else-if="draft.trim()" class="rendered" @click="onClick" @dblclick="edit" v-html="html" />
    <p v-else class="empty" @dblclick="edit">No notes yet. <button class="ghost" @click="edit">Start writing</button></p>
  </div>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}
.modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--input-bg);
}
.modes button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.modes button.on {
  background: var(--pill);
  color: var(--fg);
}
.hint {
  margin-left: auto;
  color: var(--fg-faint);
  font-size: 11px;
}
.editor {
  flex: 1;
  min-height: 0;
  margin: 0 8px 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--input-bg);
  color: var(--fg);
  font: 12.5px/1.6 var(--mono);
  overflow-wrap: anywhere;
  resize: none;
  outline: none;
}
.editor:focus {
  border-color: var(--ring);
}
.rendered {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 16px 24px;
  font-size: 13.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  user-select: text;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.rendered :deep(h1),
.rendered :deep(h2) {
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.rendered :deep(h1) {
  font-size: 20px;
}
.rendered :deep(h2) {
  font-size: 17px;
}
.rendered :deep(a) {
  color: var(--ansi-blue);
  text-decoration: none;
}
.rendered :deep(a:hover) {
  text-decoration: underline;
}
.rendered :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--pill);
  font: 12px var(--mono);
}
.rendered :deep(pre) {
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
}
.rendered :deep(pre code) {
  padding: 0;
  background: none;
}
.rendered :deep(blockquote) {
  margin: 0;
  padding: 0 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--fg-muted);
}
.rendered :deep(ul),
.rendered :deep(ol) {
  padding-left: 22px;
}
.empty {
  margin: 24px 16px;
  color: var(--fg-faint);
  font-size: 12.5px;
}
</style>
