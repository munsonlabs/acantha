<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toast, hideToast } = useToast()
</script>

<template>
  <Transition name="rise">
    <div v-if="toast" class="toast" :class="toast.kind" role="status" @click="hideToast">
      <span v-if="toast.kind === 'busy'" class="spinner" />
      {{ toast.message }}
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  right: 16px;
  bottom: 40px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(520px, calc(100vw - 32px));
  padding: 9px 14px;
  font-size: 12.5px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--popover);
  box-shadow: var(--shadow);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.toast.error {
  border-color: var(--del);
}
.spinner {
  width: 12px;
  height: 12px;
  flex: none;
  border: 2px solid var(--border-strong);
  border-top-color: var(--fg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
