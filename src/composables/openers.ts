import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { prefs } from './prefs'
import { showToast } from './useToast'
import type { MenuEntry } from './useContextMenu'

/** "Open in…" actions for repositories, folders and files, shared by every right-click menu that offers them. */

const fail = (what: string) => (e: unknown) => showToast(`Couldn't ${what}: ${String(e)}`, 'error')

export const editorLabel = () => (prefs.externalEditor.value ? `Open in ${prefs.externalEditor.value}` : 'Open in Default Editor')

export const openInEditor = (path: string) => openPath(path, prefs.externalEditor.value || undefined).catch(fail('open it'))
export const openWithDefault = (path: string) => openPath(path).catch(fail('open it'))
export const revealInFinder = (path: string) => revealItemInDir(path).catch(fail('show it in Finder'))
export const openFolder = (path: string) => openPath(path).catch(fail('open the folder'))
export const openInTerminalApp = (dir: string) => openPath(dir, 'Terminal').catch(fail('open Terminal'))

async function copy(text: string, what: string) {
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
    { label: editorLabel(), disabled: !exists, run: () => openInEditor(abs) },
    { label: 'Open with Default App', disabled: !exists, run: () => openWithDefault(abs) },
    { label: 'Reveal in Finder', disabled: !exists, run: () => revealInFinder(abs) },
    'separator',
    { label: 'Copy Path', run: () => copy(abs, 'path') },
    { label: 'Copy Relative Path', run: () => copy(rel, 'relative path') },
  ]
}

/** For a folder: the repository itself, or one inside it. `newTerminal` opens an Acantha terminal tab there. */
export function folderOpenItems(abs: string, newTerminal?: () => void): MenuEntry[] {
  return [
    { label: 'Open in Finder', run: () => openFolder(abs) },
    { label: editorLabel(), run: () => openInEditor(abs) },
    { label: 'Open in Terminal', run: () => openInTerminalApp(abs) },
    ...(newTerminal ? [{ label: 'New Terminal Here', run: newTerminal }] : []),
    'separator',
    { label: 'Copy Path', run: () => copy(abs, 'path') },
  ]
}
