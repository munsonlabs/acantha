<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { fileFilterMatcher, parseFileFilter } from '@/lib/fileFilter'
import { shortHash, splitPath } from '@/lib/format'
import type { SearchHit } from '@/lib/git'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { rev, list, preview, load, open } = ws.files
const { query, scope, include, regex, caseSensitive, results, searching, error } = ws.files.search
const { rows } = ws.repo
const input = ref<HTMLInputElement>()
const collapsed = ref(new Set<string>())
const includeInput = ref<HTMLInputElement>()
/** The "files to include" row shows while it's open or has something in it. */
const showInclude = ref(!!include.value)

const SCOPES = [
  { value: 'all', label: 'All', title: 'File names and contents (⇧⌘F)' },
  { value: 'names', label: 'Names', title: 'File names only (⌥⌘F)' },
  { value: 'contents', label: 'Contents', title: 'File contents only' },
] as const

function toggleInclude() {
  showInclude.value = !showInclude.value
  if (showInclude.value) void nextTick(() => includeInput.value?.focus())
  else include.value = ''
}

const NAME_LIMIT = 30

/** The query as a pattern for matching names and marking hits, or null while it isn't a valid one. */
/** Names are quick to search from the first letter; contents need two. */
const minLength = computed(() => (scope.value === 'names' ? 1 : 2))

const pattern = computed(() => {
  const q = query.value
  if (q.trim().length < minLength.value) return null
  try {
    return new RegExp(regex.value ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive.value ? 'g' : 'gi')
  } catch {
    return null
  }
})

const filter = computed(() => fileFilterMatcher(parseFileFilter(include.value)))

const names = computed(() => {
  const re = pattern.value
  if (!re || scope.value === 'contents') return []
  const test = new RegExp(re.source, re.flags.replace('g', ''))
  const found = list.value.filter((p) => test.test(p.split('/').pop()!) && filter.value(p))
  // Names alone get the whole list; beside contents, just the top of it.
  return found.slice(0, scope.value === 'names' ? 500 : NAME_LIMIT)
})

const groups = computed(() => {
  const byFile = new Map<string, SearchHit[]>()
  for (const hit of results.value?.hits ?? []) {
    const hits = byFile.get(hit.path)
    if (hits) hits.push(hit)
    else byFile.set(hit.path, [hit])
  }
  return [...byFile].map(([path, hits]) => ({ path, hits, ...splitPath(path) }))
})

const hitCount = computed(() => results.value?.hits.length ?? 0)

/** A line cut into plain and matched pieces, starting a little before the first match so it shows in a narrow panel. */
function pieces(text: string) {
  const re = pattern.value
  const trimmed = text.replace(/^\s+/, '')
  if (!re) return [{ text: trimmed, hit: false }]
  re.lastIndex = 0
  const first = re.exec(trimmed)?.index ?? 0
  const start = first > 36 ? first - 24 : 0
  const shown = trimmed.slice(start)
  const out: { text: string; hit: boolean }[] = start ? [{ text: '…', hit: false }] : []
  let last = 0
  re.lastIndex = 0
  for (const m of shown.matchAll(re)) {
    if (!m[0]) break
    if (m.index > last) out.push({ text: shown.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < shown.length) out.push({ text: shown.slice(last), hit: false })
  return out
}

function toggle(path: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(path)) next.add(path)
  collapsed.value = next
}

const isOpen = (hit: SearchHit) => preview.value?.path === hit.path && preview.value.line === hit.line && preview.value.rev === rev.value
const openHit = (hit: SearchHit) => open(hit.path, 'preview', rev.value, hit.line)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    const first = groups.value[0]?.hits[0]
    if (scope.value !== 'names' && first) void openHit(first)
    else if (names.value[0]) void open(names.value[0])
  } else if (e.key === 'Escape' && query.value) {
    e.stopPropagation()
    query.value = ''
  }
}

const subject = computed(() => rows.value.find((c) => c.hash === rev.value)?.subject)

function focusInput() {
  // Start from whatever's selected on the page, like ⇧⌘F in an editor.
  const picked = window.getSelection()?.toString().trim()
  if (picked && picked.length < 120 && !picked.includes('\n')) query.value = picked
  void nextTick(() => input.value?.select())
}

watch(ws.ui.focusFileSearch, focusInput)
onMounted(() => {
  if (!list.value.length) void load()
  focusInput()
})
</script>

<template>
  <div class="search-panel">
    <header class="pane-header">
      <span v-if="rev" class="at" :title="subject">
        <Icon name="history" :size="13" />
        <span class="hash">{{ shortHash(rev) }}</span>
        <span class="subject">{{ subject }}</span>
      </span>
      <span v-else class="at"><Icon name="search" :size="13" /> Search working tree</span>
    </header>
    <div class="box">
      <Icon name="search" :size="12" />
      <input
        ref="input"
        v-model="query"
        type="text"
        :placeholder="scope === 'names' ? 'Search file names' : scope === 'contents' ? 'Search file contents' : 'Search file names and contents'"
        spellcheck="false"
        autocomplete="off"
        @keydown="onKey"
      />
      <button class="ghost opt" :class="{ on: caseSensitive }" title="Match case" @click="caseSensitive = !caseSensitive">Aa</button>
      <button class="ghost opt" :class="{ on: regex }" title="Regular expression" @click="regex = !regex">.*</button>
      <button class="ghost opt" :class="{ on: showInclude || include }" title="Limit to file types or folders" @click="toggleInclude">
        <Icon name="filter" :size="12" />
      </button>
    </div>
    <div v-if="showInclude" class="box include">
      <span class="include-label">Files</span>
      <input
        ref="includeInput"
        v-model="include"
        type="text"
        placeholder="ts, vue, src/, !*.test.ts"
        title="Extensions, patterns or folders, separated by commas or spaces. ! leaves matches out."
        spellcheck="false"
        autocomplete="off"
        @keydown.esc.stop="toggleInclude"
      />
    </div>
    <div class="scopes">
      <button v-for="s in SCOPES" :key="s.value" class="ghost" :class="{ on: scope === s.value }" :title="s.title" @click="scope = s.value">
        {{ s.label }}
      </button>
    </div>

    <div class="results">
      <p v-if="query.trim().length < minLength" class="note">
        {{ minLength === 1 ? 'Type part of a file name.' : 'Type at least two characters.' }} Enter opens the first result.
      </p>
      <p v-else-if="error" class="note error">{{ error }}</p>
      <template v-else>
        <template v-if="names.length">
          <h4 v-if="scope !== 'names'">File names</h4>
          <div
            v-for="path in names"
            :key="`n:${path}`"
            class="row name-row"
            :class="{ active: preview?.path === path && !preview?.line }"
            :title="path"
            @click="open(path)"
          >
            <FileIcon :path="path" />
            <span class="file">{{ splitPath(path).name }}</span>
            <span class="dir">{{ splitPath(path).dir }}</span>
          </div>
        </template>

        <h4 v-if="groups.length">
          In files
          <span class="summary">
            {{ hitCount }}{{ results?.truncated ? '+' : '' }} {{ hitCount === 1 ? 'line' : 'lines' }} in {{ groups.length }}
            {{ groups.length === 1 ? 'file' : 'files' }}
          </span>
        </h4>
        <template v-for="g in groups" :key="g.path">
          <div class="row file-row" :title="g.path" @click="toggle(g.path)">
            <Icon name="chevron" :size="11" class="chev" :class="{ open: !collapsed.has(g.path) }" />
            <FileIcon :path="g.path" />
            <span class="file">{{ g.name }}</span>
            <span class="dir">{{ g.dir }}</span>
            <span class="count">{{ g.hits.length }}</span>
          </div>
          <template v-if="!collapsed.has(g.path)">
            <div v-for="h in g.hits" :key="h.line" class="row hit" :class="{ active: isOpen(h) }" @click="openHit(h)">
              <span class="ln">{{ h.line }}</span>
              <span class="text"
                ><span v-for="(p, i) in pieces(h.text)" :key="i" :class="{ mark: p.hit }">{{ p.text }}</span></span
              >
            </div>
          </template>
        </template>
        <p v-if="results?.truncated" class="note">Showing the first {{ hitCount }} lines. Narrow the search to see the rest.</p>
        <p v-if="searching && !results" class="note">Searching…</p>
        <p v-else-if="results && !groups.length && !names.length" class="note">Nothing found.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
}
.at {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 6px;
  font-weight: 600;
  white-space: nowrap;
}
.hash {
  font: 11.5px var(--mono);
}
.subject {
  overflow: hidden;
  color: var(--fg-muted);
  font-weight: 400;
  text-overflow: ellipsis;
}
.box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 8px 4px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--fg-faint);
}
.box:focus-within {
  border-color: var(--ring);
}
.box input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
}
.opt {
  flex: none;
  height: 20px;
  padding: 0 5px;
  border-radius: 5px;
  color: var(--fg-faint);
  font: 600 11px var(--mono);
}
.opt.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.include {
  margin-top: 0;
}
.include-label {
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
}
.scopes {
  display: flex;
  gap: 2px;
  margin: 2px 8px 4px;
  padding: 2px;
  border-radius: 7px;
  background: var(--input-bg);
}
.scopes button {
  flex: 1 1 0;
  height: 22px;
  border-radius: 5px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.scopes button.on {
  background: var(--pill);
  color: var(--fg);
}
.results {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 6px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
h4 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 10px 8px 4px;
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
}
.summary {
  color: var(--fg-faint);
  font-weight: 400;
}
.row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12.5px;
  white-space: nowrap;
  cursor: default;
}
.row:hover {
  background: var(--hover);
}
.row.active {
  background: var(--selected);
}
.file {
  flex: none;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dir {
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11.5px;
  text-overflow: ellipsis;
}
.count {
  margin-left: auto;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10px;
}
.chev {
  flex: none;
  color: var(--fg-faint);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.hit {
  gap: 8px;
  padding-left: 24px;
  font: 11.5px/22px var(--mono);
}
.ln {
  flex: none;
  min-width: 24px;
  color: var(--fg-faint);
  text-align: right;
}
.text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark {
  border-radius: 3px;
  background: var(--match);
  box-shadow: 0 0 0 1px var(--border-strong);
  color: var(--fg);
}
.note {
  margin: 12px 8px;
  color: var(--fg-faint);
  font-size: 12px;
}
.note.error {
  color: var(--danger, #e5534b);
  white-space: pre-wrap;
}
</style>
