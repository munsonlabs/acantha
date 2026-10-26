<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { buildPatch, canPickLines } from '@/lib/diff'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { diff, closeDiff, reloadDiff } = ws.diff
const { applyLines, busy } = ws.status

/**
 * A working-tree or staged diff from the source control panel can be taken apart: a hunk at a time from its header,
 * or picked lines (click a change, shift-click to the end of a run) from the bar at the bottom.
 */
const side = computed(() => {
  const d = diff.value
  return d?.status && d.result && d.status.file.kind === 'changed' && canPickLines(d.result) ? d.status : null
})
const chosen = ref(new Set<number>())
let anchor = -1
watch(
  () => diff.value?.result,
  () => {
    chosen.value = new Set()
    anchor = -1
  },
)

const isChange = (i: number) => ['add', 'del'].includes(diff.value?.result?.lines[i]?.kind ?? '')

function choose(i: number, e: MouseEvent) {
  if (!side.value || !isChange(i)) return
  const next = new Set(chosen.value)
  if (e.shiftKey && anchor !== -1) {
    const [a, b] = anchor < i ? [anchor, i] : [i, anchor]
    for (let j = a; j <= b; j++) if (isChange(j)) next.add(j)
  } else if (next.has(i)) {
    next.delete(i)
  } else {
    next.add(i)
  }
  anchor = i
  chosen.value = next
}

/** The changes in the hunk whose header is at `i`. */
function hunkLines(i: number) {
  const lines = diff.value!.result!.lines
  const out = new Set<number>()
  for (let j = i + 1; j < lines.length && lines[j].kind !== 'hunk'; j++) if (isChange(j)) out.add(j)
  return out
}

async function act(action: 'stage' | 'unstage' | 'discard', lines: Set<number>) {
  const d = diff.value
  if (!d?.result || !side.value || busy.value) return
  // Unstaging and discarding take changes back out, so the lines left alone stay as they are on that side.
  const patch = buildPatch(d.result, lines, action !== 'stage')
  if (!patch || !(await applyLines(side.value.file, patch, action))) return
  await reloadDiff()
  // Nothing left on this side: the diff has done its job.
  if (diff.value && !diff.value.result?.lines.some((l) => l.kind === 'add' || l.kind === 'del')) closeDiff()
}

const count = computed(() => chosen.value.size)

const table = ref<HTMLTableElement>()
function escapeHtml(s: string) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

/**
 * Copying a selection of lines also puts a coloured HTML version on the clipboard - the add/del backgrounds as a
 * plain-text paste can't carry - so pasting into Slack, Notion or a doc reads like the diff looked, not like a
 * patch. A plain-text paste still gets just the code, as it always did.
 */
function onCopy(e: ClipboardEvent) {
  const sel = window.getSelection()
  const t = table.value
  if (!sel || sel.isCollapsed || !sel.rangeCount || !t || !e.clipboardData) return
  const rowOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest('tr') ?? null
  const rows = [...t.querySelectorAll('tr')]
  let a = rows.indexOf(rowOf(sel.anchorNode)!)
  let b = rows.indexOf(rowOf(sel.focusNode)!)
  if (a === -1 || b === -1) return
  if (a > b) [a, b] = [b, a]

  const plain: string[] = []
  const html: string[] = []
  for (const row of rows.slice(a, b + 1)) {
    const text = row.querySelector('.code, .hunk-text')?.textContent ?? ''
    const bg = row.classList.contains('add') || row.classList.contains('del') ? getComputedStyle(row).backgroundColor : 'transparent'
    plain.push(text)
    html.push(`<div style="background:${bg};white-space:pre;">${escapeHtml(text) || '&nbsp;'}</div>`)
  }
  e.clipboardData.setData('text/plain', plain.join('\n'))
  e.clipboardData.setData('text/html', `<div style="font-family:ui-monospace,monospace;font-size:12px;">${html.join('')}</div>`)
  e.preventDefault()
}
</script>

<template>
  <Transition name="modal">
    <div v-if="diff" class="overlay" @mousedown.self="closeDiff">
      <div class="modal" role="dialog" aria-modal="true">
        <header>
          <FileIcon :path="diff.file.path" />
          <h2 class="mono">
            {{ diff.file.path }}<span v-if="diff.file.oldPath" class="muted"> ← {{ diff.file.oldPath }}</span>
            <span v-if="diff.label" class="label">{{ diff.label }}</span>
          </h2>
          <button class="ghost icon-btn" title="Close (Esc)" @click="closeDiff"><Icon name="x" /></button>
        </header>
        <div class="body" @copy="onCopy">
          <p v-if="diff.error" class="note error">{{ diff.error }}</p>
          <p v-else-if="!diff.result" class="note">Loading…</p>
          <p v-else-if="diff.result.binary" class="note">Binary file, no text diff available.</p>
          <p v-else-if="!diff.result.lines.length" class="note">No content changes (mode or rename only).</p>
          <table v-else ref="table">
            <tbody>
              <tr v-for="(l, i) in diff.result.lines" :key="i" :class="[l.kind, { chosen: chosen.has(i) }]">
                <template v-if="l.kind === 'hunk'">
                  <td colspan="3">
                    <div class="hunk-row">
                      <span class="hunk-text">{{ l.text }}</span>
                      <template v-if="side">
                        <template v-if="side.staged">
                          <button class="ghost mini" :disabled="busy" @click="act('unstage', hunkLines(i))">Unstage hunk</button>
                        </template>
                        <template v-else>
                          <button class="ghost mini" :disabled="busy" @click="act('discard', hunkLines(i))">Discard hunk</button>
                          <button class="ghost mini" :disabled="busy" @click="act('stage', hunkLines(i))">Stage hunk</button>
                        </template>
                      </template>
                    </div>
                  </td>
                </template>
                <template v-else>
                  <td class="no" :class="{ pickable: side && isChange(i) }" @click="choose(i, $event)">{{ l.oldNo }}</td>
                  <td class="no" :class="{ pickable: side && isChange(i) }" @click="choose(i, $event)">{{ l.newNo }}</td>
                  <td class="code">{{ l.text || ' ' }}</td>
                </template>
              </tr>
            </tbody>
          </table>
          <p v-if="diff.result?.truncated" class="note">Diff truncated, it is too large to show in full.</p>
        </div>
        <footer v-if="side" class="pick-bar">
          <span v-if="count" class="picked">{{ count }} {{ count === 1 ? 'line' : 'lines' }} selected</span>
          <span v-else class="hint">Click a line number to pick a change, shift-click for a run of them</span>
          <div class="spacer" />
          <template v-if="count">
            <button class="ghost" @click="chosen = new Set()">Clear</button>
            <button v-if="side.staged" class="primary" :disabled="busy" @click="act('unstage', chosen)">Unstage lines</button>
            <template v-else>
              <button class="ghost danger" :disabled="busy" @click="act('discard', chosen)">Discard lines</button>
              <button class="primary" :disabled="busy" @click="act('stage', chosen)">Stage lines</button>
            </template>
          </template>
        </footer>
      </div>
    </div>
  </Transition>
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
  /* The code can be selected and copied; the line numbers next to it can't, so they stay out of what's copied. */
  user-select: text;
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
/* Picking lines to stage: the line numbers are the handle. */
.no.pickable {
  cursor: pointer;
}
.no.pickable:hover {
  color: var(--fg);
  opacity: 1;
}
tr.chosen td {
  box-shadow:
    inset 0 1px 0 var(--accent),
    inset 0 -1px 0 var(--accent);
}
tr.chosen td.no {
  background: var(--accent-soft);
  color: var(--accent);
  opacity: 1;
}
.hunk-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.hunk-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini {
  height: 20px;
  padding: 0 8px;
  color: var(--fg-muted);
  font: 500 11px var(--font);
}
.mini:hover {
  color: var(--fg);
}
.pick-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.pick-bar .hint {
  color: var(--fg-faint);
}
.pick-bar .picked {
  font-weight: 600;
}
.pick-bar button {
  height: 26px;
  padding: 0 12px;
}
.spacer {
  flex: 1;
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
