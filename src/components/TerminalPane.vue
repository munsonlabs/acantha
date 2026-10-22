<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSlidingPill, useTabDrag, useTabScroll } from '@/composables/tabs'
import { openMenu } from '@/composables/useContextMenu'
import { ask } from '@/composables/useDialog'
import type { TerminalSession } from '@/composables/terminals'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import TerminalView from './TerminalView.vue'

defineProps<{ visible: boolean }>()
const { sessions, tabs, partnerOf, activeKey, add, split, close, move, toggle } = useWorkspace().terminals
const strip = ref<HTMLElement>()

const pill = useSlidingPill(strip, () => [activeKey.value, tabs.value.map((s) => `${s.key}:${s.name ?? s.title}:${!!partnerOf(s.key)}`)])
const { dragging, onPointerDown } = useTabDrag(strip, move)
useTabScroll(strip, () => activeKey.value)

/** Terminals render in creation order, so reordering tabs never moves (and disturbs) a live terminal. */
const views = computed(() => [...sessions.value].sort((a, b) => a.key - b.key))

function onTabDown(e: PointerEvent, key: number, index: number) {
  if (e.button !== 0) return
  activeKey.value = key
  onPointerDown(e, index)
}

/** A name you gave a tab as it is; the shell's titles numbered where they'd otherwise match, like "zsh" and "zsh 2". */
const label = (i: number) => {
  const s = tabs.value[i]
  if (s.name) return s.name
  const n = tabs.value.slice(0, i).filter((o) => !o.name && o.title === s.title).length
  return n ? `${s.title} ${n + 1}` : s.title
}

/** A terminal shows while its tab is the active one, its own or the one it's split beside. */
const shown = (s: TerminalSession) => s.key === activeKey.value || s.pane === activeKey.value
const owner = computed(() => tabs.value.find((s) => s.key === activeKey.value))
const partner = computed(() => (activeKey.value == null ? undefined : partnerOf(activeKey.value)))
const ratio = computed(() => owner.value?.ratio ?? 0.5)

/** Where each terminal sits: the whole width, or its side of a split. */
function placement(s: TerminalSession) {
  if (!partner.value) return {}
  if (s.key === activeKey.value) return { right: `${(1 - ratio.value) * 100}%` }
  if (s.pane === activeKey.value) return { left: `${ratio.value * 100}%` }
  return {}
}

const body = ref<HTMLElement>()
/** Drags the line between split terminals; they refit once it's let go, like the panel gutters. */
function startDrag(e: MouseEvent) {
  const box = body.value!.getBoundingClientRect()
  const move = (ev: MouseEvent) => {
    if (owner.value) owner.value.ratio = Math.min(Math.max((ev.clientX - box.left) / box.width, 0.2), 0.8)
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.classList.remove('resizing')
    window.dispatchEvent(new Event('panel-resize-end'))
  }
  document.body.classList.add('resizing')
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  e.preventDefault()
}

/** Names a tab, so you can tell your terminals apart. Left empty, it goes back to following the shell. */
async function rename(s: TerminalSession) {
  const v = await ask({
    title: 'Rename Terminal',
    message: 'Leave it empty to name it after what’s running, as before.',
    fields: [{ name: 'name', label: 'Name', value: s.name ?? '', placeholder: s.title }],
    confirm: 'Rename',
  })
  if (v) s.name = String(v.name).trim() || undefined
}

const tabMenu = (e: MouseEvent, s: TerminalSession) =>
  openMenu(e, [
    { label: 'Rename…', icon: 'pencil', run: () => rename(s) },
    { label: 'Split Right', icon: 'sidebar', shortcut: '⌘D', disabled: !!partnerOf(s.key), run: () => split(s.key) },
    ...(partnerOf(s.key) ? [{ label: 'Close Split', icon: 'x' as const, run: () => close(partnerOf(s.key)!.key) }] : []),
    'separator',
    { label: 'Close Terminal', icon: 'x', run: () => close(s.key) },
  ])
</script>

<template>
  <section class="pane terminal-pane">
    <header class="pane-header">
      <div ref="strip" class="tabs pilled">
        <span class="tab-pill" :style="pill.style.value" />
        <div
          v-for="(s, i) in tabs"
          :key="s.key"
          class="tab"
          :class="{ active: s.key === activeKey, dragging: dragging === i }"
          :title="s.cwd"
          @pointerdown="onTabDown($event, s.key, i)"
          @auxclick.middle="close(s.key)"
          @dblclick="rename(s)"
          @contextmenu.prevent="tabMenu($event, s)"
        >
          <Icon name="terminal" :size="13" />
          <span>{{ label(i) }}</span>
          <Icon v-if="partnerOf(s.key)" name="sidebar" :size="11" class="split-mark" />
          <button class="tab-close" title="Close Terminal" @mousedown.stop @click.stop="close(s.key)"><Icon name="x" :size="12" /></button>
        </div>
      </div>
      <button class="ghost icon-btn" title="New Terminal (⌃⇧`)" @click="add()"><Icon name="plus" /></button>
      <div class="spacer" />
      <button class="ghost icon-btn" title="Hide Terminal (⌘J)" @click="toggle"><Icon name="sidebar" /></button>
    </header>
    <div ref="body" class="terminal-body">
      <div v-for="s in views" v-show="shown(s)" :key="s.key" class="slot" :class="{ right: s.pane != null }" :style="placement(s)">
        <TerminalView
          :session="s"
          :active="visible && shown(s)"
          :focus="s.pane == null"
          @exit="close(s.key)"
          @title="(t) => (s.title = t)"
          @split="split(s.pane ?? s.key)"
        />
      </div>
      <div v-if="partner" class="split-line" :style="{ left: `${ratio * 100}%` }" @mousedown="startDrag" />
    </div>
  </section>
</template>

<style scoped>
.terminal-pane {
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
.terminal-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.slot {
  position: absolute;
  inset: 0;
}
/* The line between split terminals, with a wider grip than it looks. */
.split-line {
  position: absolute;
  z-index: 3;
  top: 6px;
  bottom: 6px;
  width: 9px;
  margin-left: -4px;
  cursor: col-resize;
}
.split-line::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: var(--border);
}
.split-line:hover::after {
  background: var(--accent);
}
.split-mark {
  color: var(--fg-faint);
}
</style>
