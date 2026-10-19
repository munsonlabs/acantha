<script setup lang="ts">
/** Placeholder lines shown while something loads, so panes don't flash empty and then jump. */
defineProps<{ lines?: number; gap?: number }>()

const widths = [62, 48, 74, 55, 68, 40, 80, 52, 66, 44, 72, 58]
</script>

<template>
  <div class="skeleton" :style="{ gap: `${gap ?? 12}px` }" aria-busy="true" aria-label="Loading">
    <span v-for="i in lines ?? 8" :key="i" class="line" :style="{ width: `${widths[(i - 1) % widths.length]}%` }" />
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
}
.line {
  height: 10px;
  border-radius: 5px;
  background: linear-gradient(90deg, var(--pill) 0%, var(--selected) 50%, var(--pill) 100%) 0 0 / 200% 100%;
  animation: shimmer 1.4s steps(14, end) infinite;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
