import { readText } from '@tauri-apps/plugin-clipboard-manager'
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

/**
 * WebKit's own right-click menu offers things that do nothing here, like "Show Fonts". Wherever the app hasn't shown
 * a menu of its own, text fields get a plain editing menu instead and everything else gets none.
 */
export function replaceNativeMenu() {
  window.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return
    e.preventDefault()
    const field = (e.target as Element).closest<HTMLElement>('input, textarea, [contenteditable]:not([contenteditable="false"])')
    if (field) openMenu(e, editMenu(field))
  })
}

function editMenu(field: HTMLElement): MenuEntry[] {
  const text = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
  const selection = text ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0) : (window.getSelection()?.toString() ?? '')
  const editable = field.matches(':read-write')
  // The menu takes focus, so each item hands it back to the field (which keeps its selection) before editing.
  const edit = (command: string, value?: string) => {
    field.focus()
    document.execCommand(command, false, value)
  }
  const copy = () => navigator.clipboard.writeText(selection)
  return [
    { label: 'Cut', shortcut: '⌘X', disabled: !selection || !editable, run: async () => (await copy(), edit('delete')) },
    { label: 'Copy', shortcut: '⌘C', disabled: !selection, run: copy },
    {
      label: 'Paste',
      shortcut: '⌘V',
      disabled: !editable,
      run: async () => edit('insertText', await readText().catch(() => navigator.clipboard.readText())),
    },
    'separator',
    { label: 'Select All', shortcut: '⌘A', run: () => (text ? (field.focus(), field.select()) : edit('selectAll')) },
  ]
}
