<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Symbol } from '@/lib/types'

/** ⇧⌘O: this file's symbols (functions, classes, methods…), filtered as you type, to jump straight to one. */
const props = defineProps<{ open: boolean; symbols: Symbol[] }>()
const emit = defineEmits<{ 'update:open': [boolean]; choose: [Symbol] }>()

const query = ref('')
const index = ref(0)
const box = ref<HTMLElement>()
const input = ref<HTMLInputElement>()

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.symbols
  return props.symbols.filter((s) => s.name.toLowerCase().includes(q) || s.containerName?.toLowerCase().includes(q))
})
watch(filtered, () => (index.value = 0))

watch(
  () => props.open,
  async (o) => {
    if (!o) return
    query.value = ''
    index.value = 0
    await nextTick()
    input.value?.focus()
  },
)

const close = () => emit('update:open', false)
function choose(s: Symbol | undefined) {
  if (!s) return
  close()
  emit('choose', s)
}

function onKey(e: KeyboardEvent) {
  const n = filtered.value.length
  if (e.key === 'ArrowDown') index.value = (index.value + 1) % Math.max(n, 1)
  else if (e.key === 'ArrowUp') index.value = (index.value - 1 + n) % Math.max(n, 1)
  else if (e.key === 'Enter') choose(filtered.value[index.value])
  else if (e.key === 'Escape') close()
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="overlay top" @mousedown.self="close">
      <div ref="box" class="modal symbol-picker" role="dialog" aria-modal="true" aria-label="Go to symbol" tabindex="-1" @keydown="onKey">
        <header>
          <input ref="input" v-model="query" type="text" placeholder="Go to symbol in this file…" spellcheck="false" autocomplete="off" />
        </header>
        <div class="results">
          <div
            v-for="(s, i) in filtered"
            :key="`${s.name}:${s.start.line}:${s.start.offset}`"
            class="item"
            :class="{ selected: i === index }"
            @mousemove="index = i"
            @click="choose(s)"
          >
            <span class="label">{{ s.name }}</span>
            <span class="kind">{{ s.kind }}</span>
            <span v-if="s.containerName" class="detail">{{ s.containerName }}</span>
          </div>
          <p v-if="!filtered.length" class="none">No matching symbols</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay.top {
  align-items: flex-start;
  padding-top: 12vh;
}
.symbol-picker {
  display: flex;
  flex-direction: column;
  width: min(480px, calc(100vw - 48px));
  max-height: 55vh;
  outline: none;
}
header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
header input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  background: none;
  font-size: 13px;
}
header input:focus {
  outline: none;
}
.results {
  overflow: auto;
  padding: 6px;
}
.item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: default;
}
.item.selected {
  background: var(--hover);
}
.label {
  overflow: hidden;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.kind {
  flex: none;
  color: var(--fg-faint);
  font-size: 11px;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11.5px;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.none {
  margin: 8px 10px 12px;
  color: var(--fg-faint);
  font-size: 12.5px;
}
</style>
