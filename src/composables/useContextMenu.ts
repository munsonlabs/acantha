import { shallowRef } from 'vue'

export interface MenuItem {
  label: string
  run: () => unknown
  disabled?: boolean
  danger?: boolean
}

export type MenuEntry = MenuItem | 'separator'

const menu = shallowRef<{ x: number; y: number; items: MenuEntry[] } | null>(null)

export function openMenu(e: MouseEvent, items: MenuEntry[]) {
  menu.value = { x: e.clientX, y: e.clientY, items }
}

export function closeMenu() {
  menu.value = null
}

export function useContextMenu() {
  return { menu, openMenu, closeMenu }
}
