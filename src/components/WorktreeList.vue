<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Worktree } from '@/lib/git'
import { shortHash } from '@/lib/format'
import { openMenu } from '@/composables/useContextMenu'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

/** The repository's worktrees, at the bottom of the Git tab: open one in its own tab, add or remove them. */
const ws = useWorkspace()
const { log } = ws.repo
const { worktreeMenu, addWorktree, openWorktree } = ws.menus

const worktrees = computed(() => log.value?.worktrees ?? [])
const name = (w: Worktree) => w.path.split('/').pop() || w.path
// With just this one there's nothing to switch to, so the list starts folded; it opens once there are others.
const collapsed = ref(true)
watch(
  () => worktrees.value.length,
  (n, before) => {
    if (n > 1 && !(before && before > 1)) collapsed.value = false
  },
  { immediate: true },
)

const open = (w: Worktree) => !w.current && !w.prunable && openWorktree(w.path)

const add = () => addWorktree({ from: 'HEAD', label: log.value?.headBranch ? `\`${log.value.headBranch}\`` : 'HEAD' })
</script>

<template>
  <div v-if="worktrees.length" class="section">
    <div class="section-head" @click="collapsed = !collapsed">
      <Icon name="chevron" :size="11" class="chevron" :class="{ open: !collapsed }" />
      <span class="title">Worktrees</span>
      <span class="count">{{ worktrees.length }}</span>
      <div class="spacer" />
      <div class="actions" @click.stop>
        <button class="ghost icon-btn" title="New worktree, on a new branch from here" @click="add"><Icon name="plus" :size="13" /></button>
      </div>
    </div>
    <ul v-show="!collapsed">
      <li
        v-for="w in worktrees"
        :key="w.path"
        :class="{ current: w.current, gone: w.prunable }"
        :title="w.prunable ? `${w.path} (folder missing)` : w.current ? `${w.path} (this tab)` : `${w.path}: click to open`"
        @click="open(w)"
        @contextmenu.prevent="openMenu($event, worktreeMenu(w))"
      >
        <Icon :name="w.main ? 'home' : 'folder'" :size="12" class="kind" />
        <span class="name">{{ name(w) }}</span>
        <span class="branch">
          <template v-if="w.branch"><Icon name="branch" :size="10" /> {{ w.branch }}</template>
          <template v-else-if="w.head">{{ shortHash(w.head) }}</template>
        </span>
        <span v-if="w.locked" class="flag" title="Locked: git won't remove or prune it without forcing">locked</span>
        <span v-if="w.prunable" class="flag">missing</span>
        <span v-if="w.current" class="flag here">this tab</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.section {
  margin-top: 6px;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 6px 0 4px;
  border-radius: 6px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
}
.section-head:hover {
  color: var(--fg-muted);
}
.chevron {
  transition: transform 0.12s;
}
.chevron.open {
  transform: rotate(90deg);
}
.count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--pill);
  font: 500 10px var(--font);
}
.actions {
  display: none;
}
.section-head:hover .actions {
  display: flex;
}
.actions .icon-btn {
  width: 20px;
  height: 20px;
  color: var(--fg-muted);
}
.actions .icon-btn:hover {
  color: var(--fg);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 6px 0 20px;
  border-radius: 6px;
  font-size: 12.5px;
}
li:hover {
  background: var(--hover);
}
li.current {
  cursor: default;
}
li.gone {
  opacity: 0.55;
}
.kind {
  color: var(--fg-faint);
}
.name {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
li.current .name {
  color: var(--accent);
}
.branch {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.flag {
  flex: none;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10px;
}
.flag.here {
  color: var(--accent);
}
</style>
