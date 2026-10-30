<script setup lang="ts">
import { resetsText, type PlanLimit } from '@/lib/usage'

/** Plan limits as bars: how much of each is used, and when it starts over. */
defineProps<{ limits: PlanLimit[] }>()
</script>

<template>
  <div class="usage-bars">
    <div v-for="l in limits" :key="l.label" class="limit" :class="{ warn: l.warn || l.percent >= 90 }">
      <div class="line">
        <span class="label">{{ l.label }}</span>
        <span class="percent">{{ l.percent }}%</span>
      </div>
      <div class="bar" role="meter" :aria-label="l.label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="l.percent">
        <div class="fill" :style="{ width: `${l.percent}%` }" />
      </div>
      <span v-if="l.resetsAt" class="resets">{{ resetsText(l.resetsAt) }}</span>
    </div>
  </div>
</template>

<style scoped>
.usage-bars {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}
.label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.percent {
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.bar {
  height: 5px;
  margin: 4px 0 3px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--pill);
}
.fill {
  height: 100%;
  border-radius: 3px;
  background: var(--claude);
  transition: width 0.3s;
}
.warn .fill {
  background: var(--del);
}
.resets {
  color: var(--fg-faint);
  font-size: 10.5px;
}
</style>
