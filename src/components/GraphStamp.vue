<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import logo from '../../icon.svg?url'
import { prefs } from '@/composables/prefs'
import Icon from './Icon.vue'

/**
 * Where the graph was, while it's collapsed: Acantha's logo in black and white, faded into the background like a stamp.
 * Or, for a break, a little game in its place; its code loads only when it's first played.
 */
const MiniGame = defineAsyncComponent(() => import('./MiniGame.vue'))
const playing = ref(false)
</script>

<template>
  <div class="stamp-area">
    <MiniGame v-if="playing" @close="playing = false" />
    <template v-else>
      <img class="stamp" :src="logo" alt="" draggable="false" />
      <div class="actions">
        <button class="ghost" title="Show the graph again" @click="prefs.graphCollapsed.value = false">
          <Icon name="history" :size="13" /> Show graph
        </button>
        <button class="ghost" title="Play Commit Snake while you wait" @click="playing = true"><Icon name="play" :size="13" /> Play</button>
      </div>
    </template>
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
.actions {
  position: absolute;
  bottom: 18%;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}
.actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  color: var(--fg-faint);
  font-size: 12px;
}
.actions button:hover {
  color: var(--fg);
}
.stamp-area:hover .actions,
.actions:focus-within {
  opacity: 1;
}
</style>
