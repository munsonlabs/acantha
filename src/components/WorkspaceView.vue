<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { prefs } from '@/composables/prefs'
import { useContextMenu } from '@/composables/useContextMenu'
import { provideWorkspace, type Workspace } from '@/composables/workspace'
import DiffModal from './DiffModal.vue'
import GraphPane from './GraphPane.vue'
import ConflictResolver from './ConflictResolver.vue'
import RebaseModal from './RebaseModal.vue'
import Sidebar from './Sidebar.vue'
import SidePanel from './SidePanel.vue'
import TerminalPane from './TerminalPane.vue'

const props = defineProps<{ ws: Workspace; visible: boolean }>()
provideWorkspace(props.ws)

const { repo } = props.ws.repo
const { open, sessions } = props.ws.terminals
const { tabs: panelTabs, expanded: panelExpanded } = props.ws.panel
const el = ref<HTMLElement>()
const width = prefs.terminalWidth
const sidebarWidth = prefs.sidebarWidth
const sidebarOpen = prefs.sidebarOpen

/** The terminal is sized as a share of the workspace, worked out in pixels so it keeps its width while sliding. */
const workspaceWidth = ref(0)
const terminalPx = computed(() => Math.max(280, Math.round(workspaceWidth.value * width.value)))
const observer = new ResizeObserver(([entry]) => (workspaceWidth.value = entry.contentRect.width))
onMounted(() => el.value && observer.observe(el.value))
onBeforeUnmount(() => observer.disconnect())

/**
 * Side panels open and close by animating the width of a slot around them, so the graph glides rather than jumps.
 * The transition is only switched on while toggling: resizing a panel or the window should follow the mouse.
 */
const sliding = ref<'sidebar' | 'terminal' | null>(null)
watch(sidebarOpen, () => (sliding.value = 'sidebar'), { flush: 'sync' })

/**
 * The right-hand column holds the terminal with the panel (Slack and to-do tabs) under it; it's open while either
 * is. While the panel is expanded over the graph, it leaves the column.
 */
const panelDocked = computed(() => prefs.panelOpen.value && !(panelExpanded.value && panelTabs.value.length))
const rightOpen = computed(() => (open.value && sessions.value.length > 0) || panelDocked.value)
/** What a closed column has to show when peeked at. */
const rightPeekable = computed(() => sessions.value.length > 0 || (panelTabs.value.length > 0 && !panelExpanded.value))
watch(rightOpen, () => (sliding.value = 'terminal'), { flush: 'sync' })
const doneSliding = (e: TransitionEvent) => e.propertyName === 'width' && (sliding.value = null)

/**
 * Peeking: with a panel closed, resting the pointer on that edge of the window floats it in over the graph, for a quick
 * look or action without pinning it open. It goes again once the pointer leaves, unless something in it still needs you
 * (a field you're typing in, or a menu it opened), in which case a click elsewhere or Escape dismisses it.
 */
type Side = 'sidebar' | 'terminal'
const peek = ref<Side | null>(null)
const leaving = ref(false)
const leftSlot = ref<HTMLElement>()
const rightSlot = ref<HTMLElement>()
const { menu } = useContextMenu()
let enterTimer = 0
let leaveTimer = 0

// The edge counts as part of the peeked panel, so moving back out to it (or never moving in) still closes it.
function edgeEnter(side: Side) {
  clearTimeout(enterTimer)
  if (peek.value === side) return peekEnter()
  enterTimer = window.setTimeout(() => {
    leaving.value = false
    peek.value = side
  }, 120)
}

function edgeLeave() {
  clearTimeout(enterTimer)
  if (peek.value) peekLeave()
}

function peekEnter() {
  clearTimeout(leaveTimer)
  leaving.value = false
}

function busy() {
  const box = peek.value === 'sidebar' ? leftSlot.value : rightSlot.value
  const focused = document.activeElement
  const typing = !!box && !!focused && box.contains(focused) && focused.matches('input, textarea, [contenteditable], .cm-content')
  return typing || !!menu.value
}

function peekLeave() {
  clearTimeout(leaveTimer)
  leaveTimer = window.setTimeout(() => !busy() && dismiss(), 350)
}

function dismiss() {
  if (peek.value) leaving.value = true
}

function peekDone(e: AnimationEvent) {
  if (leaving.value && e.target === e.currentTarget) {
    peek.value = null
    leaving.value = false
  }
}

function onPointerDown(e: PointerEvent) {
  const box = peek.value === 'sidebar' ? leftSlot.value : rightSlot.value
  if (peek.value && box && !box.contains(e.target as Node) && !(e.target as Element).closest?.('[role="menu"]')) dismiss()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && peek.value && !menu.value) {
    e.preventDefault()
    dismiss()
  }
}

// Pinning the panel (or closing the last terminal) ends the peek.
watch([sidebarOpen, rightOpen, rightPeekable], () => {
  if ((peek.value === 'sidebar' && sidebarOpen.value) || (peek.value === 'terminal' && (rightOpen.value || !rightPeekable.value))) peek.value = null
})
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKey)
  clearTimeout(enterTimer)
  clearTimeout(leaveTimer)
})

const showTerminal = computed(() => sessions.value.length > 0 && (open.value || peek.value === 'terminal'))
const showPanel = computed(() => panelDocked.value || (peek.value === 'terminal' && panelTabs.value.length > 0 && !panelExpanded.value))
const column = ref<HTMLElement>()

/** Drags the bar between the terminal and the panel; the panel's height is kept as a share of the column. */
function startSplit(e: MouseEvent) {
  const box = column.value!.getBoundingClientRect()
  const move = (ev: MouseEvent) => (prefs.panelHeight.value = Math.min(Math.max((box.bottom - ev.clientY) / box.height, 0.15), 0.85))
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.classList.remove('resizing-rows')
    window.dispatchEvent(new Event('panel-resize-end'))
  }
  document.body.classList.add('resizing-rows')
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  e.preventDefault()
}

/** Drags a gutter: the sidebar is sized in pixels from the left, the terminal as a fraction from the right. */
function startResize(e: MouseEvent, side: 'sidebar' | 'terminal') {
  const box = el.value!.getBoundingClientRect()
  const move = (ev: MouseEvent) => {
    if (side === 'sidebar') sidebarWidth.value = Math.min(Math.max(ev.clientX - box.left - 8, 220), 520)
    else width.value = Math.min(Math.max((box.right - ev.clientX) / box.width, 0.2), 0.8)
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
</script>

<template>
  <div v-show="visible" ref="el" class="workspace">
    <div v-if="repo && !sidebarOpen" class="edge left" @mouseenter="edgeEnter('sidebar')" @mouseleave="edgeLeave" />
    <div
      v-if="repo"
      ref="leftSlot"
      class="slot left"
      :class="{
        sliding: sliding === 'sidebar',
        shut: !sidebarOpen && peek !== 'sidebar',
        peek: peek === 'sidebar',
        leaving: peek === 'sidebar' && leaving,
      }"
      :style="{ width: sidebarOpen ? `${sidebarWidth + 10}px` : peek === 'sidebar' ? `${sidebarWidth}px` : '0px' }"
      @transitionend.self="doneSliding"
      @animationend="peekDone"
      @mouseenter="peek && peekEnter()"
      @mouseleave="peek && peekLeave()"
    >
      <Sidebar class="sidebar" :style="{ width: `${sidebarWidth}px` }" />
      <div class="gutter" @mousedown="startResize($event, 'sidebar')" />
    </div>
    <GraphPane class="graph" />
    <!-- Terminals stay mounted while hidden so their shells keep running. -->
    <div
      v-if="repo && rightPeekable && !rightOpen && peek !== 'terminal'"
      class="edge right"
      @mouseenter="edgeEnter('terminal')"
      @mouseleave="edgeLeave"
    />
    <div
      v-if="repo && (sessions.length || panelDocked || panelTabs.length)"
      ref="rightSlot"
      class="slot right"
      :class="{
        sliding: sliding === 'terminal',
        shut: !rightOpen && peek !== 'terminal',
        peek: peek === 'terminal',
        leaving: peek === 'terminal' && leaving,
      }"
      :style="{ width: rightOpen ? `${terminalPx + 10}px` : peek === 'terminal' ? `${terminalPx}px` : '0px' }"
      @transitionend.self="doneSliding"
      @animationend="peekDone"
      @mouseenter="peek && peekEnter()"
      @mouseleave="peek && peekLeave()"
    >
      <div class="gutter" @mousedown="startResize($event, 'terminal')" />
      <div ref="column" class="column" :style="{ width: `${terminalPx}px` }">
        <TerminalPane v-if="sessions.length" v-show="showTerminal" class="terminal" :visible="visible && showTerminal" />
        <div v-if="showTerminal && showPanel" class="split" @mousedown="startSplit" />
        <SidePanel
          v-if="showPanel"
          docked
          class="panel-dock"
          :class="{ alone: !showTerminal }"
          :style="showTerminal ? { height: `${Math.round(prefs.panelHeight.value * 100)}%` } : undefined"
        />
      </div>
    </div>
    <DiffModal />
    <ConflictResolver />
    <RebaseModal />
  </div>
</template>

<style scoped>
.workspace {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0 10px;
}
.graph {
  flex: 1;
  min-width: 320px;
}
.slot {
  display: flex;
  flex: none;
}
/* Panels keep their own width inside the slot, so they slide out of view rather than squash. */
.slot.left {
  justify-content: flex-end;
}
.slot.sliding {
  overflow: hidden;
  transition: width 0.26s var(--ease-out);
}
.slot.shut {
  overflow: hidden;
  pointer-events: none;
}
.sidebar,
.column {
  flex: none;
}
.column {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.terminal {
  flex: 1;
  min-height: 120px;
}
.panel-dock {
  flex: none;
  min-height: 120px;
}
.panel-dock.alone {
  flex: 1;
}
/* The bar between the terminal and the panel. */
.split {
  flex: none;
  height: 10px;
  cursor: row-resize;
}
.gutter {
  flex: none;
  width: 10px;
  cursor: col-resize;
}
/* Hot zones along the window's edges, where a closed panel can be peeked. */
.edge {
  position: absolute;
  z-index: 20;
  top: 0;
  bottom: 0;
  width: 8px;
}
.edge.left {
  left: 0;
}
.edge.right {
  right: 0;
}
/* A peeked panel floats over the graph instead of pushing it aside. */
.slot.peek {
  position: absolute;
  z-index: 30;
  top: 0;
  bottom: 0;
  border-radius: 14px;
  box-shadow: var(--shadow);
  animation: peek-in-left 0.2s var(--ease-out);
}
.slot.peek.left {
  left: 10px;
}
.slot.peek.right {
  right: 10px;
  animation-name: peek-in-right;
}
.slot.peek.leaving {
  animation: peek-out-left 0.16s var(--ease-out) forwards;
}
.slot.peek.right.leaving {
  animation-name: peek-out-right;
}
.slot.peek .gutter {
  display: none;
}
@keyframes peek-in-left {
  from {
    opacity: 0;
    transform: translateX(-24px);
  }
}
@keyframes peek-in-right {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
}
@keyframes peek-out-left {
  to {
    opacity: 0;
    transform: translateX(-24px);
  }
}
@keyframes peek-out-right {
  to {
    opacity: 0;
    transform: translateX(24px);
  }
}
</style>
