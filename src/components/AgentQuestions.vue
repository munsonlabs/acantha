<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentQuestion } from '@/lib/claudeView'

/**
 * What Claude asks with AskUserQuestion: each question's options to pick (one, or several where it allows), or an
 * answer of your own. Sends once every question has one.
 */
const props = defineProps<{ questions: AgentQuestion[] }>()
const emit = defineEmits<{ answer: [picked: string[][]]; skip: [] }>()

const picked = ref<string[][]>(props.questions.map(() => []))
const own = ref<string[]>(props.questions.map(() => ''))

function choose(i: number, label: string) {
  const now = picked.value[i]
  if (props.questions[i].multiSelect) picked.value[i] = now.includes(label) ? now.filter((l) => l !== label) : [...now, label]
  else picked.value[i] = now[0] === label ? [] : [label]
  // One answer each and nothing more to say: a single question goes as soon as it's picked.
  if (props.questions.length === 1 && !props.questions[0].multiSelect && picked.value[0].length) send()
}

/** Each question's answer: what was picked, and what was written, when there is any. */
const answers = computed(() => picked.value.map((p, i) => [...p, ...(own.value[i].trim() ? [own.value[i].trim()] : [])]))
const ready = computed(() => answers.value.every((a) => a.length))

function send() {
  if (ready.value) emit('answer', answers.value)
}
</script>

<template>
  <div class="questions">
    <div v-for="(q, i) in questions" :key="i" class="question">
      <span v-if="q.header" class="header">{{ q.header }}</span>
      <p class="text">{{ q.question }}</p>
      <div class="options">
        <button
          v-for="o in q.options"
          :key="o.label"
          class="option"
          :class="{ on: picked[i].includes(o.label) }"
          :title="o.description"
          @click="choose(i, o.label)"
        >
          <span class="label">{{ o.label }}</span>
          <span v-if="o.description" class="about">{{ o.description }}</span>
        </button>
      </div>
      <input
        v-model="own[i]"
        class="own"
        type="text"
        :placeholder="q.multiSelect ? 'Anything else…' : 'Or answer in your own words…'"
        spellcheck="false"
        @keydown.enter.prevent="send()"
      />
      <p v-if="q.multiSelect" class="hint">Pick as many as apply.</p>
    </div>
    <div class="answer">
      <button class="ghost" @click="emit('skip')">Skip</button>
      <button class="primary" :disabled="!ready" @click="send()">Answer</button>
    </div>
  </div>
</template>

<style scoped>
.question + .question {
  margin-top: 14px;
}
.header {
  display: inline-block;
  margin-top: 8px;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10.5px;
  font-weight: 550;
}
.text {
  margin: 6px 0 8px;
  line-height: 1.45;
  user-select: text;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  height: auto;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--popover);
  text-align: left;
}
.option:hover {
  border-color: var(--border-strong);
}
.option.on {
  border-color: var(--claude);
  background: color-mix(in srgb, var(--claude) 14%, var(--popover));
}
.label {
  font-weight: 550;
}
.about {
  color: var(--fg-muted);
  font-size: 11.5px;
  line-height: 1.4;
}
.own {
  width: 100%;
  height: 28px;
  margin-top: 6px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  font-size: 12px;
}
.hint {
  margin: 4px 2px 0;
  color: var(--fg-faint);
  font-size: 11px;
}
.answer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
}
.answer button {
  height: 28px;
  padding: 0 16px;
}
</style>
