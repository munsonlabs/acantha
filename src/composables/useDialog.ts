import { shallowRef } from 'vue'

export interface DialogField {
  name: string
  label: string
  type?: 'text' | 'checkbox' | 'select'
  value?: string | boolean
  required?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface DialogOptions {
  title: string
  /** Plain text. Segments wrapped in backticks render as code. */
  message?: string
  fields?: DialogField[]
  confirm?: string
  danger?: boolean
}

export type DialogValues = Record<string, any>

const current = shallowRef<(DialogOptions & { resolve: (values: DialogValues | null) => void }) | null>(null)

/** Shows a modal form. Resolves with the field values, or null when cancelled. */
export function ask(options: DialogOptions): Promise<DialogValues | null> {
  current.value?.resolve(null)
  return new Promise((resolve) => {
    current.value = { ...options, resolve }
  })
}

export const confirmAction = (title: string, message: string, confirm: string, danger = false) =>
  ask({ title, message, confirm, danger }).then((v) => v !== null)

export function closeDialog(values: DialogValues | null) {
  const dialog = current.value
  current.value = null
  dialog?.resolve(values)
}

export function useDialog() {
  return { current, ask, closeDialog }
}
