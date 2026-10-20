<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Token } from '@/lib/highlight'

export interface BlameCell {
  /** Only the first line of a run from the same commit shows its details. */
  start: boolean
  hash: string
  label: string
  title: string
  hue: number
}

/** focus: a 1-based line to scroll to and mark, e.g. a search result. */
const props = defineProps<{ lines: Token[][]; blame?: BlameCell[]; focus?: number }>()
const emit = defineEmits<{ commit: [hash: string] }>()

const root = ref<HTMLElement>()
watch(
  () => [props.focus, props.lines] as const,
  async () => {
    if (!props.focus) return
    await nextTick()
    root.value?.children[props.focus - 1]?.scrollIntoView({ block: 'center' })
  },
  { immediate: true },
)
</script>

<template>
  <div ref="root" class="code" :class="{ blamed: blame }">
    <div v-for="(line, i) in lines" :key="i" class="line" :class="{ 'blame-start': blame?.[i]?.start && i > 0, focus: focus === i + 1 }">
      <button
        v-if="blame"
        class="blame"
        :style="{ '--hue': blame[i]?.hue ?? 0 }"
        :title="blame[i]?.title"
        :disabled="!blame[i]?.hash"
        @click="blame[i]?.hash && emit('commit', blame[i].hash)"
      >
        {{ blame[i]?.start ? blame[i].label : '' }}
      </button>
      <span class="ln">{{ i + 1 }}</span>
      <span class="text"
        ><span v-for="(t, j) in line" :key="j" :style="t.style">{{ t.content }}</span></span
      >
    </div>
  </div>
</template>

<style scoped>
.code {
  min-width: max-content;
  padding: 8px 0 24px;
  font: 12px/1.6 var(--mono);
  user-select: text;
}
.line {
  display: flex;
  min-height: 19px;
}
.line:hover {
  background: var(--hover);
}
.line.focus {
  background: var(--match);
  box-shadow: inset 2px 0 0 var(--accent);
}
.blame-start {
  border-top: 1px solid var(--border);
}
.blame {
  position: sticky;
  left: 0;
  z-index: 1;
  flex: none;
  width: 230px;
  height: auto;
  overflow: hidden;
  padding: 0 10px;
  border: 0;
  border-left: 2px solid hsl(var(--hue) 50% 60% / 70%);
  border-radius: 0;
  background: var(--bg);
  color: var(--fg-muted);
  font: 11.5px/19px var(--font);
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.blame:hover:not(:disabled) {
  background: var(--bg);
  color: var(--fg);
}
.ln {
  flex: none;
  width: 52px;
  padding-right: 16px;
  color: var(--fg-faint);
  text-align: right;
  user-select: none;
}
.text {
  padding-right: 24px;
  white-space: pre;
}
.text span {
  color: var(--shiki-dark, var(--fg));
}
@media (prefers-color-scheme: light) {
  .text span {
    color: var(--shiki-light, var(--fg));
  }
}
</style>
