<script setup lang="ts">
import { ref, watch } from 'vue'
import { avatarUrl } from '@/lib/avatars'
import { initials, nameHue } from '@/lib/format'
import { prefs } from '@/composables/prefs'

const props = defineProps<{ name: string; email: string; size?: number }>()

const src = ref<string | null>(null)
const failed = ref(false)

watch(
  () => [props.email, prefs.avatars.value] as const,
  async ([email, enabled]) => {
    src.value = null
    failed.value = false
    if (!enabled) return
    const url = await avatarUrl(email)
    if (email === props.email) src.value = url
  },
  { immediate: true },
)
</script>

<template>
  <span class="avatar" :style="{ '--hue': nameHue(name), '--size': `${size ?? 16}px` }">
    <img v-if="src && !failed" :src="src" alt="" loading="lazy" draggable="false" @error="failed = true" />
    <template v-else>{{ initials(name) }}</template>
  </span>
</template>

<style scoped>
.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--size);
  height: var(--size);
  overflow: hidden;
  border-radius: 4px;
  background: hsl(var(--hue) 55% 62%);
  color: #141414;
  font-size: calc(var(--size) * 0.53);
  font-weight: 700;
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
