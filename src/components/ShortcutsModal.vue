<script setup lang="ts">
import { computed } from 'vue'
import { commands, overlays } from '@/composables/commands'
import Icon from './Icon.vue'

const open = overlays.shortcuts

/** Keys handled where they're used rather than as commands. */
const CONTEXT: { group: string; label: string; keys: string }[] = [
  { group: 'Tabs', label: 'Go to tab 1–8, or the last', keys: '⌘1–9' },
  { group: 'Graph', label: 'Next or previous commit', keys: '↑ ↓' },
  { group: 'Graph', label: 'Compare with the selected commit', keys: '⌘ click' },
  { group: 'Graph', label: 'Next or previous search match', keys: '↵ ⇧↵' },
  { group: 'Graph', label: 'Close a panel or dialog', keys: 'Esc' },
  { group: 'Editing', label: 'Commit (in the message box)', keys: '⌘↵' },
  { group: 'Editing', label: 'Save the file', keys: '⌘S' },
  { group: 'Editing', label: 'Find in the file', keys: '⌘F' },
  { group: 'Terminal', label: 'Clear the terminal', keys: '⌘K' },
  { group: 'Terminal', label: 'Open a link', keys: '⌘ click' },
]

const groups = computed(() => {
  const all = [...commands.filter((c) => c.keys).map((c) => ({ group: c.group, label: c.label, keys: c.keys! })), ...CONTEXT]
  const map = new Map<string, typeof all>()
  for (const item of all) map.set(item.group, [...(map.get(item.group) ?? []), item])
  return [...map]
})
</script>

<template>
  <div v-if="open" class="overlay" @mousedown.self="open = false">
    <div class="modal sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <header>
        <h2>Keyboard Shortcuts</h2>
        <button class="ghost icon-btn" title="Close (Esc)" @click="open = false"><Icon name="x" /></button>
      </header>
      <div class="body">
        <section v-for="[group, items] in groups" :key="group">
          <h3>{{ group }}</h3>
          <div v-for="item in items" :key="item.label" class="row">
            <span>{{ item.label }}</span>
            <kbd>{{ item.keys }}</kbd>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 12px 20px;
  border-bottom: 1px solid var(--border);
}
h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.body {
  columns: 2;
  column-gap: 28px;
  overflow: auto;
  padding: 4px 20px 20px;
}
section {
  break-inside: avoid;
}
h3 {
  margin: 16px 0 4px;
  color: var(--fg-faint);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  font-size: 12.5px;
}
kbd {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--fg-muted);
  font: 11.5px var(--font);
}
</style>
