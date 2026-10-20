import { parseSlackLink } from '@/lib/slack'
import { looksLikeList, parseLines } from '@/lib/todos'
import { prefs } from './prefs'
import { ask } from './useDialog'
import { showToast } from './useToast'
import type { Workspace } from './workspace'

/** Opens a Slack message or canvas link in a panel tab. Returns false when it isn't one. */
export function openSlackLink(ws: Workspace, text: string) {
  if (!parseSlackLink(text)) return false
  ws.panel.addSlack(text.trim())
  return true
}

/**
 * What a paste outside a text box can become: a Slack link opens in the panel, and a list (two or more bullet or
 * numbered lines) becomes a new to-do list of all its lines. Returns false for anything else.
 */
export function pasteIntoPanel(ws: Workspace, text: string) {
  if (openSlackLink(ws, text)) return true
  if (!looksLikeList(text)) return false
  const items = parseLines(text)
  ws.panel.addTodos('To-dos', items)
  showToast(`Made a to-do list of ${items.length} items`)
  return true
}

/** Shows or hides the panel; from the expanded view, puts it back under the terminal. */
export function togglePanel(ws: Workspace) {
  if (ws.panel.expanded.value) {
    ws.panel.expanded.value = false
    prefs.panelOpen.value = true
  } else {
    prefs.panelOpen.value = !prefs.panelOpen.value
  }
}

export async function promptSlackLink(ws: Workspace) {
  const values = await ask({
    title: 'Open Slack Link',
    message: 'Paste a link to a message (Copy link on the message) or a canvas.',
    fields: [{ name: 'link', label: 'Link', placeholder: 'https://….slack.com/archives/…', required: true }],
    confirm: 'Open',
  })
  if (values && !openSlackLink(ws, String(values.link))) showToast("That isn't a Slack message or canvas link", 'error')
}
