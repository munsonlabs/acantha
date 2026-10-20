<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { parseLines } from '@/lib/todos'
import type { Todo } from '@/composables/panel'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

/** One to-do list tab of the panel. */
const props = defineProps<{ tabId: string; items: Todo[] }>()
const { list } = useWorkspace().panel

const draft = ref('')
const editing = ref<string | null>(null)
const editText = ref('')
const editInput = ref<HTMLInputElement[]>()

const done = computed(() => props.items.filter((t) => t.done).length)

function add() {
  const items = parseLines(draft.value)
  if (items.length) list.add(props.tabId, items)
  draft.value = ''
}

/** Pasting several lines (or a bulleted list) into the box adds each as its own item. */
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!text.includes('\n')) return
  e.preventDefault()
  list.add(props.tabId, parseLines(text))
}

async function startEdit(t: Todo) {
  editing.value = t.id
  editText.value = t.text
  await nextTick()
  editInput.value?.[0]?.select()
}

function saveEdit(t: Todo) {
  if (editing.value !== t.id) return
  const text = editText.value.trim()
  editing.value = null
  if (!text) list.remove(props.tabId, t.id)
  else if (text !== t.text) list.edit(props.tabId, t.id, text)
}
</script>

<template>
  <div class="todo-list">
    <div v-if="items.length" class="summary">
      <span>{{ done }} of {{ items.length }} done</span>
      <span class="bar"><span :style="{ width: `${(done / items.length) * 100}%` }" /></span>
      <button v-if="done" class="ghost" @click="list.clearDone(tabId)">Clear done</button>
    </div>
    <ul class="items">
      <li v-for="t in items" :key="t.id" class="item" :class="{ done: t.done }">
        <button class="check" :class="{ on: t.done }" :title="t.done ? 'Mark as not done' : 'Mark as done'" @click="list.toggle(tabId, t.id)">
          <Icon v-if="t.done" name="check" :size="11" />
        </button>
        <input
          v-if="editing === t.id"
          ref="editInput"
          v-model="editText"
          class="edit"
          type="text"
          spellcheck="false"
          @keydown.enter="saveEdit(t)"
          @keydown.esc.stop="editing = null"
          @blur="saveEdit(t)"
        />
        <span v-else class="text" title="Click to edit" @click="startEdit(t)">{{ t.text }}</span>
        <button class="ghost icon-btn remove" title="Delete" @click="list.remove(tabId, t.id)"><Icon name="x" :size="12" /></button>
      </li>
    </ul>
    <label class="add">
      <Icon name="plus" :size="12" />
      <input v-model="draft" type="text" placeholder="Add a to-do, or paste a list" spellcheck="false" @keydown.enter="add" @paste="onPaste" />
    </label>
  </div>
</template>

<style scoped>
.todo-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 6px 8px;
  color: var(--fg-faint);
  font-size: 11.5px;
}
.bar {
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--pill);
}
.bar span {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 0.2s var(--ease-out);
}
.summary button {
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
}
.items {
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 28px;
  padding: 4px 6px;
  border-radius: 7px;
}
.item:hover {
  background: var(--hover);
}
.check {
  display: grid;
  flex: none;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  padding: 0;
  border: 1.5px solid var(--border-strong);
  border-radius: 5px;
  background: transparent;
  color: var(--bg);
}
.check.on {
  border-color: var(--accent);
  background: var(--accent);
}
.text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
  cursor: text;
}
.item.done .text {
  color: var(--fg-faint);
  text-decoration: line-through;
}
.edit {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--ring);
  border-radius: 5px;
  background: var(--input-bg);
  font-size: 13px;
}
.remove {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--fg-faint);
  opacity: 0;
}
.item:hover .remove {
  opacity: 1;
}
.add {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--fg-faint);
}
.add:focus-within {
  border-color: var(--ring);
}
.add input {
  flex: 1;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12.5px;
}
</style>
