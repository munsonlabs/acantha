<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { git } from '@/lib/git'
import { basename } from '@/lib/format'
import { activateTabNumber, overlays, runCommand } from '@/composables/commands'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import { closeDialog, useDialog } from '@/composables/useDialog'
import { useContextMenu } from '@/composables/useContextMenu'
import CommandPalette from '@/components/CommandPalette.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import ShortcutsModal from '@/components/ShortcutsModal.vue'
import StatusBar from '@/components/StatusBar.vue'
import TitleBar from '@/components/TitleBar.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import WorkspaceView from '@/components/WorkspaceView.vue'

const { workspaces, activeId, active, activate, addWorkspace, closeWorkspace, openInWorkspace } = useWorkspaces()
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
  p: 'palette',
  ',': 'settings',
  '/': 'shortcuts',
  f: 'find',
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
  } else if (mod && !e.shiftKey && !e.altKey && KEYS[key] && !(key === 'f' && inEditor)) {
    e.preventDefault()
    runCommand(KEYS[key])
  } else if (e.key === 'Escape') {
    if (inEditor) return
    if (dialog.value) closeDialog(null)
    else if (overlays.settings.value) overlays.settings.value = false
    else if (overlays.shortcuts.value) overlays.shortcuts.value = false
    else if (ws?.diff.diff.value) ws.diff.closeDiff()
    else if (ws?.ui.conflict.value) ws.ui.conflict.value = null
    else if (ws?.ui.rebase.value) ws.ui.rebase.value = null
    else if (menu.value) closeMenu()
    else if (!typing && ws?.files.preview.value) void ws.files.closePreview()
    else if (!typing && ws?.details.details.value) ws.details.closeDetails()
  } else if (!typing && !dialog.value && !ws?.diff.diff.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && ws?.details.details.value) {
    e.preventDefault()
    ws.details.step(e.key === 'ArrowDown' ? 1 : -1)
  }
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

// A safety net: the file watcher reports changes instantly, but if it can't run (some network drives), this still catches them.
const poll = setInterval(() => {
  if (document.hasFocus() && !document.hidden) void active.value?.status.refresh()
}, 30_000)

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  // Pick up changes made in the terminal or an editor whenever the window comes back into focus.
  unlisten.push(
    await appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused && Date.now() - lastFocusReload > 1000) {
        lastFocusReload = Date.now()
        void active.value?.repo.reload()
      }
    }),
    // Clicks and shortcuts from the native menu bar.
    await listen<string>('menu', ({ payload }) => runCommand(payload)),
    await appWindow.onDragDropEvent(({ payload }) => {
      if (payload.type === 'drop' && payload.paths[0]) void openInWorkspace(payload.paths[0])
    }),
  )

  // Bring back the tabs from last time, then the repo passed on the command line.
  const saved = [...prefs.workspaces.value]
  for (const path of saved) {
    const ws = await addWorkspace(path, { quiet: true })
    if (!ws.repo.repo.value) void closeWorkspace(ws.id)
  }
  const initial = await git.initialRepo()
  if (initial) {
    const root = await git.resolveRepo(initial).catch(() => initial)
    const existing = workspaces.value.find((w) => w.repo.repo.value === root)
    if (existing) activate(existing.id)
    else await addWorkspace(initial)
  } else if (workspaces.value.length) {
    activate(workspaces.value[0].id)
  }
  if (!workspaces.value.length) await addWorkspace()
})

onBeforeUnmount(() => {
  clearInterval(poll)
  clearInterval(autoFetch)
  window.removeEventListener('keydown', onKeydown)
  unlisten.forEach((fn) => fn())
})
</script>

<template>
  <TitleBar />
  <WorkspaceView v-for="ws in workspaces" :key="ws.id" :ws="ws" :visible="ws.id === activeId" />
  <StatusBar />
  <ContextMenu />
  <CommandPalette />
  <SettingsModal />
  <ShortcutsModal />
  <PromptDialog />
  <ToastMessage />
</template>
