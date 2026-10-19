<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSlidingPill, useTabDrag } from '@/composables/tabs'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import TerminalView from './TerminalView.vue'

defineProps<{ visible: boolean }>()
const { sessions, activeKey, add, close, move, toggle } = useWorkspace().terminals
const strip = ref<HTMLElement>()

const pill = useSlidingPill(strip, () => [activeKey.value, sessions.value.map((s) => `${s.key}:${s.title}`)])
const { dragging, onPointerDown } = useTabDrag(strip, move)

/** Terminals render in creation order, so reordering tabs never moves (and disturbs) a live terminal. */
const views = computed(() => [...sessions.value].sort((a, b) => a.key - b.key))

function onTabDown(e: PointerEvent, key: number, index: number) {
  if (e.button !== 0) return
  activeKey.value = key
  onPointerDown(e, index)
}

/** Numbers tabs that would otherwise share a name, like "zsh" and "zsh 2". */
const label = (i: number) => {
  const title = sessions.value[i].title
  const n = sessions.value.slice(0, i).filter((s) => s.title === title).length
  return n ? `${title} ${n + 1}` : title
}
</script>

<template>
  <section class="pane terminal-pane">
    <header class="pane-header">
      <div ref="strip" class="tabs pilled">
        <span class="tab-pill" :style="pill.style.value" />
        <div
          v-for="(s, i) in sessions"
          :key="s.key"
          class="tab"
          :class="{ active: s.key === activeKey, dragging: dragging === i }"
          :title="s.cwd"
          @pointerdown="onTabDown($event, s.key, i)"
          @auxclick.middle="close(s.key)"
        >
          <Icon name="terminal" :size="13" />
          <span>{{ label(i) }}</span>
          <button class="tab-close" title="Close Terminal" @mousedown.stop @click.stop="close(s.key)"><Icon name="x" :size="12" /></button>
        </div>
      </div>
      <button class="ghost icon-btn" title="New Terminal (⌃⇧`)" @click="add()"><Icon name="plus" /></button>
      <div class="spacer" />
      <button class="ghost icon-btn" title="Hide Terminal (⌘J)" @click="toggle"><Icon name="sidebar" /></button>
    </header>
    <div class="terminal-body">
      <TerminalView
        v-for="s in views"
        v-show="s.key === activeKey"
        :key="s.key"
        :session="s"
        :active="visible && s.key === activeKey"
        @exit="close(s.key)"
        @title="(t) => (s.title = t)"
      />
    </div>
  </section>
</template>

<style scoped>
.terminal-pane {
  display: flex;
  flex-direction: column;
}
.tabs {
  position: relative;
  display: flex;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.terminal-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
</style>
