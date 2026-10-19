import { shallowRef } from 'vue'

export type ToastKind = 'ok' | 'error' | 'busy'

export interface ToastAction {
  label: string
  run: () => unknown
}

const toast = shallowRef<{ message: string; kind: ToastKind; action?: ToastAction } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

/** Shows a message. An action, like Undo, keeps it on screen a little longer so there's time to use it. */
export function showToast(message: string, kind: ToastKind = 'ok', action?: ToastAction) {
  clearTimeout(timer)
  toast.value = { message, kind, action }
  if (kind !== 'busy') timer = setTimeout(hideToast, kind === 'error' ? 9000 : action ? 8000 : 3500)
}

export function hideToast() {
  clearTimeout(timer)
  toast.value = null
}

export function useToast() {
  return { toast, showToast, hideToast }
}
