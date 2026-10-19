import { shallowRef } from 'vue'

export interface MenuItem {
  label: string
  run: () => unknown
  disabled?: boolean
  danger?: boolean
}

/** A row of colour swatches, like the one for picking a tab's colour. A null colour means none. */
export interface MenuSwatches {
  swatches: { color: string | null; name: string }[]
  selected: string | null
  pick: (color: string | null) => void
}

export type MenuEntry = MenuItem | MenuSwatches | 'separator'

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
