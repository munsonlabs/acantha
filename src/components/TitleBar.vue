<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { basename } from '@/lib/format'
import { useWorkspaces, type Workspace } from '@/composables/workspace'
import { openMenu, type MenuEntry } from '@/composables/useContextMenu'
import { folderOpenItems } from '@/composables/openers'
import { prefs } from '@/composables/prefs'
import { freshTabColor, TAB_COLORS, tabColor } from '@/lib/tabColors'
import { useSlidingPill, useTabDrag } from '@/composables/tabs'
import Icon from './Icon.vue'

const { workspaces, activeId, active, activate, addWorkspace, closeWorkspace, closeOtherWorkspaces, moveWorkspace } = useWorkspaces()
const input = ref<HTMLInputElement>()
const strip = ref<HTMLElement>()

const search = computed(() => active.value?.search ?? null)
const query = computed({
  get: () => search.value?.query.value ?? '',
  set: (v: string) => {
    if (search.value) search.value.query.value = v
  },
})

const label = (ws: Workspace) => (ws.repo.repo.value ? basename(ws.repo.repo.value) : 'New Tab')

const pill = useSlidingPill(strip, () => [activeId.value, workspaces.value.map((w) => `${w.id}:${label(w)}:${w.repo.log.value?.headBranch ?? ''}`)])
const { dragging, onPointerDown } = useTabDrag(strip, moveWorkspace)

function onTabDown(e: PointerEvent, ws: Workspace, index: number) {
  if (e.button !== 0) return
  activate(ws.id)
  onPointerDown(e, index)
}

const colorOf = (ws: Workspace) => tabColor(ws.repo.repo.value, prefs.tabColors.value)
const activeColor = computed(() => {
  const ws = workspaces.value.find((w) => w.id === activeId.value)
  return ws ? colorOf(ws) : null
})

// A repository opened for the first time gets a colour no other open tab has, saved so it keeps it.
watch(
  () => workspaces.value.map((w) => w.repo.repo.value),
  (paths) => {
    const picked = { ...prefs.tabColors.value }
    let changed = false
    for (const path of paths) {
      if (!path || picked[path]) continue
      const taken = paths.filter((p) => p && p !== path && picked[p] && picked[p] !== 'none').map((p) => picked[p!])
      picked[path] = freshTabColor(path, taken)
      changed = true
    }
    if (changed) prefs.tabColors.value = picked
  },
  { immediate: true },
)

function pickColor(path: string, color: string | null) {
  prefs.tabColors.value = { ...prefs.tabColors.value, [path]: color ?? 'none' }
}

function tabMenu(e: MouseEvent, ws: Workspace) {
  const path = ws.repo.repo.value
  const items: MenuEntry[] = []
  if (path) {
    items.push(
      {
        swatches: [...TAB_COLORS.map((c) => ({ color: c.value, name: c.name })), { color: null, name: 'No colour' }],
        selected: colorOf(ws),
        pick: (color) => pickColor(path, color),
      },
      'separator',
    )
  }
  items.push({ label: 'New Tab', run: () => addWorkspace() })
  if (path) items.push('separator', ...folderOpenItems(path, () => ws.terminals.add()))
  items.push(
    'separator',
    { label: 'Close Tab', run: () => closeWorkspace(ws.id) },
    { label: 'Close Other Tabs', disabled: workspaces.value.length < 2, run: () => closeOtherWorkspaces(ws.id) },
  )
  openMenu(e, items)
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter') search.value?.step(e.shiftKey ? -1 : 1)
  if (e.key === 'Escape') {
    query.value = ''
    input.value?.blur()
  }
}

defineExpose({ focusSearch: () => input.value?.select() })
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div ref="strip" class="tabs pilled" :class="{ tinted: activeColor }" :style="{ '--tab-color': activeColor ?? undefined }" data-tauri-drag-region>
      <span class="tab-pill" :style="pill.style.value" />
      <div
        v-for="(ws, i) in workspaces"
        :key="ws.id"
        class="tab"
        :class="{ active: ws.id === activeId, dragging: dragging === i }"
        :title="ws.repo.repo.value ?? undefined"
        @pointerdown="onTabDown($event, ws, i)"
        @auxclick.middle="closeWorkspace(ws.id)"
        @contextmenu.prevent="tabMenu($event, ws)"
      >
        <span v-if="colorOf(ws)" class="dot" :style="{ background: colorOf(ws)! }" />
        <Icon v-else :name="ws.repo.repo.value ? 'history' : 'folder'" :size="13" />
        <span class="name">{{ label(ws) }}</span>
        <span v-if="ws.repo.log.value?.headBranch" class="branch">· {{ ws.repo.log.value.headBranch }}</span>
        <span
          v-if="ws.status.status.value?.behind"
          class="behind"
          :title="`${ws.status.status.value.behind} new commit${ws.status.status.value.behind === 1 ? '' : 's'} on ${ws.status.status.value.upstream} to pull`"
          >↓{{ ws.status.status.value.behind }}</span
        >
        <button class="tab-close" title="Close Tab (⌘W)" @mousedown.stop @click.stop="closeWorkspace(ws.id)"><Icon name="x" :size="12" /></button>
      </div>
      <button class="ghost icon-btn" title="New Tab (⌘T)" @click="addWorkspace()"><Icon name="plus" /></button>
    </div>
    <label v-if="active?.repo.repo.value" class="search">
      <Icon name="search" :size="13" />
      <input ref="input" v-model="query" type="text" placeholder="Search commits (⌘F)" spellcheck="false" autocomplete="off" @keydown="onSearchKey" />
      <span v-if="query" class="count">{{ search!.matches.value.length ? `${search!.index.value + 1}/${search!.matches.value.length}` : '0' }}</span>
    </label>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 40px;
  /* Room for the macOS traffic lights. */
  padding: 0 10px 0 84px;
}
.tabs {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
/* The active tab's highlight takes on its repository's colour. */
.tabs.tinted .tab-pill {
  background: color-mix(in oklab, var(--tab-color) 18%, var(--pill));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tab-color) 30%, transparent);
}
.dot {
  width: 8px;
  height: 8px;
  flex: none;
  margin: 0 2px;
  border-radius: 50%;
}
.tab .name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab .branch {
  color: var(--fg-muted);
}
.behind {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
}
.search {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  width: 240px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--fg-muted);
}
.search:focus-within {
  border-color: var(--ring);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fg);
  font-size: 12px;
  outline: none;
}
.count {
  font: 11px var(--mono);
}
</style>
