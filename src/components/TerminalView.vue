<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { openUrl } from '@tauri-apps/plugin-opener'
import '@xterm/xterm/css/xterm.css'
import { pty } from '@/lib/pty'
import type { TerminalSession } from '@/composables/terminals'
import { showToast } from '@/composables/useToast'

const props = defineProps<{ session: TerminalSession; active: boolean }>()
const emit = defineEmits<{ exit: []; title: [title: string] }>()

/** App shortcuts that should reach the window instead of the shell. */
const APP_KEYS = new Set(['t', 'w', 'j', 'f', 'r', 'o', '[', ']', '{', '}', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

const el = ref<HTMLElement>()
let term: Terminal | null = null
let fit: FitAddon | null = null
let ptyId: number | null = null
let observer: ResizeObserver | null = null
let disposed = false
const scheme = window.matchMedia('(prefers-color-scheme: dark)')

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function theme(): ITheme {
  const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  const colors = Object.fromEntries(
    ansi.flatMap((c) => [
      [c, css(`--ansi-${c}`)],
      [`bright${c[0].toUpperCase()}${c.slice(1)}`, css(`--ansi-bright-${c}`)],
    ]),
  )
  return {
    background: css('--bg'),
    foreground: css('--fg'),
    cursor: css('--fg'),
    cursorAccent: css('--bg'),
    selectionBackground: css('--term-selection'),
    ...colors,
  }
}

const fitNow = () => {
  if (el.value && el.value.offsetWidth > 0 && el.value.offsetHeight > 0) fit?.fit()
}
const updateTheme = () => term && (term.options.theme = theme())

onMounted(async () => {
  await document.fonts.load('13px "JetBrains Mono"').catch(() => {})
  if (disposed) return

  term = new Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    fontSize: 12.5,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    macOptionIsMeta: true,
    scrollback: 10_000,
    theme: theme(),
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon((e, uri) => e.metaKey && void openUrl(uri)))
  term.open(el.value!)
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // The DOM renderer is a fine fallback.
  }
  fitNow()

  term.attachCustomKeyEventHandler((e) => {
    if (!e.metaKey || e.type !== 'keydown') return true
    if (e.key === 'k') {
      term!.clear()
      return false
    }
    return !APP_KEYS.has(e.key.toLowerCase())
  })

  try {
    const { id, shell } = await pty.spawn(props.session.cwd, term.cols, term.rows, (e) => {
      if (e.type === 'data') term?.write(e.data)
      else emit('exit')
    })
    if (disposed) return void pty.kill(id)
    ptyId = id
    emit('title', shell)
  } catch (e) {
    showToast(`Could not start a shell: ${e}`, 'error')
    return emit('exit')
  }

  term.onData((data) => ptyId && void pty.write(ptyId, data))
  term.onResize(({ cols, rows }) => ptyId && void pty.resize(ptyId, cols, rows))
  term.onTitleChange((title) => title && emit('title', title))
  observer = new ResizeObserver(fitNow)
  observer.observe(el.value!)
  scheme.addEventListener('change', updateTheme)
  if (props.active) term.focus()
})

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    fitNow()
    term?.focus()
  },
)

onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  scheme.removeEventListener('change', updateTheme)
  if (ptyId) void pty.kill(ptyId)
  term?.dispose()
})

defineExpose({ focus: () => term?.focus() })
</script>

<template>
  <div ref="el" class="terminal-view" />
</template>

<style scoped>
.terminal-view {
  position: absolute;
  inset: 8px 4px 4px 12px;
}
.terminal-view :deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
</style>
