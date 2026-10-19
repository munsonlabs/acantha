<script setup lang="ts">
import { computed, ref } from 'vue'
import { basename } from '@/lib/format'
import { useWorkspaces, type Workspace } from '@/composables/workspace'
import { openMenu } from '@/composables/useContextMenu'
import Icon from './Icon.vue'

const { workspaces, activeId, active, activate, addWorkspace, closeWorkspace, closeOtherWorkspaces } = useWorkspaces()
const input = ref<HTMLInputElement>()

const search = computed(() => active.value?.search ?? null)
const query = computed({
  get: () => search.value?.query.value ?? '',
  set: (v: string) => {
    if (search.value) search.value.query.value = v
  },
})

const label = (ws: Workspace) => (ws.repo.repo.value ? basename(ws.repo.repo.value) : 'New Tab')

function tabMenu(e: MouseEvent, ws: Workspace) {
  openMenu(e, [
    { label: 'New Tab', run: () => addWorkspace() },
    'separator',
    { label: 'Close Tab', run: () => closeWorkspace(ws.id) },
    { label: 'Close Other Tabs', disabled: workspaces.value.length < 2, run: () => closeOtherWorkspaces(ws.id) },
  ])
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter') search.value?.step(e.shiftKey ? -1 : 1)
  if (e.key === 'Escape') {
    query.value = ''
    input.value?.blur()
  }
}

defineExpose({ focusSearch: () => input.value?.select() })
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="tabs" data-tauri-drag-region>
      <div
        v-for="ws in workspaces"
        :key="ws.id"
        class="tab"
        :class="{ active: ws.id === activeId }"
        :title="ws.repo.repo.value ?? undefined"
        @mousedown.left="activate(ws.id)"
        @auxclick.middle="closeWorkspace(ws.id)"
        @contextmenu.prevent="tabMenu($event, ws)"
      >
        <Icon :name="ws.repo.repo.value ? 'history' : 'folder'" :size="13" />
        <span class="name">{{ label(ws) }}</span>
        <span v-if="ws.repo.log.value?.headBranch" class="branch">· {{ ws.repo.log.value.headBranch }}</span>
        <button class="tab-close" title="Close Tab (⌘W)" @mousedown.stop @click.stop="closeWorkspace(ws.id)"><Icon name="x" :size="12" /></button>
      </div>
      <button class="ghost icon-btn" title="New Tab (⌘T)" @click="addWorkspace()"><Icon name="plus" /></button>
    </div>
    <label v-if="active?.repo.repo.value" class="search">
      <Icon name="search" :size="13" />
      <input ref="input" v-model="query" type="text" placeholder="Search commits (⌘F)" spellcheck="false" autocomplete="off" @keydown="onSearchKey" />
      <span v-if="query" class="count">{{ search!.matches.value.length ? `${search!.index.value + 1}/${search!.matches.value.length}` : '0' }}</span>
    </label>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 40px;
  /* Room for the macOS traffic lights. */
  padding: 0 10px 0 84px;
}
.tabs {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab .name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab .branch {
  color: var(--fg-muted);
}
.search {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  width: 240px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--fg-muted);
}
.search:focus-within {
  border-color: var(--ring);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fg);
  font-size: 12px;
  outline: none;
}
.count {
  font: 11px var(--mono);
}
</style>
