<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Editor } from '@/lib/editor'
import { contextAround, parseReply } from '@/lib/editAsk'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'

/**
 * ⌘I in the editor: a box at the selection to ask Claude Code to change it ("add jsdoc to this") or about it. A change
 * goes straight into the file, highlighted, to keep (↵) or undo (Esc); an answer shows in the box.
 */
const props = defineProps<{ editor: Editor | null; path: string; host: HTMLElement | undefined }>()

const ws = useWorkspace()
const phase = ref<'closed' | 'ask' | 'working' | 'answer' | 'review' | 'error'>('closed')
const ask = ref('')
const message = ref('')
const pos = ref({ x: 0, y: 0, above: true })
const input = ref<HTMLInputElement>()
const box = ref<HTMLElement>()
let range = { from: 0, to: 0 }
/** What the change replaced, to put back on undo. */
let old = ''
/** Each request's number: one answered after it was cancelled, or another started, is dropped. */
let asking = 0

const hasSelection = computed(() => range.to > range.from)

async function start() {
  const editor = props.editor
  if (!editor || !props.host || phase.value === 'working') return
  if (phase.value === 'review') editor.settle(null)
  const { from, to, at } = editor.selection()
  range = { from, to }
  const rect = props.host.getBoundingClientRect()
  const top = (at?.top ?? rect.top) - rect.top
  const above = top > 140
  pos.value = {
    x: Math.max(8, Math.min((at?.left ?? rect.left) - rect.left, rect.width - 440)),
    y: above ? top - 6 : (at?.bottom ?? rect.top) - rect.top + 6,
    above,
  }
  phase.value = 'ask'
  message.value = ''
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

async function submit() {
  const editor = props.editor
  const repo = ws.repo.repo.value
  const request = ask.value.trim()
  if (!editor || !repo || !request) return
  const id = ++asking
  const doc = editor.getDoc()
  const context = contextAround(doc, range.from, range.to)
  phase.value = 'working'
  box.value?.focus()
  try {
    const reply = await invoke<string>('edit_ask', { repo, path: props.path, ...context, ask: request, model: prefs.editAskModel.value || null })
    if (id !== asking || phase.value !== 'working') return
    const parsed = parseReply(reply, context.selected)
    if (parsed.kind === 'answer') {
      message.value = parsed.text || 'Claude Code didn’t say anything.'
      phase.value = 'answer'
    } else if (editor.getDoc().slice(range.from, range.to) !== context.selected) {
      fail('The code changed while Claude Code was working on it, so its edit wasn’t applied.')
    } else {
      old = editor.propose(range.from, range.to, parsed.code)
      phase.value = 'review'
    }
  } catch (e) {
    if (id === asking && phase.value === 'working') fail(String(e))
  }
  await nextTick()
  box.value?.focus()
}

function fail(why: string) {
  message.value = why
  phase.value = 'error'
}

function close(keep = true) {
  if (phase.value === 'review') props.editor?.settle(keep ? null : old)
  asking++
  phase.value = 'closed'
  props.editor?.focus()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close(false)
  } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (phase.value === 'ask') void submit()
    else if (phase.value === 'review' || phase.value === 'answer' || phase.value === 'error') close(true)
  }
}

defineExpose({ start })
</script>

<template>
  <div
    v-if="phase !== 'closed'"
    ref="box"
    class="edit-ask"
    :class="{ above: pos.above }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    tabindex="-1"
    @keydown="onKey"
  >
    <input
      v-if="phase === 'ask'"
      ref="input"
      v-model="ask"
      type="text"
      :placeholder="hasSelection ? 'Change this, or ask about it…' : 'Write code here, or ask about this file…'"
      spellcheck="false"
      autocomplete="off"
    />
    <p v-else class="asked">{{ ask }}</p>
    <div v-if="phase === 'working'" class="status"><span class="spinner" /> Claude Code is working on it… <kbd>Esc</kbd> to stop</div>
    <div v-else-if="phase === 'review'" class="status">
      <button class="primary" @click="close(true)">Keep <kbd>↵</kbd></button>
      <button @click="close(false)">Undo <kbd>Esc</kbd></button>
    </div>
    <template v-else-if="phase === 'answer' || phase === 'error'">
      <p class="message" :class="{ error: phase === 'error' }">{{ message }}</p>
      <div class="status">
        <button @click="close(true)">Done <kbd>Esc</kbd></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.edit-ask {
  position: absolute;
  z-index: 20;
  width: 430px;
  max-width: calc(100% - 16px);
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--popover);
  box-shadow: var(--shadow);
  outline: none;
}
.edit-ask.above {
  transform: translateY(-100%);
}
input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: none;
  background: none;
  font-size: 13px;
}
input:focus {
  outline: none;
}
.asked {
  margin: 0;
  padding: 4px 8px;
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.message {
  max-height: 260px;
  margin: 4px 0 0;
  padding: 0 8px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  user-select: text;
}
.message.error {
  color: var(--del);
}
.status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
  padding: 0 4px;
  color: var(--fg-muted);
  font-size: 12px;
}
.status:has(.spinner) {
  justify-content: flex-start;
}
.status button {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  font-size: 12px;
}
kbd {
  color: var(--fg-faint);
  font-family: inherit;
  font-size: 11px;
}
.spinner {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
