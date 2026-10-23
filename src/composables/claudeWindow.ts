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

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Pops a conversation (`id`, in `repo`) out, at `rect` if it's given, or brings its window to the front. Resolves once
 * the window's there.
 */
export async function popOut(id: string, repo: string, rect?: Rect) {
  const key = label(id)
  const existing = await WebviewWindow.getByLabel(key)
  if (existing) {
    await existing.show()
    return existing.setFocus()
  }
  // Where it's asked to be, where the last one was, or the screen's bottom-right corner.
  const s = window.screen as Screen & { availLeft?: number; availTop?: number }
  const r = rect ??
    prefs.claudeRect.value ?? {
      w: 420,
      h: 640,
      x: (s.availLeft ?? 0) + s.availWidth - 420 - 16,
      y: (s.availTop ?? 0) + s.availHeight - 640 - 12,
    }
  const win = new WebviewWindow(key, {
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
  await new Promise<void>((resolve) => {
    void win.once('tauri://created', () => resolve())
    void win.once('tauri://error', () => resolve())
  })
}

/** Docks a conversation back in the panel, closing its window. */
export async function bringBack(id: string) {
  const key = label(id)
  poppedOut.delete(key)
  await (await WebviewWindow.getByLabel(key))?.close()
}

/**
 * The main window's side: hearing that a window closed (docked back), opening the files Claude points at, and a
 * popped-out window switching to another conversation (popping that one out in its place, docking itself back).
 */
export function connectClaudeWindows() {
  const { workspaces, activate } = useWorkspaces()
  const openRepos = () => [...new Set(workspaces.value.map((w) => w.repo.repo.value).filter((p): p is string => !!p))]
  void listen<string>('claude:docked', ({ payload }) => void poppedOut.delete(payload))
  void listen<string>('claude:repos', ({ payload }) => void emitTo(payload, 'claude:repos', openRepos()))
  async function swap(from: string, to: string, repo: string, rect: Rect) {
    const already = isPoppedOut(to)
    await popOut(to, repo, rect)
    if (!already) await bringBack(from)
  }
  void listen<{ from: string; to: string; repo: string; rect: Rect }>('claude:switch', ({ payload: p }) => void swap(p.from, p.to, p.repo, p.rect))
  void listen<{ from: string; repo: string; rect: Rect }>('claude:new', ({ payload: p }) => {
    const ws = workspaces.value.find((w) => w.repo.repo.value === p.repo)
    if (ws) void swap(p.from, ws.panel.addClaude(true), p.repo, p.rect)
  })
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

/** From a popped-out window: the repositories open in Acantha, to start a conversation in. */
export async function askOpenRepos(self: string) {
  const win = getCurrentWindow()
  return new Promise<string[]>((resolve) => {
    let done: (() => void) | undefined
    const timeout = setTimeout(() => (done?.(), resolve([])), 800)
    void win
      .once<string[]>('claude:repos', ({ payload }) => {
        clearTimeout(timeout)
        resolve(payload)
      })
      .then((u) => (done = u))
    void emitTo('main', 'claude:repos', self)
  })
}

/** From a popped-out window: show another conversation in its place, or start a new one in `repo`. */
export const switchTo = (from: string, to: string, repo: string, rect: Rect) => emitTo('main', 'claude:switch', { from, to, repo, rect })
export const startIn = (from: string, repo: string, rect: Rect) => emitTo('main', 'claude:new', { from, repo, rect })
