<script setup lang="ts">
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

const { diff, closeDiff } = useWorkspace().diff
</script>

<template>
  <div v-if="diff" class="overlay" @mousedown.self="closeDiff">
    <div class="modal" role="dialog" aria-modal="true">
      <header>
        <h2 class="mono">
          {{ diff.file.path }}<span v-if="diff.file.oldPath" class="muted"> ← {{ diff.file.oldPath }}</span>
          <span v-if="diff.label" class="label">{{ diff.label }}</span>
        </h2>
        <button class="ghost icon-btn" title="Close (Esc)" @click="closeDiff"><Icon name="x" /></button>
      </header>
      <div class="body">
        <p v-if="diff.error" class="note error">{{ diff.error }}</p>
        <p v-else-if="!diff.result" class="note">Loading…</p>
        <p v-else-if="diff.result.binary" class="note">Binary file, no text diff available.</p>
        <p v-else-if="!diff.result.lines.length" class="note">No content changes (mode or rename only).</p>
        <table v-else>
          <tbody>
            <tr v-for="(l, i) in diff.result.lines" :key="i" :class="l.kind">
              <template v-if="l.kind === 'hunk'">
                <td colspan="3">{{ l.text }}</td>
              </template>
              <template v-else>
                <td class="no">{{ l.oldNo }}</td>
                <td class="no">{{ l.newNo }}</td>
                <td class="code">{{ l.text || ' ' }}</td>
              </template>
            </tr>
          </tbody>
        </table>
        <p v-if="diff.result?.truncated" class="note">Diff truncated, it is too large to show in full.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal {
  display: flex;
  flex-direction: column;
  width: min(1200px, calc(100vw - 48px));
  height: calc(100vh - 64px);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
h2 {
  flex: 1;
  overflow: hidden;
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.label {
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--pill);
  color: var(--fg-muted);
  font: 500 10.5px var(--font);
}
.body {
  flex: 1;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font: 12px/1.5 var(--mono);
}
td {
  padding: 0 8px;
  vertical-align: top;
}
.no {
  width: 1%;
  min-width: 36px;
  color: var(--fg-muted);
  text-align: right;
  user-select: none;
  opacity: 0.7;
}
.code {
  white-space: pre;
}
.add {
  background: var(--diff-add);
}
.del {
  background: var(--diff-del);
}
.hunk td {
  padding: 4px 8px;
  background: var(--diff-hunk);
  color: var(--fg-muted);
}
.note td {
  font-style: italic;
  color: var(--fg-muted);
}
p.note {
  padding: 20px;
  color: var(--fg-muted);
}
p.error {
  color: var(--del);
  white-space: pre-wrap;
}
</style>
