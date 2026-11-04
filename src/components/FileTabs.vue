<script setup lang="ts">
import { computed, ref } from 'vue'
import { shortHash, splitPath } from '@/lib/format'
import type { OpenFile } from '@/composables/files'
import { useSlidingPill, useTabDrag, useTabScroll } from '@/composables/tabs'
import { openMenu } from '@/composables/useContextMenu'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'

/**
 * The open files as tabs along the top of the file view, as in an editor: click one to show it, drag to reorder, the
 * middle button or × to close. The file only being glanced at is in italics until it's kept open (double-click it, or
 * edit it). Two files with the same name each show their folder.
 */
const ws = useWorkspace()
const { tabs, preview, drafts, isPinned, pin, open, closeFile, closeOthers, closeSaved, closeAllTabs, moveTab } = ws.files
const strip = ref<HTMLElement>()

const key = (f: OpenFile) => `${f.rev ?? ''}:${f.path}`
const isCurrent = (f: OpenFile) => preview.value?.path === f.path && preview.value?.rev === f.rev
const hasDraft = (f: OpenFile) => f.rev === null && drafts.value.has(f.path)

/** Names more than one tab has, which then show their folder too. */
const shared = computed(() => {
  const seen = new Map<string, number>()
  for (const f of tabs.value) seen.set(splitPath(f.path).name, (seen.get(splitPath(f.path).name) ?? 0) + 1)
  return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name))
})
function folderOf(f: OpenFile) {
  const { dir, name } = splitPath(f.path)
  return shared.value.has(name) ? dir.replace(/\/$/, '').split('/').pop() : undefined
}

const pill = useSlidingPill(strip, () => [preview.value?.path, preview.value?.rev, tabs.value.map(key)])
const { dragging, onPointerDown } = useTabDrag(strip, moveTab)
useTabScroll(strip, () => preview.value && key(preview.value))

function onTabDown(e: PointerEvent, f: OpenFile, index: number) {
  if (e.button !== 0) return
  if (!isCurrent(f)) void open(f.path, undefined, f.rev)
  onPointerDown(e, index)
}

function tabMenu(e: MouseEvent, f: OpenFile) {
  openMenu(e, [
    ...(isPinned(f) ? [] : [{ label: 'Keep Open', icon: 'pin' as const, run: () => pin(f) }]),
    ...(f.rev === null ? [{ label: 'Reveal in Sidebar', icon: 'folder' as const, run: () => ws.revealFile(f.path) }] : []),
    'separator',
    { label: 'Close', icon: 'x', run: () => closeFile(f) },
    { label: 'Close Other Tabs', icon: 'x', disabled: tabs.value.length < 2, run: () => closeOthers(f) },
    { label: 'Close Saved Tabs', icon: 'x', run: () => closeSaved() },
    { label: 'Close All Tabs', icon: 'x', run: () => closeAllTabs() },
  ])
}
</script>

<template>
  <div ref="strip" class="file-tabs tabs pilled">
    <span class="tab-pill" :style="pill.style.value" />
    <div
      v-for="(f, i) in tabs"
      :key="key(f)"
      class="tab"
      :class="{ active: isCurrent(f), dragging: dragging === i, glance: !isPinned(f) }"
      :title="f.rev ? `${f.path} at ${shortHash(f.rev)}` : f.path"
      @pointerdown="onTabDown($event, f, i)"
      @dblclick="pin(f)"
      @auxclick.middle="closeFile(f)"
      @contextmenu.prevent="tabMenu($event, f)"
    >
      <FileIcon :path="f.path" />
      <span class="label">{{ splitPath(f.path).name }}</span>
      <span v-if="folderOf(f)" class="hint">{{ folderOf(f) }}</span>
      <span v-if="f.rev" class="hint mono">{{ shortHash(f.rev) }}</span>
      <span v-if="hasDraft(f)" class="dirty" title="Unsaved changes">●</span>
      <button class="tab-close" title="Close" @mousedown.stop @click.stop="closeFile(f)"><Icon name="x" :size="12" /></button>
    </div>
  </div>
</template>

<style scoped>
.file-tabs {
  position: relative;
  display: flex;
  flex: none;
  gap: 2px;
  min-width: 0;
  padding: 4px 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.label {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.glance .label {
  font-style: italic;
}
.hint {
  color: var(--fg-faint);
  font-size: 11px;
  white-space: nowrap;
}
.hint.mono {
  font-family: var(--mono);
}
.dirty {
  color: var(--modify);
  font-size: 10px;
}
</style>
