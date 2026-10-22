<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { basename } from '@/lib/format'
import { fileScore, fuzzyPositions, fuzzyScore } from '@/lib/fuzzy'
import { enabledCommands, overlays, runCommand } from '@/composables/commands'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import type { IconName } from '@/lib/icons'

/**
 * One box, three jobs, one at a time: Go to File (⌘P), the Command Palette (⇧⌘P, or > in Go to File) and Check Out
 * Branch. Each lists only its own kind, so the right result is usually the first; commits are searched from the title
 * bar (⌘F).
 */
interface Item {
  key: string
  label: string
  detail?: string
  keys?: string
  icon?: IconName
  file?: string
  /** Letters of the label to highlight, where the query matched. */
  marks?: number[]
  run: () => unknown
}

const { active, openInWorkspace } = useWorkspaces()
const open = overlays.palette
const mode = overlays.paletteMode
const query = ref('')
const index = ref(0)
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()

const LIMIT = 60

/** Typing > at the start of Go to File switches to commands, as in VS Code. */
watch(query, (q) => {
  if (mode.value === 'files' && q.startsWith('>')) {
    mode.value = 'commands'
    query.value = q.slice(1).trimStart()
  }
})

/** The best matches for the query, by `score`, with the label's matched letters marked. */
function rank<T extends Item>(all: T[], score: (item: T) => number, q: string) {
  return all
    .map((item) => ({ item, s: score(item) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, LIMIT)
    .map((r) => ({ ...r.item, marks: fuzzyPositions(q, r.item.label) ?? undefined }))
}

function fileItem(path: string, line?: number): Item {
  const ws = active.value!
  const dir = path.slice(0, path.lastIndexOf('/') + 1)
  return {
    key: `f:${path}`,
    label: basename(path),
    detail: dir.replace(/\/$/, ''),
    file: path,
    run: () => {
      ws.browse(ws.files.rev.value)
      return ws.files.open(path, undefined, undefined, line)
    },
  }
}

/** Go to File: the files you've had open, most recent first, until you type; then every file, its name first. */
const files = computed<Item[]>(() => {
  const ws = active.value
  if (!ws?.repo.repo.value) return []
  // `name:42` opens it at line 42.
  const m = query.value.trim().match(/^(.*?)(?::(\d+))?$/)!
  const q = m[1]
  const line = m[2] ? Number(m[2]) : undefined
  if (!q) {
    const recent = [...ws.files.openFiles.value].reverse().filter((f) => f.rev === null)
    return [...new Set(recent.map((f) => f.path))].slice(0, LIMIT).map((p) => fileItem(p))
  }
  return rank(
    ws.files.list.value.map((p) => fileItem(p, line)),
    (item) => fileScore(q, item.file!),
    q,
  )
})

/** The commands that are on, and your other recent repositories. */
const commands = computed<Item[]>(() => {
  const ws = active.value
  const all: Item[] = enabledCommands().map((c) => ({
    key: `cmd:${c.id}`,
    label: c.label,
    keys: c.keys,
    icon: 'chevron',
    run: () => runCommand(c.id),
  }))
  for (const path of prefs.recents.value)
    if (path !== ws?.repo.repo.value)
      all.push({
        key: `repo:${path}`,
        label: basename(path),
        detail: path.replace(/^\/Users\/[^/]+/, '~'),
        icon: 'folder',
        run: () => openInWorkspace(path),
      })
  const q = query.value.trim()
  if (!q) return all.slice(0, LIMIT)
  return rank(all, (item) => Math.max(fuzzyScore(q, item.label), fuzzyScore(q, item.detail ?? '') - 4), q)
})

/** Check Out Branch: local branches, then remote ones (when they're shown), the one checked out left out. */
const branches = computed<Item[]>(() => {
  const ws = active.value
  const log = ws?.repo.log.value
  if (!ws || !log) return []
  const all: Item[] = []
  for (const r of log.refs) {
    if (r.kind === 'branch' && r.name !== log.headBranch)
      all.push({ key: `b:${r.name}`, label: r.name, icon: 'branch', run: () => ws.menus.checkoutBranch(r.name) })
    if (r.kind === 'remote' && r.name !== 'HEAD' && ws.repo.showRemotes.value)
      all.push({
        key: `r:${r.remote}/${r.name}`,
        label: `${r.remote}/${r.name}`,
        detail: 'remote',
        icon: 'cloud',
        run: () => ws.menus.checkoutRemoteBranch(r.remote!, r.name),
      })
  }
  const q = query.value.trim()
  return q ? rank(all, (item) => fuzzyScore(q, item.label), q) : all.slice(0, LIMIT)
})

const results = computed(() => (mode.value === 'files' ? files.value : mode.value === 'branches' ? branches.value : commands.value))

const PLACEHOLDER = {
  files: 'Go to file (name, or name:line) · type > for commands',
  commands: 'Run a command, or open a recent repository',
  branches: 'Check out a branch',
}
const EMPTY = computed(() =>
  mode.value === 'files'
    ? query.value.trim()
      ? 'No file matches'
      : 'Type to find a file; files you open show here'
    : mode.value === 'branches'
      ? 'No other branches'
      : 'No matches',
)

/** The label in pieces, the matched letters marked. */
function pieces(item: Item) {
  if (!item.marks?.length) return [{ text: item.label, hit: false }]
  const hits = new Set(item.marks)
  const out: { text: string; hit: boolean }[] = []
  for (const [i, ch] of [...item.label].entries()) {
    const hit = hits.has(i)
    const last = out.at(-1)
    if (last && last.hit === hit) last.text += ch
    else out.push({ text: ch, hit })
  }
  return out
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  index.value = 0
  // Files are listed lazily, the first time anything needs them.
  const ws = active.value
  if (ws?.repo.repo.value && !ws.files.list.value.length) void ws.files.load()
  await nextTick()
  input.value?.focus()
})
watch([query, mode], () => (index.value = 0))
watch(index, async () => {
  await nextTick()
  list.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
})

function choose(item: Item | undefined) {
  if (!item) return
  open.value = false
  void item.run()
}

function onKey(e: KeyboardEvent) {
  const n = results.value.length
  if (e.key === 'ArrowDown') index.value = (index.value + 1) % Math.max(n, 1)
  else if (e.key === 'ArrowUp') index.value = (index.value - 1 + n) % Math.max(n, 1)
  else if (e.key === 'Enter') choose(results.value[index.value])
  else if (e.key === 'Escape') open.value = false
  // Backspace on an empty box goes back from commands to Go to File, undoing the >.
  else if (e.key === 'Backspace' && !query.value && mode.value === 'commands') mode.value = 'files'
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="overlay top" @mousedown.self="open = false">
      <div class="modal palette" role="dialog" aria-modal="true" :aria-label="PLACEHOLDER[mode]">
        <div class="search">
          <Icon :name="mode === 'files' ? 'files' : mode === 'branches' ? 'branch' : 'chevron'" :size="14" />
          <span v-if="mode === 'commands'" class="prefix">&gt;</span>
          <input ref="input" v-model="query" type="text" :placeholder="PLACEHOLDER[mode]" spellcheck="false" autocomplete="off" @keydown="onKey" />
        </div>
        <div ref="list" class="results">
          <div
            v-for="(item, i) in results"
            :key="item.key"
            class="item"
            :class="{ selected: i === index }"
            @mousemove="index = i"
            @click="choose(item)"
          >
            <FileIcon v-if="item.file" :path="item.file" />
            <Icon v-else :name="item.icon ?? 'chevron'" :size="14" class="kind" />
            <span class="label"
              ><span v-for="(p, j) in pieces(item)" :key="j" :class="{ hit: p.hit }">{{ p.text }}</span></span
            >
            <span v-if="item.detail" class="detail">{{ item.detail }}</span>
            <kbd v-if="item.keys">{{ item.keys }}</kbd>
          </div>
          <p v-if="!results.length" class="none">{{ EMPTY }}</p>
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
.palette {
  display: flex;
  flex-direction: column;
  width: min(640px, calc(100vw - 48px));
  max-height: 60vh;
}
.search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-faint);
}
.search input {
  flex: 1;
  height: 46px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fg);
  font-size: 14px;
  outline: none;
}
.results {
  overflow: auto;
  padding: 6px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 13px;
}
.item.selected {
  background: var(--pill);
}
.kind {
  color: var(--fg-faint);
}
.label {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.hit {
  color: var(--accent);
  font-weight: 600;
}
.prefix {
  margin-right: -4px;
  color: var(--accent);
  font: 600 14px var(--mono);
}
kbd {
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  color: var(--fg-muted);
  font: 11.5px var(--font);
}
.none {
  margin: 16px;
  color: var(--fg-faint);
}
</style>
