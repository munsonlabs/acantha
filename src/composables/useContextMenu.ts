import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { shallowRef } from 'vue'
import type { IconName } from '@/lib/icons'
import { parseLines } from '@/lib/todos'
import { isOn } from '@/features'

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
/** Set by the app: turns selected text into a to-do list in the active repository's panel. */
let makeTodos: ((items: ReturnType<typeof parseLines>) => void) | null = null
export const onMakeTodos = (fn: typeof makeTodos) => (makeTodos = fn)

/** "Make To-do List" for selected text, each line one to-do. */
function todoItem(selection: string): MenuEntry[] {
  const items = parseLines(selection)
  if (!makeTodos || !items.length || !isOn('todos')) return []
  const make = makeTodos
  return [{ label: items.length === 1 ? 'Make To-do' : `Make To-do List (${items.length})`, icon: 'check', run: () => make(items) }]
}

export function replaceNativeMenu() {
  window.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return
    e.preventDefault()
    const target = e.target as Element
    const field = target.closest<HTMLElement>('input, textarea, [contenteditable]:not([contenteditable="false"])')
    if (field) return openMenu(e, editMenu(field))
    const items = readMenu(target)
    if (items.length) openMenu(e, items)
  })
}

/**
 * Outside text fields: Copy for selected text (in a message, canvas, preview or diff), and Open / Copy for a link.
 * Clicking a link through the menu goes through the page's own handler, so Slack links still open in the panel.
 */
function readMenu(target: Element): MenuEntry[] {
  const selection = window.getSelection()?.toString() ?? ''
  const link = target.closest<HTMLAnchorElement>('a[href]')
  const items: MenuEntry[] = []
  if (link) {
    items.push(
      { label: 'Open Link', icon: 'external', run: () => link.click() },
      { label: 'Copy Link', icon: 'copy', run: () => navigator.clipboard.writeText(link.href) },
    )
  }
  if (selection.trim()) {
    if (items.length) items.push('separator')
    items.push({ label: 'Copy', shortcut: '⌘C', run: () => navigator.clipboard.writeText(selection) }, ...todoItem(selection))
  }
  // Text you can select (messages, canvases, previews) gets Select All for that block.
  const block = target.closest<HTMLElement>('.canvas, .markdown, .code') ?? target.closest<HTMLElement>('.slack-view .text')
  if (block) {
    if (items.length) items.push('separator')
    items.push({
      label: 'Select All',
      shortcut: '⌘A',
      run: () => {
        const range = document.createRange()
        range.selectNodeContents(block)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      },
    })
  }
  return items
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
    ...todoItem(selection),
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
