<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { git, UNCOMMITTED, type Comparison, type FileChange } from '@/lib/git'
import { compactDate, shortHash, splitPath } from '@/lib/format'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

/**
 * Two branches side by side: the commits `head` has that `base` doesn't, how far behind it is, and every file changed
 * since they split, each opening its diff. Base starts as the repository's main branch, head as the one checked out.
 */
const props = defineProps<{ tabId: string; base: string | null; head: string | null; uncommitted: boolean }>()

const ws = useWorkspace()
const { repo, log } = ws.repo
const { setCompare } = ws.panel

const fallbackBase = ref<string | null>(null)
const base = computed(() => props.base ?? fallbackBase.value ?? 'main')
const current = computed(() => log.value?.headBranch ?? 'HEAD')
const head = computed(() => props.head ?? current.value)
/** Uncommitted changes count only when the head is what's checked out. */
const withUncommitted = computed(() => props.uncommitted && head.value === current.value)

const result = shallowRef<Comparison | null>(null)
const files = shallowRef<FileChange[]>([])
const error = ref<string | null>(null)
const loading = ref(false)

/** Every branch and tag, for the two pickers. */
const refs = computed(() => {
  const all = log.value?.refs ?? []
  return {
    branches: all.filter((r) => r.kind === 'branch').map((r) => r.name),
    remotes: all.filter((r) => r.kind === 'remote' && r.name !== 'HEAD').map((r) => `${r.remote}/${r.name}`),
    tags: all.filter((r) => r.kind === 'tag').map((r) => r.name),
  }
})

let seq = 0
async function load() {
  const root = repo.value
  if (!root) return
  const id = ++seq
  loading.value = true
  try {
    const c = await git.compare(root, base.value, head.value)
    const changed = c.mergeBase ? await git.changes(root, c.mergeBase, withUncommitted.value ? UNCOMMITTED : c.headHash!) : []
    if (id !== seq) return
    result.value = c
    files.value = changed
    error.value = null
  } catch (e) {
    if (id !== seq) return
    result.value = null
    files.value = []
    error.value = String(e)
  } finally {
    if (id === seq) loading.value = false
  }
}

onMounted(async () => {
  if (!props.base && repo.value) fallbackBase.value = await git.defaultBranch(repo.value)
  void load()
})
// A new commit, a checkout or a fetch moves the branches.
watch([base, head, withUncommitted, () => log.value], () => void load())

const totals = computed(() =>
  files.value.reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 }),
)

const pick = (which: 'base' | 'head', value: string) => setCompare(props.tabId, { [which]: value })
const swap = () => setCompare(props.tabId, { base: head.value, head: base.value })

function openFile(f: FileChange) {
  const c = result.value
  if (c?.mergeBase) ws.diff.openDiff(f, c.mergeBase, withUncommitted.value ? UNCOMMITTED : c.headHash!)
}

const STATUS: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', '?': 'Untracked' }
</script>

<template>
  <div class="compare">
    <div class="pickers">
      <label class="pick base">
        <span>base</span>
        <select :value="base" @change="pick('base', ($event.target as HTMLSelectElement).value)">
          <option v-if="![...refs.branches, ...refs.remotes, ...refs.tags].includes(base)" :value="base">{{ base }}</option>
          <optgroup label="Branches">
            <option v-for="b in refs.branches" :key="b" :value="b">{{ b }}</option>
          </optgroup>
          <optgroup v-if="refs.remotes.length" label="Remote">
            <option v-for="b in refs.remotes" :key="b" :value="b">{{ b }}</option>
          </optgroup>
          <optgroup v-if="refs.tags.length" label="Tags">
            <option v-for="b in refs.tags" :key="b" :value="b">{{ b }}</option>
          </optgroup>
        </select>
      </label>
      <button class="ghost icon-btn swap" title="Swap the two" @click="swap"><Icon name="merge" :size="13" /></button>
      <label class="pick head">
        <span>compare</span>
        <select :value="head" @change="pick('head', ($event.target as HTMLSelectElement).value)">
          <option v-if="![...refs.branches, ...refs.remotes, ...refs.tags].includes(head)" :value="head">{{ head }}</option>
          <optgroup label="Branches">
            <option v-for="b in refs.branches" :key="b" :value="b">{{ b }}</option>
          </optgroup>
          <optgroup v-if="refs.remotes.length" label="Remote">
            <option v-for="b in refs.remotes" :key="b" :value="b">{{ b }}</option>
          </optgroup>
          <optgroup v-if="refs.tags.length" label="Tags">
            <option v-for="b in refs.tags" :key="b" :value="b">{{ b }}</option>
          </optgroup>
        </select>
      </label>
      <label v-if="head === current" class="check" title="Count changes not committed yet, as if they were">
        <input type="checkbox" :checked="uncommitted" @change="setCompare(tabId, { uncommitted: ($event.target as HTMLInputElement).checked })" />
        uncommitted
      </label>
      <button class="ghost icon-btn refresh" title="Refresh" :disabled="loading" @click="load"><Icon name="refresh" :size="13" /></button>
    </div>

    <p v-if="error" class="note error">{{ error }}</p>
    <Skeleton v-else-if="!result" :lines="6" />
    <div v-else class="lists">
      <p class="summary">
        <strong>{{ result.ahead.length }}{{ result.ahead.length >= 200 ? '+' : '' }}</strong>
        {{ result.ahead.length === 1 ? 'commit' : 'commits' }} ahead, <strong>{{ result.behind }}</strong> behind ·
        <strong>{{ files.length }}</strong> {{ files.length === 1 ? 'file' : 'files' }} <span class="add">+{{ totals.add }}</span>
        <span class="del">−{{ totals.del }}</span>
      </p>

      <h3>Commits</h3>
      <p v-if="!result.ahead.length" class="none">Nothing in {{ head }} that {{ base }} doesn't have.</p>
      <ul>
        <li v-for="c in result.ahead" :key="c.hash" :title="`${c.subject}\n${c.author}`" @click="ws.details.select(c.hash)">
          <span class="sha">{{ shortHash(c.hash) }}</span>
          <span class="subject">{{ c.subject }}</span>
          <span class="meta"
            ><span class="author">{{ c.author }} · </span>{{ compactDate(c.date) }}</span
          >
        </li>
      </ul>

      <h3>Files changed</h3>
      <p v-if="!files.length" class="none">No file changes since they split.</p>
      <ul>
        <li
          v-for="f in files"
          :key="f.path"
          :title="`${f.path}${f.oldPath ? ` ← ${f.oldPath}` : ''} · ${STATUS[f.status] ?? f.status}`"
          @click="openFile(f)"
        >
          <FileIcon :path="f.path" />
          <span class="name">{{ splitPath(f.path).name }}</span>
          <span class="dir">{{ splitPath(f.path).dir.replace(/\/$/, '') }}</span>
          <span v-if="f.additions" class="add">+{{ f.additions }}</span>
          <span v-if="f.deletions" class="del">−{{ f.deletions }}</span>
          <span class="status" :class="`s-${f.status}`">{{ f.status }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.compare {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  container-type: inline-size;
}
/* One row when there's room: base ⇄ compare, then the options. */
.pickers {
  display: grid;
  flex: none;
  grid-template-areas: 'base swap head check refresh';
  grid-template-columns: minmax(0, 220px) auto minmax(0, 220px) 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.base {
  grid-area: base;
}
.head {
  grid-area: head;
}
.swap {
  grid-area: swap;
}
.check {
  grid-area: check;
  justify-self: end;
}
.refresh {
  grid-area: refresh;
}
.pick {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.pick span {
  flex: none;
  color: var(--fg-faint);
  font-size: 11px;
}
.pick select {
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 26px;
}
.check {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.icon-btn {
  width: 26px;
  height: 26px;
  color: var(--fg-muted);
}
.lists {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 12px;
  scrollbar-width: thin;
}
.summary {
  margin: 4px 6px 8px;
  color: var(--fg-muted);
  font-size: 12px;
}
.summary strong {
  color: var(--fg);
  font-weight: 600;
}
h3 {
  margin: 10px 6px 4px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: default;
}
li:hover {
  background: var(--hover);
}
.sha {
  flex: none;
  color: var(--fg-faint);
  font: 11px var(--mono);
}
.subject,
.name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.meta,
.dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.meta {
  text-align: right;
}
.add {
  color: var(--add);
  font: 11px var(--mono);
}
.del {
  color: var(--del);
  font: 11px var(--mono);
}
.status {
  width: 12px;
  flex: none;
  color: var(--fg-muted);
  font: 600 11px var(--mono);
  text-align: center;
}
.s-A,
.s-\? {
  color: var(--add);
}
.s-D {
  color: var(--del);
}
.s-M,
.s-R {
  color: var(--modify);
}
.none,
.note {
  margin: 4px 6px;
  color: var(--fg-faint);
  font-size: 12px;
}
.error {
  color: var(--del);
  white-space: pre-wrap;
}
/* Narrow: each branch on its own row, labels lined up, the options under them. */
@container (max-width: 520px) {
  .pickers {
    grid-template-areas:
      'base refresh'
      'head swap'
      'check check';
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 4px;
  }
  .pick span {
    width: 52px;
  }
  .check {
    justify-self: start;
    padding-left: 58px;
  }
  .author,
  .dir {
    display: none;
  }
  .name {
    flex: 1;
  }
}
</style>
