<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { basename } from '@/lib/format'
import { pathOf, useWorkspaces, type Workspace } from '@/composables/workspace'
import { overlays } from '@/composables/commands'
import { openMenu, type MenuEntry, type MenuItem } from '@/composables/useContextMenu'
import { isOn } from '@/features'
import { folderOpenItems } from '@/composables/openers'
import { ask } from '@/composables/useDialog'
import { prefs } from '@/composables/prefs'
import { freshTabColor, TAB_COLORS, tabColor } from '@/lib/tabColors'
import { useSlidingPill, useTabDrag, useTabScroll } from '@/composables/tabs'
import Icon from './Icon.vue'

const {
  workspaces,
  activeId,
  active,
  activate,
  addWorkspace,
  closeWorkspace,
  closeOtherWorkspaces,
  moveWorkspace,
  sleepWorkspace,
  sleepOtherWorkspaces,
} = useWorkspaces()
const input = ref<HTMLInputElement>()
const strip = ref<HTMLElement>()

const search = computed(() => active.value?.search ?? null)
const query = computed({
  get: () => search.value?.query.value ?? '',
  set: (v: string) => {
    if (search.value) search.value.query.value = v
  },
})

const label = (ws: Workspace) => {
  const path = pathOf(ws)
  return path ? (prefs.tabNames.value[path] ?? basename(path)) : 'New Tab'
}

/** Names a repository's tab (kept for next time); left empty, it goes back to the folder's name. */
async function renameTab(ws: Workspace) {
  const path = pathOf(ws)
  if (!path) return
  const v = await ask({
    title: 'Rename Tab',
    message: `Leave it empty to use the folder’s name, ${basename(path)}.`,
    fields: [{ name: 'name', label: 'Name', value: prefs.tabNames.value[path] ?? '', placeholder: basename(path) }],
    confirm: 'Rename',
  })
  if (!v) return
  const names = { ...prefs.tabNames.value }
  const name = String(v.name).trim()
  if (name && name !== basename(path)) names[path] = name
  else delete names[path]
  prefs.tabNames.value = names
}

const pill = useSlidingPill(strip, () => [activeId.value, workspaces.value.map((w) => `${w.id}:${label(w)}:${w.repo.log.value?.headBranch ?? ''}`)])
const { dragging, onPointerDown } = useTabDrag(strip, moveWorkspace)

/** Too many tabs to see at once: the ▾ after them lists them all. */
const overflowing = ref(false)
const fits = new ResizeObserver(() => {
  const el = strip.value
  if (el) overflowing.value = el.scrollWidth > el.clientWidth + 1
})
watch(strip, (el) => el && fits.observe(el), { immediate: true })
watch(
  () => workspaces.value.length,
  async () => {
    await nextTick()
    const el = strip.value
    if (el) overflowing.value = el.scrollWidth > el.clientWidth + 1
  },
)
onBeforeUnmount(() => fits.disconnect())
const crowded = computed(() => overflowing.value || workspaces.value.length > 6)
useTabScroll(strip, () => activeId.value)

function onTabDown(e: PointerEvent, ws: Workspace, index: number) {
  if (e.button !== 0) return
  activate(ws.id)
  onPointerDown(e, index)
}

const colorOf = (ws: Workspace) => tabColor(pathOf(ws), prefs.tabColors.value)
const activeColor = computed(() => {
  const ws = workspaces.value.find((w) => w.id === activeId.value)
  return ws ? colorOf(ws) : null
})

// A repository opened for the first time gets a colour no other open tab has, saved so it keeps it.
watch(
  () => workspaces.value.map((w) => pathOf(w)),
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
  const path = pathOf(ws)
  const items: MenuEntry[] = []
  if (path) {
    items.push(
      { header: basename(path), detail: path.replace(/^\/Users\/[^/]+/, '~') },
      {
        swatches: [...TAB_COLORS.map((c) => ({ color: c.value, name: c.name })), { color: null, name: 'No colour' }],
        selected: colorOf(ws),
        pick: (color) => pickColor(path, color),
      },
      { label: 'Rename Tab…', icon: 'pencil', run: () => renameTab(ws) },
      'separator',
    )
  }
  items.push({ label: 'New Tab', icon: 'plus', shortcut: '⌘T', run: () => addWorkspace() })
  if (path) items.push('separator', ...folderOpenItems(path, () => ws.terminals.add()))
  items.push(
    'separator',
    ...(isOn('tabSleep')
      ? [
          {
            label: 'Put to Sleep',
            icon: 'moon',
            disabled: !ws.repo.repo.value || ws.id === activeId.value,
            run: () => sleepWorkspace(ws.id),
          } satisfies MenuItem,
          {
            label: 'Put Other Tabs to Sleep',
            icon: 'moon',
            disabled: workspaces.value.length < 2,
            run: () => sleepOtherWorkspaces(ws.id),
          } satisfies MenuItem,
          'separator' as const,
        ]
      : []),
    { label: 'Close Tab', icon: 'x', shortcut: '⌘W', run: () => closeWorkspace(ws.id) },
    { label: 'Close Other Tabs', icon: 'x', disabled: workspaces.value.length < 2, run: () => closeOtherWorkspaces(ws.id) },
  )
  openMenu(e, items)
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter') search.value?.step(e.shiftKey ? -1 : 1)
  if (e.key === 'Escape') {
    e.preventDefault()
    query.value = ''
    input.value?.blur()
  }
}

// macOS hides the traffic lights in fullscreen, so the tabs can take their place.
const fullscreen = ref(false)
let stopResize: (() => void) | undefined
onMounted(async () => {
  const win = getCurrentWindow()
  const check = () =>
    win.isFullscreen().then(
      (f) => (fullscreen.value = f),
      () => {},
    )
  check()
  stopResize = await win.onResized(check).catch(() => undefined)
})
onBeforeUnmount(() => stopResize?.())

defineExpose({ focusSearch: () => input.value?.select() })
</script>

<template>
  <header class="titlebar" :class="{ fullscreen }" data-tauri-drag-region>
    <div ref="strip" class="tabs pilled" :class="{ tinted: activeColor }" :style="{ '--tab-color': activeColor ?? undefined }" data-tauri-drag-region>
      <span class="tab-pill" :style="pill.style.value" />
      <div
        v-for="(ws, i) in workspaces"
        :key="ws.id"
        class="tab"
        :class="{ active: ws.id === activeId, dragging: dragging === i, asleep: !!ws.sleeping.value }"
        :title="ws.sleeping.value ? `${ws.sleeping.value} (asleep: click to open)` : (ws.repo.repo.value ?? undefined)"
        @pointerdown="onTabDown($event, ws, i)"
        @auxclick.middle="closeWorkspace(ws.id)"
        @contextmenu.prevent="tabMenu($event, ws)"
        @dblclick="renameTab(ws)"
      >
        <span v-if="colorOf(ws)" class="dot" :style="{ background: colorOf(ws)! }" />
        <Icon v-else :name="pathOf(ws) ? 'history' : 'folder'" :size="13" />
        <span class="name">{{ label(ws) }}</span>
        <Icon v-if="ws.sleeping.value" name="moon" :size="10" class="zz" />
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
    <button v-if="crowded" class="ghost icon-btn all-tabs" :title="`All ${workspaces.length} tabs`" @click="overlays.tabList.value = true">
      <Icon name="chevron" :size="12" class="down" />
    </button>
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
.titlebar.fullscreen {
  padding-left: 10px;
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
.tab.asleep .name,
.tab.asleep .dot {
  opacity: 0.5;
}
.zz {
  flex: none;
  color: var(--fg-faint);
}
.all-tabs {
  flex: none;
  margin-left: -8px;
}
.all-tabs .down {
  transform: rotate(90deg);
}
</style>
