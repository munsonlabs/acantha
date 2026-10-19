<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { git } from '@/lib/git'
import { basename } from '@/lib/format'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import { closeDialog, useDialog } from '@/composables/useDialog'
import { useContextMenu } from '@/composables/useContextMenu'
import ContextMenu from '@/components/ContextMenu.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import StatusBar from '@/components/StatusBar.vue'
import TitleBar from '@/components/TitleBar.vue'
import ToastMessage from '@/components/ToastMessage.vue'
import WorkspaceView from '@/components/WorkspaceView.vue'

const { workspaces, activeId, active, activate, addWorkspace, closeWorkspace, stepWorkspace, openInWorkspace, pickRepo } = useWorkspaces()
const { current: dialog } = useDialog()
const { menu, closeMenu } = useContextMenu()
const titlebar = ref<InstanceType<typeof TitleBar>>()
const appWindow = getCurrentWindow()
const unlisten: UnlistenFn[] = []

watch(
  () => active.value?.repo.repo.value,
  (r) => appWindow.setTitle(r ? `${basename(r)} · Git Graph` : 'Git Graph').catch(() => {}),
)

const inTerminal = (el: Element | null) => !!el?.closest('.terminal-pane')

function onKeydown(e: KeyboardEvent) {
  const ws = active.value
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()
  const typing = (e.target as HTMLElement).matches('input, select, textarea')

  if (e.ctrlKey && e.shiftKey && e.code === 'Backquote') {
    e.preventDefault()
    ws?.terminals.add()
  } else if (e.metaKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault()
    const target = e.key === '9' ? workspaces.value.at(-1) : workspaces.value[Number(e.key) - 1]
    if (target) activate(target.id)
  } else if (e.metaKey && e.shiftKey && (e.key === '[' || e.key === '{' || e.key === ']' || e.key === '}')) {
    e.preventDefault()
    stepWorkspace(e.key === '[' || e.key === '{' ? -1 : 1)
  } else if (mod && key === 't') {
    e.preventDefault()
    void addWorkspace()
  } else if (mod && key === 'w') {
    e.preventDefault()
    if (ws && inTerminal(document.activeElement)) ws.terminals.closeActive()
    else if (ws) closeWorkspace(ws.id)
  } else if (mod && key === 'j') {
    e.preventDefault()
    if (ws?.repo.repo.value) ws.terminals.toggle()
  } else if (mod && key === 'f' && ws?.repo.repo.value) {
    e.preventDefault()
    titlebar.value?.focusSearch()
  } else if (mod && key === 'r') {
    e.preventDefault()
    void ws?.repo.reload()
  } else if (mod && key === 'o') {
    e.preventDefault()
    void pickRepo()
  } else if (e.key === 'Escape') {
    if (dialog.value) closeDialog(null)
    else if (ws?.diff.diff.value) ws.diff.closeDiff()
    else if (menu.value) closeMenu()
    else if (!typing && ws?.details.details.value) ws.details.closeDetails()
  } else if (!typing && !dialog.value && !ws?.diff.diff.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && ws?.details.details.value) {
    e.preventDefault()
    ws.details.step(e.key === 'ArrowDown' ? 1 : -1)
  }
}

let lastFocusReload = 0

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
    await appWindow.onDragDropEvent(({ payload }) => {
      if (payload.type === 'drop' && payload.paths[0]) void openInWorkspace(payload.paths[0])
    }),
  )

  // Bring back the tabs from last time, then the repo passed on the command line.
  const saved = [...prefs.workspaces.value]
  for (const path of saved) {
    const ws = await addWorkspace(path, { quiet: true })
    if (!ws.repo.repo.value) closeWorkspace(ws.id)
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
  window.removeEventListener('keydown', onKeydown)
  unlisten.forEach((fn) => fn())
})
</script>

<template>
  <TitleBar ref="titlebar" />
  <WorkspaceView v-for="ws in workspaces" :key="ws.id" :ws="ws" :visible="ws.id === activeId" />
  <StatusBar />
  <ContextMenu />
  <PromptDialog />
  <ToastMessage />
</template>
