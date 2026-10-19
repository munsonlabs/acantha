<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { git } from '@/lib/git'
import { parseConflicts, resolvedLines, serialize, type ConflictBlock, type Resolution, type Segment } from '@/lib/conflicts'
import { useWorkspace } from '@/composables/workspace'
import { showToast } from '@/composables/useToast'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { conflict } = ws.ui
const { repo } = ws.repo
const { stage } = ws.status

const segments = ref<Segment[]>([])
const error = ref<string | null>(null)
const saving = ref(false)

const blocks = computed(() => segments.value.filter((s): s is ConflictBlock => s.type === 'conflict'))
const resolved = computed(() => blocks.value.filter((b) => b.resolution).length)

watch(
  conflict,
  async (file) => {
    segments.value = []
    error.value = null
    if (!file || !repo.value) return
    try {
      const content = await git.readFile(repo.value, null, file.path)
      if (content.kind !== 'text') throw new Error('Only text files can be resolved here.')
      segments.value = parseConflicts(content.text)
      if (!blocks.value.length) error.value = 'No conflict markers left in this file. Mark it as resolved if it looks right.'
    } catch (e) {
      error.value = String(e)
    }
  },
  { immediate: true },
)

const choose = (block: ConflictBlock, resolution: Resolution | null) => {
  block.resolution = resolution
}
const chooseAll = (resolution: Resolution) => blocks.value.forEach((b) => (b.resolution = resolution))

/** Hand-editing starts from whatever the block resolves to now, or both sides when it isn't resolved yet. */
function editBlock(block: ConflictBlock, text?: string) {
  block.custom = text ?? (block.resolution ? resolvedLines(block) : [...block.current, ...block.incoming]).join('\n')
  block.resolution = 'custom'
}

async function save() {
  const file = conflict.value
  if (!file || !repo.value) return
  saving.value = true
  try {
    // With no markers left, the file is saved as it is and only marked resolved.
    if (blocks.value.length) await git.writeFile(repo.value, file.path, serialize(segments.value))
    await stage([file])
    showToast(`Resolved ${file.path}`)
    conflict.value = null
  } catch (e) {
    showToast(String(e), 'error')
  } finally {
    saving.value = false
  }
}

const close = () => (conflict.value = null)
</script>

<template>
  <div v-if="conflict" class="overlay" @mousedown.self="close">
    <div class="modal resolver" role="dialog" aria-modal="true">
      <header>
        <h2>
          <Icon name="warning" :size="14" />
          <FileIcon :path="conflict.path" />
          <span class="mono">{{ conflict.path }}</span>
        </h2>
        <span class="progress">{{ resolved }} of {{ blocks.length }} resolved</span>
        <button class="ghost" :disabled="!blocks.length" @click="chooseAll('current')">Accept All Current</button>
        <button class="ghost" :disabled="!blocks.length" @click="chooseAll('incoming')">Accept All Incoming</button>
        <button class="ghost icon-btn" title="Close (Esc)" @click="close"><Icon name="x" /></button>
      </header>

      <div class="body">
        <p v-if="error" class="note">{{ error }}</p>
        <template v-for="(seg, i) in segments" :key="i">
          <pre v-if="seg.type === 'text'" class="context">{{ seg.lines.join('\n') }}</pre>
          <div v-else class="conflict" :class="{ done: seg.resolution }">
            <template v-if="!seg.resolution">
              <div class="side current">
                <div class="side-head">
                  <span
                    >Current <em>{{ seg.currentLabel }}</em></span
                  >
                  <button class="ghost" @click="choose(seg, 'current')">Accept Current</button>
                </div>
                <pre>{{ seg.current.join('\n') || ' ' }}</pre>
              </div>
              <div class="side incoming">
                <div class="side-head">
                  <span
                    >Incoming <em>{{ seg.incomingLabel }}</em></span
                  >
                  <button class="ghost" @click="choose(seg, 'incoming')">Accept Incoming</button>
                </div>
                <pre>{{ seg.incoming.join('\n') || ' ' }}</pre>
              </div>
              <div class="both">
                <button class="ghost" @click="choose(seg, 'both')">Accept Both (current first)</button>
                <button class="ghost" @click="choose(seg, 'both-reversed')">Accept Both (incoming first)</button>
                <button class="ghost" @click="editBlock(seg)">Edit Manually</button>
              </div>
            </template>
            <template v-else>
              <div class="side-head">
                <span
                  ><Icon name="check" :size="12" /> Resolved:
                  {{ seg.resolution === 'custom' ? 'edited by hand' : seg.resolution.replace('-', ' ') }}</span
                >
                <button class="ghost" @click="choose(seg, null)">Undo</button>
              </div>
              <!-- Any resolution can be tweaked by hand; typing turns it into a custom one. -->
              <textarea
                class="resolved"
                :value="resolvedLines(seg).join('\n')"
                :rows="Math.max(resolvedLines(seg).length, 1)"
                spellcheck="false"
                @input="editBlock(seg, ($event.target as HTMLTextAreaElement).value)"
              />
            </template>
          </div>
        </template>
      </div>

      <footer>
        <span class="hint">The file is saved and staged. Continue the merge or rebase from the sidebar.</span>
        <button @click="close">Cancel</button>
        <button class="primary" :disabled="saving || resolved < blocks.length" @click="save">
          {{ blocks.length ? 'Save & Mark Resolved' : 'Mark Resolved' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.resolver {
  display: flex;
  flex-direction: column;
  width: min(1100px, calc(100vw - 48px));
  height: calc(100vh - 64px);
}
header,
footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
}
header {
  border-bottom: 1px solid var(--border);
}
footer {
  justify-content: flex-end;
  border-top: 1px solid var(--border);
}
h2 {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: 0;
  color: var(--modify);
  font-size: 12.5px;
  font-weight: 500;
}
h2 .mono {
  overflow: hidden;
  color: var(--fg);
  text-overflow: ellipsis;
}
.progress {
  color: var(--fg-muted);
  font-size: 12px;
}
header button {
  height: 26px;
  font-size: 12px;
}
.hint {
  flex: 1;
  color: var(--fg-faint);
  font-size: 11.5px;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
}
pre {
  margin: 0;
  font: 12px/1.6 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.context {
  padding: 2px 10px;
  color: var(--fg-muted);
}
.conflict {
  margin: 8px 0;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
}
.conflict.done {
  border-color: color-mix(in oklab, var(--add) 40%, transparent);
}
.side pre,
.conflict.done pre {
  padding: 6px 10px;
}
.current {
  background: color-mix(in oklab, var(--ansi-green) 9%, transparent);
}
.incoming {
  border-top: 1px solid var(--border);
  background: color-mix(in oklab, var(--ansi-blue) 9%, transparent);
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 4px 10px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.side-head span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.side-head em {
  color: var(--fg-faint);
  font-style: normal;
}
.side-head button,
.both button {
  height: 24px;
  padding: 0 8px;
  font-size: 11.5px;
}
.both {
  display: flex;
  gap: 4px;
  padding: 4px 6px;
  border-top: 1px solid var(--border);
}
.note {
  color: var(--fg-muted);
}
.resolved {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  font: 12px/1.6 var(--mono);
  resize: vertical;
  outline: none;
  user-select: text;
}
.resolved:focus {
  background: var(--hover);
}
</style>
