import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { prefs } from './prefs'
import { showToast } from './useToast'
import type { MenuEntry, MenuItem } from './useContextMenu'

/** "Open in…" actions for repositories, folders and files, shared by every right-click menu that offers them. */

const fail = (what: string) => (e: unknown) => showToast(`Couldn't ${what}: ${String(e)}`, 'error')

export const editorLabel = () => (prefs.externalEditor.value ? `Open in ${prefs.externalEditor.value}` : 'Open in Default Editor')

export const openInEditor = (path: string) => openPath(path, prefs.externalEditor.value || undefined).catch(fail('open it'))
export const openWithDefault = (path: string) => openPath(path).catch(fail('open it'))
export const revealInFinder = (path: string) => revealItemInDir(path).catch(fail('show it in Finder'))
export const openFolder = (path: string) => openPath(path).catch(fail('open the folder'))
export const openInTerminalApp = (dir: string) => openPath(dir, 'Terminal').catch(fail('open Terminal'))

/** Copies text, saying what was copied. */
export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`Copied ${what}`)
  } catch (e) {
    showToast(String(e), 'error')
  }
}

/** For a file in the working tree. */
export function fileOpenItems(repo: string, rel: string, { exists = true } = {}): MenuEntry[] {
  const abs = `${repo}/${rel}`
  return [
    { label: editorLabel(), icon: 'pencil', disabled: !exists, run: () => openInEditor(abs) },
    { label: 'Open with Default App', icon: 'app', disabled: !exists, run: () => openWithDefault(abs) },
    { label: 'Reveal in Finder', icon: 'folder', disabled: !exists, run: () => revealInFinder(abs) },
    'separator',
    { label: 'Copy Path', icon: 'copy', run: () => copyText(abs, 'path') },
    { label: 'Copy Relative Path', icon: 'copy', run: () => copyText(rel, 'relative path') },
  ]
}

/** For a folder: the repository itself, or one inside it. `newTerminal` opens an Acantha terminal tab there. */
export function folderOpenItems(abs: string, newTerminal?: () => void): MenuEntry[] {
  return [
    { label: 'Open in Finder', icon: 'folder', run: () => openFolder(abs) },
    { label: editorLabel(), icon: 'pencil', run: () => openInEditor(abs) },
    { label: 'Open in Terminal', icon: 'terminal', run: () => openInTerminalApp(abs) },
    ...(newTerminal ? [{ label: 'New Terminal Here', icon: 'terminal', run: newTerminal } satisfies MenuItem] : []),
    'separator',
    { label: 'Copy Path', icon: 'copy', run: () => copyText(abs, 'path') },
  ]
}
