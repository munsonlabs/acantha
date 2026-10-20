<script setup lang="ts">
import { computed, ref } from 'vue'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { parseLines } from '@/lib/todos'
import type { PanelTab } from '@/composables/panel'
import { prefs } from '@/composables/prefs'
import { promptSlackLink } from '@/composables/slackLinks'
import { useSlidingPill, useTabDrag, useTabScroll } from '@/composables/tabs'
import { openMenu } from '@/composables/useContextMenu'
import { ask } from '@/composables/useDialog'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import SlackView from './SlackView.vue'
import NotesView from './NotesView.vue'
import TodoList from './TodoList.vue'

/** The panel's tabs: Slack messages and canvases, and to-do lists. docked: under the terminal; otherwise over the graph. */
const props = defineProps<{ docked?: boolean }>()
const ws = useWorkspace()
const { tabs, active, expanded, activate, addTodos, addNotes, close, move, rename } = ws.panel
const strip = ref<HTMLElement>()
const slackView = ref<InstanceType<typeof SlackView>>()

const label = (t: PanelTab) => {
  if (t.kind === 'slack') return t.title ?? 'Slack'
  if (t.kind === 'notes') return t.title
  const left = t.items.filter((i) => !i.done).length
  return left ? `${t.title} (${left})` : t.title
}

const pill = useSlidingPill(strip, () => [active.value?.id, tabs.value.map((t) => `${t.id}:${label(t)}`)])
const { dragging, onPointerDown } = useTabDrag(strip, move)
useTabScroll(strip, () => active.value?.id)

function onTabDown(e: PointerEvent, t: PanelTab, index: number) {
  if (e.button !== 0) return
  activate(t.id)
  onPointerDown(e, index)
}

async function newListFromClipboard() {
  const items = parseLines((await readText().catch(() => '')) ?? '')
  if (!items.length) return showToast('Nothing on the clipboard to make a list from', 'error')
  addTodos('To-dos', items)
}

function newTab(e: MouseEvent) {
  openMenu(e, [
    { label: 'Slack Message or Canvas…', icon: 'message', shortcut: '⇧⌘L', run: () => promptSlackLink(ws) },
    'separator',
    { label: 'To-do List', icon: 'check', run: () => addTodos('To-dos') },
    { label: 'Notes', icon: 'pencil', run: () => addNotes() },
    { label: 'To-do List from Clipboard', icon: 'copy', run: newListFromClipboard },
  ])
}

async function renameTab(t: PanelTab) {
  const values = await ask({
    title: 'Rename Tab',
    fields: [{ name: 'title', label: 'Name', value: t.kind === 'slack' ? (t.title ?? '') : t.title, required: true }],
    confirm: 'Rename',
  })
  if (values) rename(t.id, String(values.title).trim())
}

function tabMenu(e: MouseEvent, t: PanelTab) {
  openMenu(e, [
    { label: 'Rename…', icon: 'pencil', run: () => renameTab(t) },
    ...(t.kind === 'slack' ? [{ label: 'Open in Slack', icon: 'external' as const, run: () => openUrl(t.url) }] : []),
    'separator',
    { label: 'Close Tab', icon: 'x', run: () => close(t.id) },
  ])
}

const current = computed(() => active.value)
const expand = () => (expanded.value = true)
function dock() {
  expanded.value = false
  prefs.panelOpen.value = true
}
const hide = () => (prefs.panelOpen.value = false)
</script>

<template>
  <section class="side-panel" :class="{ pane: props.docked, docked: props.docked }">
    <header class="pane-header">
      <div ref="strip" class="tabs pilled">
        <span class="tab-pill" :style="pill.style.value" />
        <div
          v-for="(t, i) in tabs"
          :key="t.id"
          class="tab"
          :class="{ active: t.id === current?.id, dragging: dragging === i }"
          :title="t.kind === 'slack' ? t.url : t.title"
          @pointerdown="onTabDown($event, t, i)"
          @dblclick="renameTab(t)"
          @auxclick.middle="close(t.id)"
          @contextmenu.prevent="tabMenu($event, t)"
        >
          <Icon :name="t.kind === 'slack' ? 'message' : t.kind === 'notes' ? 'pencil' : 'check'" :size="13" />
          <span class="label">{{ label(t) }}</span>
          <button class="tab-close" title="Close Tab" @mousedown.stop @click.stop="close(t.id)"><Icon name="x" :size="12" /></button>
        </div>
      </div>
      <button class="ghost icon-btn" title="New tab: Slack or a to-do list" @click="newTab"><Icon name="plus" /></button>
      <div class="spacer" />
      <template v-if="current?.kind === 'slack'">
        <button class="ghost icon-btn" title="Refresh" :disabled="slackView?.loading" @click="slackView?.refresh()"><Icon name="refresh" /></button>
        <button class="ghost icon-btn" title="Open in Slack" @click="openUrl(current.url)"><Icon name="external" /></button>
      </template>
      <button v-if="props.docked && tabs.length" class="ghost icon-btn" title="Expand over the graph" @click="expand">
        <Icon name="maximize" />
      </button>
      <button v-if="!props.docked" class="ghost icon-btn" title="Back under the terminal (Esc)" @click="dock"><Icon name="minimize" /></button>
      <button v-if="props.docked" class="ghost icon-btn" title="Hide the panel" @click="hide"><Icon name="minus" /></button>
    </header>

    <div class="body">
      <div v-if="!current" class="empty">
        <Icon name="message" :size="22" />
        <p>Copy a Slack message or canvas link, or a bulleted list, then press <kbd>⌘V</kbd> anywhere outside a text box. A list becomes to-dos.</p>
        <div class="actions">
          <button class="ghost" @click="promptSlackLink(ws)"><Icon name="message" :size="12" /> Slack link… <kbd>⇧⌘L</kbd></button>
          <button class="ghost" @click="addTodos('To-dos')"><Icon name="check" :size="12" /> To-do list</button>
          <button class="ghost" @click="addNotes()"><Icon name="pencil" :size="12" /> Notes</button>
        </div>
      </div>
      <SlackView
        v-else-if="current.kind === 'slack'"
        :key="current.id"
        ref="slackView"
        :tab-id="current.id"
        :url="current.url"
        :docked="props.docked"
      />
      <NotesView v-else-if="current.kind === 'notes'" :key="current.id" :tab-id="current.id" :text="current.text" />
      <TodoList v-else :key="current.id" :tab-id="current.id" :items="current.items" />
    </div>
  </section>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
}
.tabs {
  position: relative;
  display: flex;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.label {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.body > * {
  flex: 1;
  min-height: 0;
}
.empty {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 20px;
  color: var(--fg-faint);
  font-size: 12px;
  text-align: center;
}
.empty p {
  max-width: 300px;
  margin: 0;
}
.actions {
  display: flex;
  gap: 6px;
}
.actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
