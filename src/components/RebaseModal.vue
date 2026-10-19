<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { git, type Commit, type RebaseAction } from '@/lib/git'
import { shortHash } from '@/lib/format'
import { useWorkspace } from '@/composables/workspace'
import { showToast } from '@/composables/useToast'
import Icon from './Icon.vue'

interface Item {
  commit: Commit
  action: RebaseAction
  message: string
}

const ws = useWorkspace()
const { rebase } = ws.ui
const { repo, reload } = ws.repo
const { refresh } = ws.status

const ACTIONS: { value: RebaseAction; label: string; hint: string }[] = [
  { value: 'pick', label: 'Pick', hint: 'Keep the commit' },
  { value: 'reword', label: 'Reword', hint: 'Keep it, with a new message' },
  { value: 'edit', label: 'Edit', hint: 'Stop after it so you can amend it' },
  { value: 'squash', label: 'Squash', hint: 'Meld into the commit above, combining messages' },
  { value: 'fixup', label: 'Fixup', hint: 'Meld into the commit above, keeping its message' },
  { value: 'drop', label: 'Drop', hint: 'Remove the commit' },
]

const items = ref<Item[]>([])
const loading = ref(false)
const running = ref(false)
const dragging = ref<number | null>(null)

watch(
  rebase,
  async (r) => {
    items.value = []
    if (!r || !repo.value) return
    loading.value = true
    try {
      const commits = await git.rebaseCommits(repo.value, r.base)
      items.value = commits.map((commit) => ({ commit, action: 'pick', message: commit.subject }))
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

const hasMerges = computed(() => items.value.some((i) => i.commit.parents.length > 1))

/** Squash and fixup fold into the commit above, so the first kept commit cannot use them. */
const problem = computed(() => {
  if (hasMerges.value) return 'This range contains merge commits, which an interactive rebase would flatten. Pick a later starting commit.'
  const first = items.value.find((i) => i.action !== 'drop')
  if (!first) return 'Every commit is dropped.'
  if (first.action === 'squash' || first.action === 'fixup') return `The first commit can't be squashed or fixed up into the one before it.`
  if (items.value.some((i) => i.action === 'reword' && !i.message.trim())) return 'A reworded commit needs a message.'
  return null
})

/** The order the commits were loaded in, to tell whether anything has been rearranged. */
const original = ref<string[]>([])
watch(
  () => items.value.length,
  () => (original.value = items.value.map((i) => i.commit.hash)),
)
const changed = computed(() => items.value.some((item, i) => item.action !== 'pick' || item.commit.hash !== original.value[i]))

async function setAction(item: Item, action: RebaseAction) {
  item.action = action
  // Start a reword from the full message rather than just the subject.
  if (action === 'reword' && item.message === item.commit.subject && repo.value) {
    const details = await git.commit(repo.value, item.commit.hash).catch(() => null)
    if (details && item.action === 'reword' && item.message === item.commit.subject) item.message = details.body
  }
}

function onDragOver(i: number) {
  const from = dragging.value
  if (from === null || from === i) return
  const list = [...items.value]
  list.splice(i, 0, list.splice(from, 1)[0])
  items.value = list
  dragging.value = i
}

function move(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= items.value.length) return
  const list = [...items.value]
  list.splice(j, 0, list.splice(i, 1)[0])
  items.value = list
}

async function start() {
  const r = rebase.value
  if (!r || !repo.value || problem.value) return
  running.value = true
  showToast('Rebasing…', 'busy')
  try {
    const todo = items.value.map((i) => ({ action: i.action, hash: i.commit.hash, message: i.action === 'reword' ? i.message : null }))
    const out = await git.interactiveRebase(repo.value, r.base, todo)
    showToast(/Stopped at/.test(out) ? 'Rebase stopped for editing. Amend, then continue from the sidebar.' : 'Rebase complete')
    rebase.value = null
  } catch (e) {
    showToast(String(e), 'error')
    rebase.value = null
  } finally {
    running.value = false
    await reload()
    await refresh()
  }
}

const close = () => (rebase.value = null)
</script>

<template>
  <div v-if="rebase" class="overlay" @mousedown.self="close">
    <div class="modal rebase" role="dialog" aria-modal="true">
      <header>
        <h2><Icon name="rebase" :size="14" /> Interactive Rebase</h2>
        <span class="muted"
          >onto <code>{{ rebase.label }}</code> · oldest first · drag to reorder</span
        >
        <div class="spacer" />
        <button class="ghost icon-btn" title="Close (Esc)" @click="close"><Icon name="x" /></button>
      </header>

      <div class="body">
        <p v-if="loading" class="note">Loading…</p>
        <p v-else-if="!items.length" class="note">No commits after this one.</p>
        <ol v-else>
          <li
            v-for="(item, i) in items"
            :key="item.commit.hash"
            :class="[item.action, { dragging: dragging === i }]"
            draggable="true"
            @dragstart="dragging = i"
            @dragend="dragging = null"
            @dragover.prevent="onDragOver(i)"
          >
            <span class="grip" title="Drag to reorder"><Icon name="grip" :size="14" /></span>
            <select
              :value="item.action"
              :title="ACTIONS.find((a) => a.value === item.action)?.hint"
              @change="setAction(item, ($event.target as HTMLSelectElement).value as RebaseAction)"
            >
              <option v-for="a in ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
            <span class="sha">{{ shortHash(item.commit.hash) }}</span>
            <div class="message">
              <textarea v-if="item.action === 'reword'" v-model="item.message" rows="2" spellcheck="true" />
              <span v-else class="subject">{{ item.commit.subject }}</span>
            </div>
            <span class="author">{{ item.commit.author }}</span>
            <span class="arrows">
              <button class="ghost icon-btn" title="Move up" :disabled="i === 0" @click="move(i, -1)">
                <Icon name="chevron" :size="11" class="up" />
              </button>
              <button class="ghost icon-btn" title="Move down" :disabled="i === items.length - 1" @click="move(i, 1)">
                <Icon name="chevron" :size="11" class="down" />
              </button>
            </span>
          </li>
        </ol>
      </div>

      <footer>
        <span class="problem" :class="{ shown: problem }">
          <template v-if="problem"><Icon name="warning" :size="12" /> {{ problem }}</template>
          <template v-else>Uncommitted changes are stashed and restored automatically.</template>
        </span>
        <button @click="close">Cancel</button>
        <button class="primary" :disabled="running || !!problem || !changed" @click="start">Start Rebase</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.rebase {
  display: flex;
  flex-direction: column;
  width: min(900px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
}
header,
footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
header {
  border-bottom: 1px solid var(--border);
}
footer {
  border-top: 1px solid var(--border);
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
code {
  font: 11.5px var(--mono);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: 20px 96px 64px minmax(0, 1fr) 120px 52px;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 4px 6px;
  border-radius: 8px;
}
li:hover {
  background: var(--hover);
}
li.dragging {
  background: var(--pill);
  opacity: 0.7;
}
li.drop .subject,
li.drop .sha {
  color: var(--fg-faint);
  text-decoration: line-through;
}
li.squash,
li.fixup {
  margin-left: 18px;
}
.grip {
  color: var(--fg-faint);
  cursor: grab;
}
select {
  height: 26px;
  padding: 0 6px;
  font-size: 12px;
}
li.drop select {
  color: var(--del);
}
li.reword select,
li.edit select {
  color: var(--ansi-blue);
}
li.squash select,
li.fixup select {
  color: var(--ansi-magenta);
}
.sha {
  color: var(--fg-faint);
  font: 11.5px var(--mono);
}
.subject,
.author {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.author {
  color: var(--fg-muted);
  font-size: 12px;
}
textarea {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--fg);
  font: 12px/1.4 var(--font);
  resize: vertical;
  outline: none;
  user-select: text;
}
textarea:focus {
  border-color: var(--ring);
}
.arrows {
  display: flex;
}
.arrows .icon-btn {
  width: 22px;
  height: 22px;
}
.up {
  transform: rotate(-90deg);
}
.down {
  transform: rotate(90deg);
}
.problem {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  color: var(--fg-faint);
  font-size: 11.5px;
}
.problem.shown {
  color: var(--modify);
}
.note {
  margin: 16px;
  color: var(--fg-muted);
}
</style>
