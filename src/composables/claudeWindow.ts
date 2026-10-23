import { reactive } from 'vue'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { prefs } from './prefs'
import { pathOf, useWorkspaces } from './workspace'

/**
 * Popping a Claude conversation out of the panel into a window of its own: chat bubbles floating in a corner of the
 * screen, pinned over other apps. Closing it docks it back. The main window keeps track of which are out.
 */

/** A conversation's window label (the backend closes it by this when the conversation ends). Ids are tab ids, letters and digits. */
const label = (id: string) => `claude-${id}`

/** The conversations in their own windows now, by window label. */
const poppedOut = reactive(new Map<string, string>())
export const isPoppedOut = (id: string) => poppedOut.has(label(id))

/** Pops a conversation (`id`, in `repo`) out, or brings its window to the front. */
export async function popOut(id: string, repo: string) {
  const key = label(id)
  const existing = await WebviewWindow.getByLabel(key)
  if (existing) {
    await existing.show()
    return existing.setFocus()
  }
  // Where the last one was, or the screen's bottom-right corner.
  const s = window.screen as Screen & { availLeft?: number; availTop?: number }
  const r = prefs.claudeRect.value ?? {
    w: 420,
    h: 640,
    x: (s.availLeft ?? 0) + s.availWidth - 420 - 16,
    y: (s.availTop ?? 0) + s.availHeight - 640 - 12,
  }
  new WebviewWindow(key, {
    url: `index.html?window=claude&conv=${encodeURIComponent(id)}&repo=${encodeURIComponent(repo)}`,
    title: `Claude · ${repo.split('/').pop()}`,
    width: r.w,
    height: r.h,
    x: r.x,
    y: r.y,
    minWidth: 340,
    minHeight: 380,
    // No frame and nothing behind: the page's bubbles float on whatever's underneath.
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: prefs.claudeOnTop.value,
  })
  poppedOut.set(key, id)
}

/** Docks a conversation back in the panel, closing its window. */
export async function bringBack(id: string) {
  const key = label(id)
  poppedOut.delete(key)
  await (await WebviewWindow.getByLabel(key))?.close()
}

/** The main window's side: hearing that a window closed (docked back), and opening the files Claude points at. */
export function connectClaudeWindows() {
  const { workspaces, activate } = useWorkspaces()
  void listen<string>('claude:docked', ({ payload }) => void poppedOut.delete(payload))
  void listen<{ repo: string; path: string }>('claude:open-file', async ({ payload }) => {
    const ws = workspaces.value.find((w) => pathOf(w) === payload.repo)
    if (!ws) return
    activate(ws.id)
    await getCurrentWindow().setFocus()
    void ws.files.open(payload.path)
  })
}

/** From a popped-out window: open a file in the main window. */
export const openInMain = (repo: string, path: string) => emitTo('main', 'claude:open-file', { repo, path })
