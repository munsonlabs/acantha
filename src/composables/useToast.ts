import { shallowRef } from 'vue'

export type ToastKind = 'ok' | 'error' | 'busy'

const toast = shallowRef<{ message: string; kind: ToastKind } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export function showToast(message: string, kind: ToastKind = 'ok') {
  clearTimeout(timer)
  toast.value = { message, kind }
  if (kind !== 'busy') timer = setTimeout(hideToast, kind === 'error' ? 9000 : 3500)
}

export function hideToast() {
  clearTimeout(timer)
  toast.value = null
}

export function useToast() {
  return { toast, showToast, hideToast }
}
