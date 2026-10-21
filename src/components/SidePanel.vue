<script setup lang="ts">
import { computed, ref } from 'vue'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { git } from '@/lib/git'
import { runningRuns } from '@/lib/github'
import type { IconName } from '@/lib/icons'
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
import ScriptsView from './ScriptsView.vue'
import TodoList from './TodoList.vue'
import CompareView from './CompareView.vue'
import GitHubView from './GitHubView.vue'
import MarkdownPanel from './MarkdownPanel.vue'

/** The panel's tabs: Slack messages and canvases, and to-do lists. docked: under the terminal; otherwise over the graph. */
const props = defineProps<{ docked?: boolean }>()
const ws = useWorkspace()
const { tabs, active, expanded, activate, addTodos, addNotes, addScripts, addCompare, addGithub, addMarkdown, addReadme, close, move, rename } =
  ws.panel
const strip = ref<HTMLElement>()
const slackView = ref<InstanceType<typeof SlackView>>()

const label = (t: PanelTab) => {
  if (t.kind === 'slack') return t.title ?? 'Slack'
  if (t.kind === 'github') {
    const n = runningRuns.value[ws.repo.repo.value ?? ''] ?? 0
    return n ? `${t.title} (${n})` : t.title
  }
  if (t.kind !== 'todos') return t.title
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

const ICONS: Record<PanelTab['kind'], IconName> = {
  slack: 'message',
  todos: 'check',
  notes: 'pencil',
  scripts: 'play',
  compare: 'merge',
  github: 'cloud',
  markdown: 'eye',
  readme: 'archive',
}

/** Picks a Markdown file in the repository to preview. */
async function pickMarkdown() {
  if (!ws.files.list.value.length) await ws.files.load()
  const files = ws.files.list.value.filter((f) => /\.(md|markdown|mdx)$/i.test(f) && !f.includes('node_modules/'))
  if (!files.length) return showToast('No Markdown files in this repository', 'error')
  const v = await ask({
    title: 'Preview Markdown',
    fields: [
      {
        name: 'path',
        label: 'File',
        type: 'select',
        value: files.find((f) => /^readme\.md$/i.test(f)) ?? files[0],
        options: files.map((f) => ({ value: f, label: f })),
      },
    ],
    confirm: 'Preview',
  })
  if (v) addMarkdown(v.path)
}

/** Picks a package for its README: one the repository depends on, or any other on npm. */
async function pickPackage() {
  const root = ws.repo.repo.value!
  const manifest = await git.readFile(root, null, 'package.json').catch(() => null)
  let deps: string[] = []
  try {
    const json = manifest?.kind === 'text' ? JSON.parse(manifest.text) : {}
    deps = [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})].sort()
  } catch {
    // Not valid JSON: the name box still works.
  }
  const v = await ask({
    title: 'Package README',
    message: deps.length ? 'One of this repository’s packages, or type any other npm package.' : 'Any npm package, by name.',
    fields: [
      ...(deps.length
        ? [{ name: 'dep', label: 'Package', type: 'select' as const, value: deps[0], options: deps.map((d) => ({ value: d, label: d })) }]
        : []),
      { name: 'other', label: deps.length ? 'Or another package' : 'Package', placeholder: 'e.g. vue, @tauri-apps/api', required: !deps.length },
    ],
    confirm: 'Show README',
  })
  const pkg = v && (String(v.other ?? '').trim() || v.dep)
  if (pkg) addReadme(pkg)
}

function newTab(e: MouseEvent) {
  openMenu(e, [
    { label: 'Slack Message or Canvas…', icon: 'message', shortcut: '⇧⌘L', run: () => promptSlackLink(ws) },
    'separator',
    { label: 'To-do List', icon: 'check', run: () => addTodos('To-dos') },
    { label: 'Notes', icon: 'pencil', run: () => addNotes() },
    { label: 'Scripts', icon: 'play', run: () => addScripts() },
    { label: 'To-do List from Clipboard', icon: 'copy', run: newListFromClipboard },
    'separator',
    { label: 'Compare Branches', icon: 'merge', run: () => addCompare() },
    { label: 'GitHub: Pull Requests & Actions', icon: 'cloud', run: () => addGithub() },
    'separator',
    { label: 'Markdown Preview…', icon: 'eye', run: pickMarkdown },
    { label: 'Package README…', icon: 'archive', run: pickPackage },
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
          <Icon :name="ICONS[t.kind]" :size="13" />
          <span class="label">{{ label(t) }}</span>
          <button class="tab-close" title="Close Tab" @mousedown.stop @click.stop="close(t.id)"><Icon name="x" :size="12" /></button>
        </div>
      </div>
      <button class="ghost icon-btn" title="New tab" @click="newTab"><Icon name="plus" /></button>
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
        <p>
          Or press <span class="plus"><Icon name="plus" :size="11" /></span> above for any other kind of tab.
        </p>
      </div>
      <!-- The GitHub tab stays alive behind the others, so it keeps checking on running Actions for its label. -->
      <KeepAlive include="GitHubView">
        <SlackView
          v-if="current?.kind === 'slack'"
          :key="current.id"
          ref="slackView"
          :tab-id="current.id"
          :url="current.url"
          :docked="props.docked"
        />
        <NotesView v-else-if="current?.kind === 'notes'" :key="current.id" :tab-id="current.id" :text="current.text" />
        <ScriptsView v-else-if="current?.kind === 'scripts'" :key="current.id" />
        <CompareView
          v-else-if="current?.kind === 'compare'"
          :key="current.id"
          :tab-id="current.id"
          :base="current.base"
          :head="current.head"
          :uncommitted="current.uncommitted"
        />
        <GitHubView v-else-if="current?.kind === 'github'" :key="current.id" :tab-id="current.id" />
        <MarkdownPanel v-else-if="current?.kind === 'markdown'" :key="current.id" :path="current.path" />
        <MarkdownPanel v-else-if="current?.kind === 'readme'" :key="current.id" :pkg="current.pkg" />
        <TodoList v-else-if="current?.kind === 'todos'" :key="current.id" :tab-id="current.id" :items="current.items" />
      </KeepAlive>
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
  flex: 1;
  justify-content: center;
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
.plus {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  margin: 0 1px;
  border-radius: 4px;
  background: var(--pill);
  color: var(--fg-muted);
  /* The middle of the text line, not its baseline; a pixel up for the x-height. */
  vertical-align: middle;
  transform: translateY(-1px);
}
.plus :deep(svg) {
  display: block;
}
</style>
