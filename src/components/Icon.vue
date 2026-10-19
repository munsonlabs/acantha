<script setup lang="ts">
import { ICON_PATHS, type IconName } from '@/lib/icons'

defineProps<{ name: IconName; size?: number }>()
</script>

<template>
  <svg class="icon" :width="size ?? 14" :height="size ?? 14" viewBox="0 0 24 24" aria-hidden="true">
    <path :d="ICON_PATHS[name]" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
