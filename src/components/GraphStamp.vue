<script setup lang="ts">
import logo from '../../icon.svg?url'
import { prefs } from '@/composables/prefs'
import Icon from './Icon.vue'

/** Where the graph was, while it's collapsed: Acantha's logo in black and white, faded into the background like a stamp. */
</script>

<template>
  <div class="stamp-area">
    <img class="stamp" :src="logo" alt="" draggable="false" />
    <button class="ghost show" title="Show the graph again" @click="prefs.graphCollapsed.value = false">
      <Icon name="history" :size="13" /> Show graph
    </button>
  </div>
</template>

<style scoped>
.stamp-area {
  position: relative;
  display: grid;
  min-width: 0;
  place-items: center;
}
.stamp {
  width: min(140px, 30%);
  filter: grayscale(1) contrast(1.15);
  opacity: 0.11;
  user-select: none;
  pointer-events: none;
}
@media (prefers-color-scheme: light) {
  .stamp {
    opacity: 0.08;
  }
}
.show {
  position: absolute;
  bottom: 18%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  color: var(--fg-faint);
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}
.stamp-area:hover .show,
.show:focus-visible {
  opacity: 1;
}
</style>
