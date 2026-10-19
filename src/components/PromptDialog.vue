<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { closeDialog, useDialog, type DialogValues } from '@/composables/useDialog'

const { current } = useDialog()
const values = ref<DialogValues>({})
const form = ref<HTMLFormElement>()
const missing = ref<string | null>(null)

watch(current, async (d) => {
  if (!d) return
  values.value = Object.fromEntries((d.fields ?? []).map((f) => [f.name, f.value ?? (f.type === 'checkbox' ? false : '')]))
  missing.value = null
  await nextTick()
  form.value?.querySelector<HTMLElement>('input:not([type=checkbox]), select, button[type=submit]')?.focus()
})

/** Splits a message on backticks so `names` render as code. */
const segments = (message: string) => message.split('`').map((text, i) => ({ text, code: i % 2 === 1 }))

function submit() {
  const d = current.value!
  const result: DialogValues = {}
  for (const f of d.fields ?? []) {
    const v = values.value[f.name]
    result[f.name] = typeof v === 'string' ? v.trim() : v
  }
  const empty = (d.fields ?? []).find((f) => f.required && !result[f.name])
  if (empty) {
    missing.value = empty.name
    return
  }
  closeDialog(result)
}
</script>

<template>
  <Transition name="modal">
    <div v-if="current" class="overlay" @mousedown.self="closeDialog(null)">
      <form ref="form" class="modal dialog" @submit.prevent="submit">
        <h2>{{ current.title }}</h2>
        <p v-if="current.message">
          <template v-for="(s, i) in segments(current.message)" :key="i">
            <code v-if="s.code">{{ s.text }}</code>
            <template v-else>{{ s.text }}</template>
          </template>
        </p>
        <template v-for="f in current.fields ?? []" :key="f.name">
          <label v-if="f.type === 'checkbox'" class="check"><input v-model="values[f.name]" type="checkbox" /> {{ f.label }}</label>
          <label v-else class="field" :class="{ invalid: missing === f.name }">
            <span>{{ f.label }}</span>
            <select v-if="f.type === 'select'" v-model="values[f.name]">
              <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input
              v-else
              v-model="values[f.name]"
              type="text"
              :placeholder="f.placeholder"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
            />
          </label>
        </template>
        <div class="actions">
          <button type="button" @click="closeDialog(null)">Cancel</button>
          <button type="submit" :class="current.danger ? 'danger' : 'primary'">{{ current.confirm ?? 'OK' }}</button>
        </div>
      </form>
    </div>
  </Transition>
</template>

<style scoped>
.dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 18px 20px;
}
h2 {
  margin: 0 0 10px;
  font-size: 15px;
}
p {
  margin: 0 0 14px;
  color: var(--fg-muted);
  line-height: 1.5;
}
code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--hover);
  font: 12px var(--mono);
  color: var(--fg);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.field span {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
}
.field.invalid input {
  border-color: var(--del);
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
