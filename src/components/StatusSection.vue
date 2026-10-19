<script setup lang="ts">
import { ref } from 'vue'
import type { StatusFile } from '@/lib/git'
import { splitPath } from '@/lib/format'
import { openMenu, type MenuItem } from '@/composables/useContextMenu'
import { fileOpenItems } from '@/composables/openers'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'

const props = defineProps<{ title: string; files: StatusFile[]; mode: 'staged' | 'unstaged' | 'conflict' }>()

const ws = useWorkspace()
const { stage, unstage, discard, busy } = ws.status
const { openStatusDiff } = ws.diff
const { conflict } = ws.ui

/** Conflicted files open in the resolver; everything else shows its diff. */
const openFile = (f: StatusFile) => (props.mode === 'conflict' ? (conflict.value = f) : openStatusDiff(f, props.mode === 'staged'))
const collapsed = ref(false)

const STATUS: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Untracked',
  '!': 'Conflict',
}

function letter(f: StatusFile) {
  if (props.mode === 'conflict') return '!'
  if (f.kind === 'untracked') return 'U'
  return props.mode === 'staged' ? f.index : f.worktree
}

function menu(e: MouseEvent, f: StatusFile) {
  openMenu(e, [
    { header: splitPath(f.path).name, detail: f.path },
    {
      label: props.mode === 'conflict' ? 'Resolve Conflicts…' : 'Open Changes',
      icon: props.mode === 'conflict' ? 'warning' : 'eye',
      run: () => openFile(f),
    },
    'separator',
    props.mode === 'staged'
      ? { label: 'Unstage', icon: 'minus', run: () => unstage([f]) }
      : {
          label: props.mode === 'conflict' ? 'Mark as Resolved' : 'Stage',
          icon: props.mode === 'conflict' ? 'check' : 'plus',
          run: () => stage([f]),
        },
    ...(props.mode === 'unstaged' ? [{ label: 'Discard Changes…', icon: 'trash', danger: true, run: () => discard([f]) } satisfies MenuItem] : []),
    'separator',
    // A deleted file has nothing on disk to open.
    ...fileOpenItems(ws.repo.repo.value!, f.path, { exists: f.worktree !== 'D' && !(f.index === 'D' && f.worktree === '.') }),
  ])
}
</script>

<template>
  <div v-if="files.length" class="section">
    <div class="section-head" @click="collapsed = !collapsed">
      <Icon name="chevron" :size="11" class="chevron" :class="{ open: !collapsed }" />
      <span class="title">{{ title }}</span>
      <span class="count">{{ files.length }}</span>
      <div class="spacer" />
      <div class="actions" @click.stop>
        <template v-if="mode === 'staged'">
          <button class="ghost icon-btn" title="Unstage All" :disabled="busy" @click="unstage(files)"><Icon name="minus" :size="13" /></button>
        </template>
        <template v-else>
          <button v-if="mode === 'unstaged'" class="ghost icon-btn" title="Discard All Changes" :disabled="busy" @click="discard(files)">
            <Icon name="undo" :size="13" />
          </button>
          <button class="ghost icon-btn" :title="mode === 'conflict' ? 'Mark All as Resolved' : 'Stage All'" :disabled="busy" @click="stage(files)">
            <Icon name="plus" :size="13" />
          </button>
        </template>
      </div>
    </div>
    <ul v-show="!collapsed">
      <li
        v-for="f in files"
        :key="f.path"
        :title="`${f.path}${f.oldPath ? ` ← ${f.oldPath}` : ''} · ${STATUS[letter(f)] ?? letter(f)}`"
        @click="openFile(f)"
        @contextmenu.prevent="menu($event, f)"
      >
        <FileIcon :path="f.path" />
        <span class="name">{{ splitPath(f.path).name }}</span>
        <span class="dir">{{ splitPath(f.path).dir.replace(/\/$/, '') }}</span>
        <div class="actions" @click.stop>
          <template v-if="mode === 'staged'">
            <button class="ghost icon-btn" title="Unstage" :disabled="busy" @click="unstage([f])"><Icon name="minus" :size="13" /></button>
          </template>
          <template v-else>
            <button v-if="mode === 'unstaged'" class="ghost icon-btn" title="Discard Changes" :disabled="busy" @click="discard([f])">
              <Icon name="undo" :size="13" />
            </button>
            <button class="ghost icon-btn" :title="mode === 'conflict' ? 'Mark as Resolved' : 'Stage'" :disabled="busy" @click="stage([f])">
              <Icon name="plus" :size="13" />
            </button>
          </template>
        </div>
        <span class="status" :class="`s-${letter(f)}`">{{ letter(f) }}</span>
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
  letter-spacing: 0;
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
.name {
  flex: none;
  max-width: 70%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.actions {
  display: none;
  gap: 1px;
}
.actions .icon-btn {
  width: 20px;
  height: 20px;
  color: var(--fg-muted);
}
.actions .icon-btn:hover {
  color: var(--fg);
}
.section-head:hover .actions,
li:hover .actions {
  display: flex;
}
.status {
  width: 12px;
  flex: none;
  font: 600 11px var(--mono);
  text-align: center;
}
.s-A,
.s-U {
  color: var(--add);
}
.s-M,
.s-T {
  color: var(--modify);
}
.s-D,
.s-\! {
  color: var(--del);
}
.s-R,
.s-C {
  color: var(--rename);
}
</style>
