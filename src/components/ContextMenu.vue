<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useContextMenu, type MenuEntry, type MenuItem } from '@/composables/useContextMenu'
import Icon from './Icon.vue'

const { menu, closeMenu } = useContextMenu()
const el = ref<HTMLElement>()
const pos = ref({ left: 0, top: 0 })
/** The highlighted item, by index into the menu's entries, for the mouse and the arrow keys alike. */
const active = ref(-1)

const isItem = (entry: MenuEntry): entry is MenuItem => typeof entry === 'object' && 'run' in entry
const choosable = computed(() => (menu.value?.items ?? []).flatMap((entry, i) => (isItem(entry) && !entry.disabled ? [i] : [])))
const hasIcons = computed(() => (menu.value?.items ?? []).some((entry) => isItem(entry) && entry.icon))

// Keep the menu on screen once its size is known, and take focus so the arrow keys work.
watch(menu, async (m) => {
  active.value = -1
  if (!m) return
  pos.value = { left: m.x, top: m.y }
  await nextTick()
  const rect = el.value!.getBoundingClientRect()
  pos.value = {
    left: Math.max(4, Math.min(m.x, window.innerWidth - rect.width - 4)),
    top: Math.max(4, Math.min(m.y, window.innerHeight - rect.height - 4)),
  }
  el.value?.focus({ preventScroll: true })
})

function choose(item: MenuItem) {
  if (item.disabled) return
  closeMenu()
  void item.run()
}

function onKey(e: KeyboardEvent) {
  const list = choosable.value
  if (!list.length) return
  const at = list.indexOf(active.value)
  if (e.key === 'ArrowDown') active.value = list[(at + 1) % list.length]
  else if (e.key === 'ArrowUp') active.value = list[(at - 1 + list.length) % list.length]
  else if (e.key === 'Enter' && active.value !== -1) choose(menu.value!.items[active.value] as MenuItem)
  else return
  e.preventDefault()
  e.stopPropagation()
}

const onDown = (e: MouseEvent) => {
  if (menu.value && !el.value?.contains(e.target as Node)) closeMenu()
}
window.addEventListener('mousedown', onDown, true)
window.addEventListener('blur', closeMenu)
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDown, true)
  window.removeEventListener('blur', closeMenu)
})
</script>

<template>
  <Transition name="pop">
    <div
      v-if="menu"
      ref="el"
      class="menu"
      role="menu"
      tabindex="-1"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @contextmenu.prevent
      @keydown="onKey"
      @mouseleave="active = -1"
    >
      <template v-for="(entry, i) in menu.items" :key="i">
        <div v-if="entry === 'separator'" class="separator" />
        <div v-else-if="'header' in entry" class="header">
          <span class="title">{{ entry.header }}</span>
          <span v-if="entry.detail" class="detail">{{ entry.detail }}</span>
        </div>
        <div v-else-if="'swatches' in entry" class="swatches">
          <button
            v-for="s in entry.swatches"
            :key="s.name"
            class="swatch"
            :class="{ selected: s.color === entry.selected, none: !s.color }"
            :style="{ '--swatch': s.color ?? 'transparent' }"
            :title="s.name"
            @click="(entry.pick(s.color), closeMenu())"
          />
        </div>
        <div
          v-else
          class="item"
          role="menuitem"
          :class="{ disabled: entry.disabled, danger: entry.danger, active: active === i }"
          :aria-disabled="entry.disabled"
          @mouseenter="active = entry.disabled ? -1 : i"
          @click="choose(entry)"
        >
          <span v-if="hasIcons" class="icon-slot"><Icon v-if="entry.icon" :name="entry.icon" :size="14" /></span>
          <span class="label">{{ entry.label }}</span>
          <kbd v-if="entry.shortcut">{{ entry.shortcut }}</kbd>
        </div>
      </template>
    </div>
  </Transition>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 50;
}
.swatches {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
}
.swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--swatch);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 20%);
  transition: transform 0.12s;
}
.swatch:hover:not(:disabled) {
  background: var(--swatch);
  transform: scale(1.12);
}
.swatch.selected {
  box-shadow:
    0 0 0 2px var(--popover),
    0 0 0 3.5px var(--fg-muted);
}
/* "No colour": an outlined circle with a slash. */
.swatch.none {
  background: linear-gradient(135deg, transparent 45%, var(--fg-faint) 45% 55%, transparent 55%);
  box-shadow: inset 0 0 0 1.5px var(--border-strong);
}
.swatch.none.selected {
  box-shadow:
    inset 0 0 0 1.5px var(--border-strong),
    0 0 0 2px var(--popover),
    0 0 0 3.5px var(--fg-muted);
}
</style>
