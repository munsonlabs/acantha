<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { shortHash, splitPath } from '@/lib/format'
import { overlays } from '@/composables/commands'
import type { OpenFile } from '@/composables/files'
import { useWorkspaces } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'

/** The open-files switcher (⌘E): the files open in this repository, to switch between or close. */
const { active } = useWorkspaces()
const open = overlays.openFiles
const index = ref(0)
const box = ref<HTMLElement>()

const files = computed(() => active.value?.files.openFiles.value ?? [])
const preview = computed(() => active.value?.files.preview.value ?? null)
const isCurrent = (f: OpenFile) => preview.value?.path === f.path && preview.value?.rev === f.rev
/** Files with unsaved edits waiting, the one on screen included. */
const hasDraft = (f: OpenFile) => f.rev === null && !!active.value?.files.drafts.value.has(f.path)

watch(open, async (o) => {
  if (!o) return
  // Start on the file after the one showing, so ⌘E then Enter flips between the last two.
  const at = files.value.findIndex(isCurrent)
  index.value = files.value.length > 1 && at !== -1 ? (at + 1) % files.value.length : Math.max(at, 0)
  await nextTick()
  box.value?.focus()
})

async function choose(f: OpenFile | undefined) {
  const ws = active.value
  if (!f || !ws) return
  open.value = false
  if (!isCurrent(f)) await ws.files.open(f.path, undefined, f.rev)
}

async function close(f: OpenFile) {
  await active.value?.files.closeFile(f)
  index.value = Math.min(index.value, Math.max(files.value.length - 1, 0))
  if (!files.value.length) open.value = false
  else box.value?.focus()
}

function onKey(e: KeyboardEvent) {
  const n = files.value.length
  if (e.key === 'ArrowDown') index.value = (index.value + 1) % Math.max(n, 1)
  else if (e.key === 'ArrowUp') index.value = (index.value - 1 + n) % Math.max(n, 1)
  else if (e.key === 'Enter') void choose(files.value[index.value])
  else if (e.key === 'Backspace' || e.key === 'Delete') void (files.value[index.value] && close(files.value[index.value]))
  else if (e.key === 'Escape' || (e.key === 'e' && e.metaKey)) open.value = false
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="overlay top" @mousedown.self="open = false">
      <div ref="box" class="modal open-files" role="dialog" aria-modal="true" aria-label="Open files" tabindex="-1" @keydown="onKey">
        <header>
          <span>Open files</span>
          <span class="keys">↑↓ to move · ↵ to open · ⌫ to close</span>
        </header>
        <div class="results">
          <div
            v-for="(f, i) in files"
            :key="`${f.rev ?? ''}:${f.path}`"
            class="item"
            :class="{ selected: i === index, current: isCurrent(f) }"
            @mousemove="index = i"
            @click="choose(f)"
          >
            <FileIcon :path="f.path" />
            <span class="label">{{ splitPath(f.path).name }}</span>
            <span v-if="hasDraft(f)" class="dirty" title="Unsaved changes" />
            <span class="detail">{{ splitPath(f.path).dir }}</span>
            <span v-if="f.rev" class="rev" title="At this commit">{{ shortHash(f.rev) }}</span>
            <button class="ghost icon-btn" title="Close" @click.stop="close(f)"><Icon name="x" :size="12" /></button>
          </div>
          <p v-if="!files.length" class="none">No open files. Open one from the sidebar, a search or the palette.</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay.top {
  align-items: flex-start;
  padding-top: 12vh;
}
.open-files {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 48px));
  max-height: 60vh;
  outline: none;
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 8px;
  font-weight: 600;
}
.keys {
  color: var(--fg-faint);
  font-size: 11px;
  font-weight: 400;
}
.results {
  overflow: auto;
  padding: 0 6px 6px;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 4px 0 10px;
  border-radius: 8px;
  cursor: default;
}
.item.selected {
  background: var(--hover);
}
.item.current .label {
  color: var(--accent);
}
.label {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dirty {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--modify);
}
.rev {
  flex: none;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
  font: 11px var(--mono);
}
.icon-btn {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--fg-faint);
  opacity: 0;
}
.item.selected .icon-btn,
.item:hover .icon-btn {
  opacity: 1;
}
.icon-btn:hover {
  color: var(--fg);
}
.none {
  margin: 8px 10px 12px;
  color: var(--fg-faint);
  font-size: 12.5px;
}
</style>
