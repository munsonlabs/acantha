<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useContextMenu, type MenuItem } from '@/composables/useContextMenu'

const { menu, closeMenu } = useContextMenu()
const el = ref<HTMLElement>()
const pos = ref({ left: 0, top: 0 })

// Keep the menu on screen once its size is known.
watch(menu, async (m) => {
  if (!m) return
  pos.value = { left: m.x, top: m.y }
  await nextTick()
  const rect = el.value!.getBoundingClientRect()
  pos.value = {
    left: Math.max(4, Math.min(m.x, window.innerWidth - rect.width - 4)),
    top: Math.max(4, Math.min(m.y, window.innerHeight - rect.height - 4)),
  }
})

function choose(item: MenuItem) {
  if (item.disabled) return
  closeMenu()
  item.run()
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
    <div v-if="menu" ref="el" class="menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @contextmenu.prevent>
      <template v-for="(item, i) in menu.items" :key="i">
        <div v-if="item === 'separator'" class="separator" />
        <div v-else-if="'swatches' in item" class="swatches">
          <button
            v-for="s in item.swatches"
            :key="s.name"
            class="swatch"
            :class="{ selected: s.color === item.selected, none: !s.color }"
            :style="{ '--swatch': s.color ?? 'transparent' }"
            :title="s.name"
            @click="(item.pick(s.color), closeMenu())"
          />
        </div>
        <div v-else class="item" :class="{ disabled: item.disabled, danger: item.danger }" @click="choose(item)">{{ item.label }}</div>
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
