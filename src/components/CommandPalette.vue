<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { UNCOMMITTED } from '@/lib/git'
import { basename, shortHash } from '@/lib/format'
import { fuzzyScore } from '@/lib/fuzzy'
import { commands, overlays, runCommand } from '@/composables/commands'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import type { IconName } from '@/lib/icons'

interface Item {
  key: string
  label: string
  detail?: string
  group: 'Command' | 'Branch' | 'File' | 'Commit' | 'Repository'
  keys?: string
  icon?: IconName
  file?: string
  run: () => unknown
}

const { active, openInWorkspace } = useWorkspaces()
const open = overlays.palette
const query = ref('')
const index = ref(0)
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()

const LIMIT = 60

const items = computed<Item[]>(() => {
  const ws = active.value
  const out: Item[] = commands.map((c) => ({
    key: `cmd:${c.id}`,
    label: c.label,
    group: 'Command',
    keys: c.keys,
    icon: 'chevron',
    run: () => runCommand(c.id),
  }))
  if (ws?.repo.repo.value) {
    const log = ws.repo.log.value
    for (const r of log?.refs ?? []) {
      if (r.kind === 'branch')
        out.push({
          key: `b:${r.name}`,
          label: r.name,
          detail: 'Check out branch',
          group: 'Branch',
          icon: 'branch',
          run: () => ws.menus.checkoutBranch(r.name),
        })
      if (r.kind === 'remote' && ws.repo.showRemotes.value)
        out.push({
          key: `r:${r.remote}/${r.name}`,
          label: `${r.remote}/${r.name}`,
          detail: 'Check out remote branch',
          group: 'Branch',
          icon: 'cloud',
          run: () => ws.menus.checkoutRemoteBranch(r.remote!, r.name),
        })
    }
    for (const path of ws.files.list.value)
      out.push({
        key: `f:${path}`,
        label: basename(path),
        detail: path,
        group: 'File',
        file: path,
        run: () => {
          ws.browse(ws.files.rev.value)
          return ws.files.open(path)
        },
      })
    for (const c of ws.repo.rows.value)
      if (c.hash !== UNCOMMITTED && !c.stash)
        out.push({
          key: `c:${c.hash}`,
          label: c.subject,
          detail: `${shortHash(c.hash)} · ${c.author}`,
          group: 'Commit',
          icon: 'history',
          run: () => {
            void ws.files.closePreview()
            return ws.details.select(c.hash)
          },
        })
  }
  for (const path of prefs.recents.value)
    if (path !== ws?.repo.repo.value)
      out.push({
        key: `repo:${path}`,
        label: basename(path),
        detail: path.replace(/^\/Users\/[^/]+/, '~'),
        group: 'Repository',
        icon: 'folder',
        run: () => openInWorkspace(path),
      })
  return out
})

/** With no query: the commands and recent repositories. Otherwise everything, best matches first. */
const results = computed(() => {
  const q = query.value.trim()
  if (!q) return items.value.filter((i) => i.group === 'Command' || i.group === 'Repository').slice(0, LIMIT)
  return items.value
    .map((item) => ({ item, score: Math.max(fuzzyScore(q, item.label), fuzzyScore(q, item.detail ?? '') - 4) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map((r) => r.item)
})

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
watch(query, () => (index.value = 0))
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
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="overlay top" @mousedown.self="open = false">
      <div class="modal palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="search">
          <Icon name="search" :size="14" />
          <input
            ref="input"
            v-model="query"
            type="text"
            placeholder="Search commands, branches, files and commits"
            spellcheck="false"
            autocomplete="off"
            @keydown="onKey"
          />
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
            <span class="label">{{ item.label }}</span>
            <span v-if="item.detail" class="detail">{{ item.detail }}</span>
            <kbd v-if="item.keys">{{ item.keys }}</kbd>
            <span v-else class="group">{{ item.group }}</span>
          </div>
          <p v-if="!results.length" class="none">No matches</p>
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
.group {
  margin-left: auto;
  color: var(--fg-faint);
  font-size: 11px;
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
