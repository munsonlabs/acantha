<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { LogicalPosition, LogicalSize, getCurrentWindow } from '@tauri-apps/api/window'
import { conversations } from '@/composables/claude'
import { askOpenRepos, openInMain, startIn, switchTo, type Rect } from '@/composables/claudeWindow'
import { openMenu, type MenuEntry } from '@/composables/useContextMenu'
import { prefs } from '@/composables/prefs'
import { costText, statusWords, when } from '@/lib/claudeView'
import ClaudeChat from '@/components/ClaudeChat.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import Icon from '@/components/Icon.vue'

/**
 * A Claude conversation popped out of its panel tab: no window to speak of, just its bubbles floating in a corner of the
 * screen over whatever's there, and a status chip under them. The chip collapses it all into itself and back, pins it
 * above other apps, and ✕ docks Claude back in the panel; the conversation carries on either way.
 */
const params = new URLSearchParams(location.search)
const id = params.get('conv') ?? ''
const root = params.get('repo') ?? ''
const win = getCurrentWindow()
const chat = ref<InstanceType<typeof ClaudeChat>>()
const claude = computed(() => chat.value?.claude)
const expanded = ref(true)

/** Collapsed, the window shrinks to the chip: a see-through window still takes the clicks meant for what's behind it. */
const CHIP = { w: 300, h: 56 }
const MIN = { w: 340, h: 380 }

/**
 * Pinned, it floats above other apps' windows and shows on every Space, a full-screen app's included. Unpinned, it's an
 * ordinary window.
 */
function pin(on: boolean) {
  prefs.claudeOnTop.value = on
  void invoke('claude_window_pin', { on })
}

/** Where it is and how big, in points. */
async function rect() {
  const scale = await win.scaleFactor()
  const pos = (await win.outerPosition()).toLogical(scale)
  const size = (await win.innerSize()).toLogical(scale)
  return { x: pos.x, y: pos.y, w: size.width, h: size.height }
}

/** Grows or shrinks to a size, keeping its bottom-right corner where it is (the chip stays put). */
let resizing = false
async function resizeTo(w: number, h: number) {
  const r = await rect()
  resizing = true
  await win.setMinSize(null)
  await win.setSize(new LogicalSize(w, h))
  await win.setPosition(new LogicalPosition(r.x + r.w - w, r.y + r.h - h))
  if (expanded.value) await win.setMinSize(new LogicalSize(MIN.w, MIN.h))
  setTimeout(() => (resizing = false), 300)
}

async function setExpanded(on: boolean) {
  if (on === expanded.value) return
  expanded.value = on
  if (on) {
    const r = prefs.claudeRect.value
    await resizeTo(r?.w ?? 420, r?.h ?? 640)
    await nextTick()
    chat.value?.focus()
  } else await resizeTo(CHIP.w, CHIP.h)
}

// Claude asking for something opens it up, so the question's seen.
watch(
  () => claude.value?.chat.approvals.length ?? 0,
  (n, was) => {
    if (n > was) void setExpanded(true)
  },
)

/** Where it is, expanded: collapsed, the size is the expanded one's, with the same bottom-right corner. */
async function expandedRect(): Promise<Rect> {
  const r = await rect()
  const old = prefs.claudeRect.value
  const w = expanded.value ? r.w : (old?.w ?? 420)
  const h = expanded.value ? r.h : (old?.h ?? 640)
  return { x: Math.round(r.x + r.w - w), y: Math.round(r.y + r.h - h), w: Math.round(w), h: Math.round(h) }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
/** Where it is and how big, kept for the next one. */
function remember() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (!resizing) prefs.claudeRect.value = await expandedRect()
  }, 400)
}

/**
 * The conversations to switch to: every open one, by repository (this one's first), saying which are working or
 * waiting for you, and a new one in any repository open in Acantha. The one picked takes this one's place here; this
 * one goes back to its panel tab.
 */
async function openSwitcher(e: MouseEvent) {
  const [repos, statuses] = await Promise.all([
    askOpenRepos(win.label),
    invoke<Record<string, string>>('claude_statuses').catch((): Record<string, string> => ({})),
  ])
  const here = await expandedRect()
  const name = (path: string) => path.split('/').pop() ?? path
  const order = [root, ...repos.filter((r) => r !== root).sort((a, b) => name(a).localeCompare(name(b)))]
  const items: MenuEntry[] = []
  for (const repo of order) {
    const open = Object.entries(conversations.value)
      .filter(([, c]) => !c.closed && c.repo === repo)
      .sort(([, a], [, b]) => b.updated - a.updated)
    if (items.length) items.push('separator')
    items.push({ header: name(repo) })
    for (const [other, c] of open) {
      const status = statuses[other]
      items.push({
        label: c.title || 'New conversation',
        icon: other === id ? 'check' : status === 'waiting' ? 'warning' : 'message',
        shortcut: status && status !== 'idle' ? statusWords(status) : when(c.updated),
        run: () => other !== id && void switchTo(id, other, repo, here),
      })
    }
    if (repos.includes(repo)) items.push({ label: 'New Conversation', icon: 'plus', run: () => void startIn(id, repo, here) })
  }
  openMenu(e, items)
}

/**
 * The screen behind dims while you're in Claude (its window in front, expanded), so it's easier to read, and lifts
 * when you go elsewhere: clicks go through the dimming to whatever's under it.
 */
const focused = ref(true)
const dimmed = computed(() => expanded.value && focused.value && prefs.claudeDim.value > 0)
const dim = () => invoke('claude_dim', { on: dimmed.value, amount: prefs.claudeDim.value }).catch(() => {})
// Pinned or not, the dimming goes to Claude's level, just under it.
watch([dimmed, prefs.claudeDim, prefs.claudeOnTop], dim)

/** Esc anywhere in the window interrupts Claude, as in the terminal (the message box handles its own). */
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.defaultPrevented && claude.value?.chat.working) void claude.value.interrupt()
}

const status = computed(() => claude.value?.status.value ?? 'idle')
const cost = computed(() => costText(claude.value?.chat.cost ?? 0))

let moveTimer: ReturnType<typeof setTimeout> | undefined
const unlisten: (() => void)[] = []
onMounted(async () => {
  document.documentElement.classList.add('claude-window')
  pin(prefs.claudeOnTop.value)
  unlisten.push(
    await win.onMoved(() => {
      remember()
      // Onto another screen, maybe: the dimming follows, once it's put down.
      clearTimeout(moveTimer)
      if (dimmed.value) moveTimer = setTimeout(dim, 200)
    }),
    await win.onResized(remember),
    await win.onFocusChanged(({ payload }) => (focused.value = payload)),
  )
  document.addEventListener('keydown', onKey)
  focused.value = await win.isFocused()
  void dim()
  chat.value?.focus()
})
onBeforeUnmount(() => {
  unlisten.forEach((u) => u())
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="claude-window" :class="{ collapsed: !expanded }">
    <!-- Kept while collapsed, so it goes on following the conversation. -->
    <ClaudeChat v-show="expanded" v-if="root && id" :id="id" ref="chat" class="chat" :root="root" floating @open="(path) => openInMain(root, path)" />
    <div v-if="expanded" class="grip" title="Resize" @pointerdown.prevent="win.startResizeDragging('NorthWest')" />

    <!-- The chip: dragged to move it all; its face switches conversation, or, collapsed, expands it. -->
    <div class="chip" data-tauri-drag-region>
      <button class="face" :title="expanded ? 'Switch conversation' : 'Expand'" @click="(e) => (expanded ? openSwitcher(e) : setExpanded(true))">
        <span class="avatar" :class="status">✳</span>
        <span class="who">
          <span class="name">{{ claude?.name ?? 'Claude' }}<Icon v-if="expanded" name="chevron" :size="9" class="more" /></span>
          <span class="status"
            >{{ statusWords(status) }}<template v-if="cost"> · {{ cost }}</template></span
          >
        </span>
      </button>
      <span class="drag" data-tauri-drag-region />
      <button v-if="expanded" class="ghost icon-btn" title="New conversation" :disabled="!claude?.chat.entries.length" @click="claude?.clear()">
        <Icon name="plus" :size="13" />
      </button>
      <button class="ghost icon-btn" :title="expanded ? 'Collapse' : 'Expand'" @click="setExpanded(!expanded)">
        <Icon :name="expanded ? 'minus' : 'maximize'" :size="12" />
      </button>
      <button
        class="ghost icon-btn"
        :class="{ on: prefs.claudeOnTop.value }"
        :title="prefs.claudeOnTop.value ? 'Pinned: stays on top of other apps. Click to unpin' : 'Pin: keep on top of other apps'"
        @click="pin(!prefs.claudeOnTop.value)"
      >
        <Icon name="pin" :size="12" />
      </button>
      <button class="ghost icon-btn" title="Close: back to Acantha's panel" @click="win.close()"><Icon name="x" :size="12" /></button>
    </div>
    <ContextMenu />
  </div>
</template>

<style>
/* Nothing but the desktop behind it. */
html.claude-window,
html.claude-window body {
  background: transparent !important;
}
</style>

<style scoped>
.claude-window {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 100vh;
  padding-bottom: 10px;
  --claude: #d97757;
}
.claude-window.collapsed {
  justify-content: flex-end;
  padding: 0 8px 10px;
}
.chat {
  flex: 1;
  min-height: 0;
}
.grip {
  position: absolute;
  top: 0;
  left: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
}
.chip {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  align-self: flex-end;
  max-width: calc(100% - 28px);
  height: 40px;
  margin-right: 14px;
  padding: 0 6px 0 4px;
  border-radius: 20px;
  background: var(--popover);
  box-shadow:
    0 0 0 0.5px var(--border-strong),
    0 6px 20px rgb(0 0 0 / 28%);
}
.collapsed .chip {
  margin-right: 6px;
}
.face {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 34px;
  padding: 0 6px 0 2px;
  border: none;
  border-radius: 17px;
  background: none;
  text-align: left;
}
.face:hover {
  background: var(--hover);
}
.drag {
  flex: 1;
  align-self: stretch;
  min-width: 8px;
}
.avatar {
  display: grid;
  flex: none;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--claude) 18%, var(--popover));
  color: var(--claude);
  font-size: 15px;
}
.avatar.working {
  animation: pulse 1.4s ease-in-out infinite;
}
.avatar.waiting {
  box-shadow: 0 0 0 2px var(--modify);
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}
.more {
  margin-left: 4px;
  color: var(--fg-faint);
  transform: rotate(-90deg);
}
.name {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.status {
  color: var(--fg-faint);
  font-size: 10.5px;
  white-space: nowrap;
}
.icon-btn {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 12px;
  color: var(--fg-muted);
}
.icon-btn.on {
  color: var(--claude);
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
