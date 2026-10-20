import { parseSlackLink } from '@/lib/slack'
import { prefs } from './prefs'
import { ask } from './useDialog'
import { showToast } from './useToast'
import type { Workspace } from './workspace'

/**
 * Opens a Slack message or canvas link in the panel under the terminal, or in place of the graph when it's been
 * expanded there. Returns false when it isn't one.
 */
export async function openSlackLink(ws: Workspace, text: string) {
  const link = parseSlackLink(text)
  if (!link) return false
  if (ws.ui.slackExpanded.value && ws.files.preview.value) {
    await ws.files.closePreview()
    if (ws.files.preview.value) return true // kept open for unsaved edits
  }
  ws.ui.slack.value = { url: text.trim(), link }
  if (!ws.ui.slackExpanded.value) prefs.slackOpen.value = true
  return true
}

/** Shows or hides the Slack panel; from the expanded view, puts it back under the terminal. */
export function toggleSlackPanel(ws: Workspace) {
  if (ws.ui.slackExpanded.value) {
    ws.ui.slackExpanded.value = false
    prefs.slackOpen.value = true
  } else {
    prefs.slackOpen.value = !prefs.slackOpen.value
  }
}

export async function promptSlackLink(ws: Workspace) {
  const values = await ask({
    title: 'Open Slack Link',
    message: 'Paste a link to a message (Copy link on the message) or a canvas.',
    fields: [{ name: 'link', label: 'Link', placeholder: 'https://….slack.com/archives/…', required: true }],
    confirm: 'Open',
  })
  if (values && !(await openSlackLink(ws, String(values.link)))) showToast("That isn't a Slack message or canvas link", 'error')
}
