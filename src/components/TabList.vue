<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { basename } from '@/lib/format'
import { tabColor } from '@/lib/tabColors'
import { overlays } from '@/composables/commands'
import { prefs } from '@/composables/prefs'
import { lastUsed, pathOf, useWorkspaces, type Workspace } from '@/composables/workspace'
import Icon from './Icon.vue'

/**
 * Every tab in a list to search, for when there are too many to see in the bar: most recently used first, sleeping ones
 * marked. Opened from the ▾ at the end of the tabs, or the command palette.
 */
const { workspaces, activeId, activate, closeWorkspace } = useWorkspaces()
const open = overlays.tabList
const query = ref('')
const index = ref(0)
const input = ref<HTMLInputElement>()

const name = (ws: Workspace) => {
  const path = pathOf(ws)
  return path ? (prefs.tabNames.value[path] ?? basename(path)) : 'New Tab'
}
const home = (path: string | null) => path?.replace(/^\/Users\/[^/]+/, '~') ?? ''

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const all = [...workspaces.value].sort((a, b) => (lastUsed.get(b.id) ?? 0) - (lastUsed.get(a.id) ?? 0))
  return q ? all.filter((ws) => `${name(ws)} ${pathOf(ws) ?? ''}`.toLowerCase().includes(q)) : all
})

watch(open, async (o) => {
  if (!o) return
  query.value = ''
  // The one before this tab, so ↵ straight away flips back to it.
  index.value = shown.value.length > 1 ? 1 : 0
  await nextTick()
  input.value?.focus()
})
watch(query, () => (index.value = 0))

function choose(ws: Workspace | undefined) {
  if (!ws) return
  open.value = false
  activate(ws.id)
}

function onKey(e: KeyboardEvent) {
  const n = shown.value.length
  if (e.key === 'ArrowDown') index.value = (index.value + 1) % Math.max(n, 1)
  else if (e.key === 'ArrowUp') index.value = (index.value - 1 + n) % Math.max(n, 1)
  else if (e.key === 'Enter') choose(shown.value[index.value])
  else if (e.key === 'Escape') open.value = false
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="overlay top" @mousedown.self="open = false">
      <div class="modal tab-list" role="dialog" aria-modal="true" aria-label="All tabs" @keydown="onKey">
        <div class="search">
          <Icon name="search" :size="13" />
          <input ref="input" v-model="query" type="text" placeholder="Find a tab" spellcheck="false" autocomplete="off" />
          <span class="count">{{ workspaces.length }} tabs</span>
        </div>
        <div class="results">
          <div
            v-for="(ws, i) in shown"
            :key="ws.id"
            class="item"
            :class="{ selected: i === index, current: ws.id === activeId, asleep: !!ws.sleeping.value }"
            :title="pathOf(ws) ?? undefined"
            @mousemove="index = i"
            @click="choose(ws)"
          >
            <span class="dot" :style="{ background: tabColor(pathOf(ws), prefs.tabColors.value) ?? 'var(--fg-faint)' }" />
            <span class="label">{{ name(ws) }}</span>
            <span v-if="ws.repo.log.value?.headBranch" class="branch">{{ ws.repo.log.value.headBranch }}</span>
            <span class="detail">{{ home(pathOf(ws)) }}</span>
            <span v-if="ws.sleeping.value" class="pill" title="Asleep: it opens again when you pick it"><Icon name="moon" :size="10" /> asleep</span>
            <button class="ghost icon-btn" title="Close tab" @click.stop="closeWorkspace(ws.id)"><Icon name="x" :size="12" /></button>
          </div>
          <p v-if="!shown.length" class="none">No tab matches.</p>
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
.tab-list {
  display: flex;
  flex-direction: column;
  width: min(600px, calc(100vw - 48px));
  max-height: 64vh;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-faint);
}
.search input {
  flex: 1;
  border: none;
  background: none;
  font-size: 13px;
  outline: none;
}
.count {
  font-size: 11px;
}
.results {
  overflow: auto;
  padding: 6px;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 4px 0 10px;
  border-radius: 8px;
  cursor: default;
}
.item.selected {
  background: var(--hover);
}
.item.current .label {
  color: var(--accent);
}
.item.asleep .label,
.item.asleep .dot {
  opacity: 0.55;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.label {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch {
  flex: none;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10.5px;
}
.icon-btn {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--fg-faint);
  opacity: 0;
}
.item.selected .icon-btn,
.item:hover .icon-btn {
  opacity: 1;
}
.none {
  margin: 8px 10px 12px;
  color: var(--fg-faint);
  font-size: 12.5px;
}
</style>
