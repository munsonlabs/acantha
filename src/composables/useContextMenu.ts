import { shallowRef } from 'vue'
import type { IconName } from '@/lib/icons'

export interface MenuItem {
  label: string
  run: () => unknown
  icon?: IconName
  /** A keyboard shortcut to show beside the label, e.g. "⌘T". */
  shortcut?: string
  disabled?: boolean
  danger?: boolean
}

/** A row of colour swatches, like the one for picking a tab's colour. A null colour means none. */
export interface MenuSwatches {
  swatches: { color: string | null; name: string }[]
  selected: string | null
  pick: (color: string | null) => void
}

/** A title at the top of a menu saying what it's for: a commit, branch or file. */
export interface MenuHeader {
  header: string
  detail?: string
}

export type MenuEntry = MenuItem | MenuSwatches | MenuHeader | 'separator'

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
