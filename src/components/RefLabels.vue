<script setup lang="ts">
import type { RefGroup } from '@/composables/repo'

defineProps<{ refs: RefGroup | undefined; color: string; headBranch: string | null; detached: boolean }>()
</script>

<template>
  <span v-if="detached" class="ref detached" title="Detached HEAD">HEAD</span>
  <template v-if="refs">
    <span
      v-for="b in refs.branches"
      :key="b.name"
      class="ref branch"
      :class="{ current: b.name === headBranch }"
      :style="{ '--ref-color': color }"
      data-ref-kind="branch"
      :data-ref-name="b.name"
      :title="b.name === headBranch ? `${b.name} (checked out)` : b.name"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M5 9c0-3 6-2 6-6" /></svg>
      {{ b.name }}
      <span
        v-for="r in b.remotes"
        :key="r"
        class="ref-remote"
        data-ref-kind="remote"
        :data-ref-remote="r"
        :data-ref-name="b.name"
        :title="`${r}/${b.name}`"
        >{{ r }}</span
      >
    </span>
    <span
      v-for="r in refs.remotes"
      :key="`${r.remote}/${r.name}`"
      class="ref remote"
      :style="{ '--ref-color': color }"
      data-ref-kind="remote"
      :data-ref-remote="r.remote"
      :data-ref-name="r.name"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M5 9c0-3 6-2 6-6" /></svg>
      {{ r.remote }}/{{ r.name }}
    </span>
    <span v-for="t in refs.tags" :key="t" class="ref tag" data-ref-kind="tag" :data-ref-name="t">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h5.5l5.5 5.5-5.5 5.5-5.5-5.5zM5.5 5.5h.01" /></svg>
      {{ t }}
    </span>
  </template>
</template>

<style scoped>
.ref {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 18px;
  margin-right: 6px;
  padding: 0 6px 0 5px;
  border: 1px solid color-mix(in oklab, var(--ref-color, var(--fg-muted)) 35%, transparent);
  border-radius: 5px;
  background: color-mix(in oklab, var(--ref-color, var(--fg-muted)) 12%, transparent);
  color: color-mix(in oklab, var(--ref-color, var(--fg-muted)) 65%, var(--fg));
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.ref svg {
  width: 11px;
  height: 11px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ref.current {
  border-color: color-mix(in oklab, var(--ref-color) 70%, transparent);
  background: color-mix(in oklab, var(--ref-color) 22%, transparent);
  color: var(--fg);
}
.ref.remote {
  border-style: dashed;
  background: transparent;
  font-weight: 400;
}
.ref.tag {
  --ref-color: var(--tag);
}
.ref.detached {
  --ref-color: var(--fg-muted);
  padding: 0 6px;
}
.ref-remote {
  margin-left: 2px;
  padding-left: 5px;
  border-left: 1px solid color-mix(in oklab, var(--ref-color) 35%, transparent);
  font-weight: 400;
  opacity: 0.75;
}
</style>
