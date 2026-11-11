import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { prefs } from './prefs'

const files = import.meta.glob<string>('../assets/logos/*.svg', { eager: true, query: '?url', import: 'default' })
const url = (id: string) => files[`../assets/logos/${id}.svg`]

/** The logos to pick from in Settings, drawn by scripts/build-icon.mjs. */
export const LOGOS = [
  { id: 'green', label: 'New' },
  { id: 'ink', label: 'Dark' },
  { id: 'classic', label: 'Classic' },
].map((l) => ({ ...l, url: url(l.id) }))

export const logo = computed(() => url(prefs.appLogo.value) ?? url('green'))

/**
 * Puts the chosen logo in the Dock, drawn as a macOS icon: the tile inset, over a soft shadow. Only while Acantha
 * runs: the Dock shows the app's own icon again once it has quit.
 */
export async function showDockIcon() {
  const img = new Image()
  img.src = logo.value
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.shadowColor = 'rgb(0 0 0 / 0.4)'
  ctx.shadowBlur = 20
  ctx.shadowOffsetY = 7
  ctx.drawImage(img, 50, 50, 412, 412)
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done))
  if (blob) await invoke('set_dock_icon', { png: [...new Uint8Array(await blob.arrayBuffer())] })
}
