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
</style>
