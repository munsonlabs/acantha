<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { git } from '@/lib/git'
import { basename } from '@/lib/format'
import { activateTabNumber, overlays, runCommand } from '@/composables/commands'
import { prefs } from '@/composables/prefs'
import { lastUsed, pathOf, useWorkspaces, type Workspace } from '@/composables/workspace'
import { bringBackAll } from '@/composables/claudeWindow'
import { closeDialog, confirmAction, useDialog } from '@/composables/useDialog'
import { onMakeTodos, useContextMenu } from '@/composables/useContextMenu'
import { pasteIntoPanel } from '@/composables/slackLinks'
import { showToast } from '@/composables/useToast'
import CommandPalette from '@/components/CommandPalette.vue'
import OpenFiles from '@/components/OpenFiles.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import StatusBar from '@/components/StatusBar.vue'
import TitleBar from '@/components/TitleBar.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import WorkspaceView from '@/components/WorkspaceView.vue'
import TabList from '@/components/TabList.vue'
import { connectClaudeWindows } from '@/composables/claudeWindow'
import { isOn } from '@/features'

/** Settings and the shortcuts sheet load when first opened, not with the app. */
const SettingsModal = defineAsyncComponent(() => import('@/components/SettingsModal.vue'))
const ShortcutsModal = defineAsyncComponent(() => import('@/components/ShortcutsModal.vue'))
const used = ref({ settings: false, shortcuts: false })
watch(
  () => [overlays.settings.value, overlays.shortcuts.value],
  ([settings, shortcuts]) => {
    if ((settings && !used.value.settings) || (shortcuts && !used.value.shortcuts))
      used.value = { settings: used.value.settings || settings, shortcuts: used.value.shortcuts || shortcuts }
  },
)

connectClaudeWindows()

const { workspaces, activeId, active, activate, addWorkspace, closeWorkspace, openInWorkspace, sleepWorkspace } = useWorkspaces()
const { current: dialog } = useDialog()
const { menu, closeMenu } = useContextMenu()
const appWindow = getCurrentWindow()
const unlisten: UnlistenFn[] = []

// The interface size scales the whole webview, so text stays sharp and menus still open under the mouse.
watch(
  prefs.uiZoom,
  (zoom) =>
    void getCurrentWebview()
      .setZoom(zoom)
      .catch(() => {}),
  { immediate: true },
)

watch(
  () => active.value?.repo.repo.value,
  (r) => appWindow.setTitle(r ? `${basename(r)} · Acantha` : 'Acantha').catch(() => {}),
)

/** ⌘ + key → command. The native menu sends most of these too; `runCommand` ignores the duplicate. */
const KEYS: Record<string, string> = {
  t: 'new-tab',
  o: 'open-repo',
  w: 'close',
  b: 'toggle-sidebar',
  j: 'toggle-terminal',
  r: 'refresh',
  p: 'go-to-file',
  ',': 'settings',
  '/': 'shortcuts',
  f: 'find',
  e: 'open-files',
}

// OpenCode keeps every session; with Settings saying so, old ones go a minute after Acantha starts.
setTimeout(() => {
  if (isOn('claude') && prefs.opencodePruneDays.value > 0) void invoke('opencode_prune', { days: prefs.opencodePruneDays.value }).catch(() => {})
}, 60_000)

/**
 * AI switched off (Settings, or the palette): nothing of it keeps running. Every agent stops (their conversations
 * kept, for when it's back on), OpenCode's server with them; floating agents close, and a review or tour is put away.
 */
watch(
  () => isOn('claude'),
  (on) => {
    if (on) return
    void invoke('agents_stop_all').catch(() => {})
    void bringBackAll()
    for (const w of workspaces.value) {
      w.ui.review.value = null
      w.tour.hide()
    }
  },
)

/** Puts away what's in front over the graph (see GraphPane): the file, a review, the agents or the panel. */
function putAwayFront(ws: Workspace) {
  const front = ws.ui.front.value
  if (front === 'agents' && prefs.agentsOpen.value && ws.agents.expanded.value && ws.agents.tabs.value.length) ws.agents.expanded.value = false
  else if (front === 'panel' && ws.panel.expanded.value) ws.panel.expanded.value = false
  else if (front === 'review' && ws.ui.review.value) ws.ui.review.value = null
  else if (front === 'file' && ws.files.preview.value) void ws.files.closePreview()
  else return false
  return true
}

function onKeydown(e: KeyboardEvent) {
  const ws = active.value
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()
  // The editor is a contenteditable, and uses Escape (Vim) and ⌘F (search) itself.
  const target = e.target instanceof Element ? e.target : null
  const inEditor = !!target?.closest('.cm-editor')
  const typing = inEditor || !!target?.matches('input, select, textarea')

  if (e.ctrlKey && e.shiftKey && e.code === 'Backquote') {
    e.preventDefault()
    runCommand('new-terminal')
  } else if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
    // ⌘+ is ⌘⇧= on most layouts, so these are matched with or without Shift.
    e.preventDefault()
    runCommand(e.key === '-' ? 'zoom-out' : e.key === '0' ? 'zoom-reset' : 'zoom-in')
  } else if (e.metaKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault()
    activateTabNumber(Number(e.key))
  } else if (e.metaKey && e.shiftKey && (e.key === '[' || e.key === '{' || e.key === ']' || e.key === '}')) {
    e.preventDefault()
    runCommand(e.key === '[' || e.key === '{' ? 'prev-tab' : 'next-tab')
  } else if (mod && e.shiftKey && !e.altKey && key === 'i') {
    e.preventDefault()
    runCommand('toggle-claude')
  } else if (mod && e.shiftKey && !e.altKey && key === 'p') {
    e.preventDefault()
    runCommand('palette')
  } else if (mod && e.shiftKey && !e.altKey && key === 'l') {
    e.preventDefault()
    runCommand('open-slack-link')
  } else if (mod && e.shiftKey && !e.altKey && key === 'f') {
    e.preventDefault()
    runCommand('search-files')
  } else if (mod && e.altKey && !e.shiftKey && e.code === 'KeyF' && !inEditor) {
    // ⌥ changes e.key on macOS (ƒ), so this one goes by the physical key.
    e.preventDefault()
    runCommand('search-file-names')
  } else if (mod && !e.shiftKey && !e.altKey && KEYS[key] && !((key === 'f' || key === '/') && inEditor)) {
    e.preventDefault()
    runCommand(KEYS[key])
  } else if (e.key === 'Escape') {
    // Already handled by the editor, a search box, a dropdown or the palette.
    if (e.defaultPrevented) return
    let closed = true
    if (inEditor) closed = false
    else if (dialog.value) closeDialog(null)
    else if (overlays.settings.value) overlays.settings.value = false
    else if (overlays.shortcuts.value) overlays.shortcuts.value = false
    else if (overlays.openFiles.value) overlays.openFiles.value = false
    else if (ws?.diff.diff.value) ws.diff.closeDiff()
    else if (ws?.ui.conflict.value) ws.ui.conflict.value = null
    else if (ws?.ui.rebase.value) ws.ui.rebase.value = null
    else if (ws?.ui.branchCleanup.value) ws.ui.branchCleanup.value = false
    else if (menu.value) closeMenu()
    else if (!typing && ws?.tour.showing.value) ws.tour.hide()
    // Whatever's in front over the graph goes first; then the rest, in turn.
    else if (!typing && ws && putAwayFront(ws)) closed = true
    else if (!typing && ws?.files.preview.value) void ws.files.closePreview()
    else if (!typing && ws?.ui.review.value) ws.ui.review.value = null
    else if (!typing && ws?.panel.expanded.value) ws.panel.expanded.value = false
    else if (!typing && prefs.agentsOpen.value && ws?.agents.expanded.value && ws.agents.tabs.value.length) ws.agents.expanded.value = false
    else if (!typing && ws?.details.details.value) ws.details.closeDetails()
    else closed = false
    if (closed) e.preventDefault()
    else escapeFullscreen(e)
  } else if (!typing && !dialog.value && !ws?.diff.diff.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && ws?.details.details.value) {
    e.preventDefault()
    ws.details.step(e.key === 'ArrowDown' ? 1 : -1)
  }
}

/** Quitting asks first when any file has unsaved edits (see `should_quit` in main.rs). */
async function onQuitRequested() {
  const unsaved = workspaces.value.reduce((n, ws) => n + ws.files.drafts.value.size, 0)
  const what = unsaved === 1 ? '1 file' : `${unsaved} files`
  if (!unsaved || (await confirmAction('Quit Acantha?', `You have unsaved changes in ${what}. Quit and lose them?`, 'Quit', true)))
    await invoke('quit_app')
}

// Right-click → Make To-do List on selected text.
onMakeTodos((items) => {
  const ws = active.value
  if (!ws?.repo.repo.value) return
  ws.panel.addTodos('To-dos', items)
})

/**
 * In macOS full screen, an Escape the page doesn't claim also exits full screen. Escapes that close something are
 * claimed above; with nothing to close, the first one asks for a second, and that one leaves full screen.
 */
let fullscreen = false
let escapeArmedAt = 0
const syncFullscreen = () =>
  appWindow.isFullscreen().then(
    (f) => (fullscreen = f),
    () => {},
  )

function escapeFullscreen(e: KeyboardEvent) {
  if (!fullscreen) return
  e.preventDefault()
  if (Date.now() - escapeArmedAt < 2000) {
    escapeArmedAt = 0
    void appWindow.setFullscreen(false).catch(() => {})
  } else {
    escapeArmedAt = Date.now()
    showToast('Press Esc again to exit full screen')
  }
}

/** Pasting outside a text field: a Slack link opens in the panel, and a bulleted list becomes a to-do list there. */
function onPaste(e: ClipboardEvent) {
  const target = e.target instanceof Element ? e.target : null
  if (target?.closest('input, textarea, [contenteditable], .cm-editor, .xterm')) return
  const ws = active.value
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (ws?.repo.repo.value && pasteIntoPanel(ws, text)) e.preventDefault()
}

let lastFocusReload = 0

// Background fetch: each open repository fetches quietly once its interval is up, so "behind" badges stay current.
const autoFetch = setInterval(() => {
  if (!prefs.autoFetch.value) return
  const due = Date.now() - prefs.autoFetchMinutes.value * 60_000
  for (const ws of workspaces.value) {
    if (ws.repo.repo.value && ws.repo.lastFetch.value < due) void ws.repo.fetchQuietly().then(() => ws.status.refresh())
  }
}, 30_000)

// Tabs unused for a while go to sleep, when Settings says so. One with something running in a terminal (a dev
// server, a build) is left alone, since sleeping would stop it.
const autoSleep = setInterval(async () => {
  const minutes = prefs.autoSleepMinutes.value
  if (!minutes || !isOn('tabSleep')) return
  const before = Date.now() - minutes * 60_000
  for (const ws of workspaces.value) {
    if (ws.id === activeId.value || ws.sleeping.value || !ws.repo.repo.value) continue
    if (!lastUsed.has(ws.id)) lastUsed.set(ws.id, Date.now())
    if (lastUsed.get(ws.id)! > before) continue
    // Anything running in its terminals (a dev server, a build, claude) keeps it awake.
    if ((await ws.terminals.checkRunning()).length) continue
    void sleepWorkspace(ws.id, { ask: false })
  }
}, 60_000)

// A safety net: the file watcher reports changes instantly, but if it can't run (some network drives), this still catches them.
const poll = setInterval(() => {
  if (document.hasFocus() && !document.hidden) void active.value?.status.refresh()
}, 30_000)

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('paste', onPaste)
  void syncFullscreen()
  unlisten.push(
    // Entering or leaving full screen resizes the window.
    await appWindow.onResized(syncFullscreen),
    // Pick up changes made in the terminal or an editor whenever the window comes back into focus.
    await appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused && Date.now() - lastFocusReload > 1000) {
        lastFocusReload = Date.now()
        void active.value?.repo.reload()
      }
    }),
    // Clicks and shortcuts from the native menu bar.
    await listen<string>('menu', ({ payload }) => runCommand(payload)),
    await listen('quit-requested', () => void onQuitRequested()),
    await appWindow.onDragDropEvent(({ payload }) => {
      if (payload.type === 'drop' && payload.paths[0]) void openInWorkspace(payload.paths[0])
    }),
  )

  // Bring back the tabs from last time, then the repo passed on the command line. Only the tab that was showing opens
  // its repository; the others sleep until they're clicked, so many tabs start as fast as one.
  const saved = [...prefs.workspaces.value]
  const showing = saved.includes(prefs.activeWorkspace.value ?? '') ? prefs.activeWorkspace.value : saved[0]
  for (const path of saved) {
    const ws = await addWorkspace(path, { quiet: true, activate: false, asleep: path !== showing })
    if (path === showing && !ws.repo.repo.value) void closeWorkspace(ws.id)
  }
  const initial = await git.initialRepo()
  if (initial) {
    const root = await git.resolveRepo(initial).catch(() => initial)
    const existing = workspaces.value.find((w) => pathOf(w) === root)
    if (existing) activate(existing.id)
    else await addWorkspace(initial)
  } else if (workspaces.value.length) {
    activate((workspaces.value.find((w) => pathOf(w) === showing) ?? workspaces.value[0]).id)
  }
  if (!workspaces.value.length) await addWorkspace()
})

onBeforeUnmount(() => {
  clearInterval(poll)
  clearInterval(autoFetch)
  clearInterval(autoSleep)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onPaste)
  unlisten.forEach((fn) => fn())
})
</script>

<template>
  <TitleBar />
  <!-- A sleeping tab has no view at all: nothing of it is kept until it's woken. -->
  <template v-for="ws in workspaces" :key="`${ws.id}:${ws.gen}`">
    <WorkspaceView v-if="!ws.sleeping.value" :ws="ws" :visible="ws.id === activeId" />
  </template>
  <StatusBar />
  <ContextMenu />
  <CommandPalette />
  <OpenFiles />
  <TabList />
  <SettingsModal v-if="used.settings" />
  <ShortcutsModal v-if="used.shortcuts" />
  <PromptDialog />
  <ToastMessage />
</template>
