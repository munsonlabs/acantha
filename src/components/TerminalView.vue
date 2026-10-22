<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal, type ILink, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { openUrl } from '@tauri-apps/plugin-opener'
import '@xterm/xterm/css/xterm.css'
import { pty } from '@/lib/pty'
import { findFileRefs, resolveFileRef } from '@/lib/termLinks'
import { prefs } from '@/composables/prefs'
import type { TerminalSession } from '@/composables/terminals'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

/** focus: take the keyboard when shown; the terminal split beside a tab's own leaves it to that one. */
const props = withDefaults(defineProps<{ session: TerminalSession; active: boolean; focus?: boolean }>(), { focus: true })
const emit = defineEmits<{ exit: []; title: [title: string]; split: [] }>()

/** App shortcuts that should reach the window instead of the shell. */
const APP_KEYS = new Set(['t', 'w', 'j', 'b', 'f', 'r', 'o', '[', ']', '{', '}', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

const el = ref<HTMLElement>()
let term: Terminal | null = null
let fit: FitAddon | null = null
let ptyId: number | null = null
let observer: ResizeObserver | null = null
let disposed = false
const scheme = window.matchMedia('(prefers-color-scheme: dark)')

const ws = useWorkspace()

/**
 * Find in the terminal (⌘F while it has focus): matches highlighted through the scrollback, Enter and ⇧Enter or the
 * arrows to step through them, Esc to close and go back to the shell.
 */
let search: SearchAddon | null = null
const finding = ref(false)
const query = ref('')
const caseSensitive = ref(false)
const results = ref<{ index: number; count: number } | null>(null)
const findInput = ref<HTMLInputElement>()

/** Highlight colours as the addon wants them: #RRGGBB, picked for the light or dark theme. */
const highlights = () =>
  scheme.matches
    ? { matchBackground: '#5c4a1c', activeMatchBackground: '#c9952e', matchOverviewRuler: '#e0b34d', activeMatchColorOverviewRuler: '#ffffff' }
    : { matchBackground: '#f5e2b0', activeMatchBackground: '#e0a930', matchOverviewRuler: '#a37413', activeMatchColorOverviewRuler: '#000000' }

function find(backwards = false) {
  if (!search) return
  if (!query.value) {
    search.clearDecorations()
    results.value = null
    return
  }
  const options = { caseSensitive: caseSensitive.value, decorations: highlights() }
  if (backwards) search.findPrevious(query.value, options)
  else search.findNext(query.value, options)
}

async function openFind() {
  finding.value = true
  // Start from what's selected in the terminal, as a find box usually does.
  const selected = term?.getSelection().trim()
  if (selected && !selected.includes('\n')) query.value = selected
  await nextTick()
  findInput.value?.select()
  find()
}

function closeFind() {
  finding.value = false
  search?.clearDecorations()
  results.value = null
  term?.focus()
}

function onFindKey(e: KeyboardEvent) {
  if (e.key === 'Enter') find(e.shiftKey)
  else if (e.key === 'Escape') closeFind()
  else if (e.key === 'f' && e.metaKey) findInput.value?.select()
  else return
  e.preventDefault()
  e.stopPropagation()
}
const known = computed(() => new Set(ws.files.list.value))

/**
 * Paths in the output that name a file in the repository (`src/x.ts:42:7`, `./App.vue`, `README.md`) are links: ⌘-click
 * opens the file at that line, like ⌘-click opens a web link.
 */
function fileLinks(y: number, callback: (links: ILink[] | undefined) => void) {
  const root = ws.repo.repo.value
  const text = term?.buffer.active.getLine(y - 1)?.translateToString(true)
  if (!root || !text) return callback(undefined)
  const links = findFileRefs(text).flatMap((ref): ILink[] => {
    const path = resolveFileRef(ref.path, root, props.session.cwd, ws.files.list.value, known.value)
    if (!path) return []
    return [
      {
        range: { start: { x: ref.start + 1, y }, end: { x: ref.end, y } },
        text: text.slice(ref.start, ref.end),
        decorations: { pointerCursor: true, underline: true },
        activate: (e) => e.metaKey && void ws.files.open(path, undefined, null, ref.line),
      },
    ]
  })
  callback(links.length ? links : undefined)
}

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

/**
 * Refitting resizes the terminal's canvas, which blanks it until the next draw, so doing it on every frame of a drag
 * made the text flash. While a panel edge is being dragged the terminal keeps its layout and refits once on release
 * (`panel-resize-end`); other size changes (the window, a panel sliding open) refit once the size settles. The shell
 * also hears about a new size only once it has settled, since each one makes it redraw its prompt.
 */
let fitTimer: ReturnType<typeof setTimeout> | undefined
let ptyTimer: ReturnType<typeof setTimeout> | undefined
const fitNow = () => {
  clearTimeout(fitTimer)
  if (document.body.classList.contains('resizing') || document.body.classList.contains('resizing-rows')) return
  fitTimer = setTimeout(() => {
    if (el.value && el.value.offsetWidth > 0 && el.value.offsetHeight > 0) fit?.fit()
  }, 80)
}
const updateTheme = () => term && (term.options.theme = theme())

/**
 * The WebGL renderer draws each letter once into a texture and reuses it. Letters drawn while a font was still
 * loading, or before the display's scale changed (another screen, waking from sleep), stay slightly off, so the text
 * looks wobbly until something redraws it, like selecting it. Those times, the texture is thrown away and redrawn.
 */
const redraw = () => {
  if (!term) return
  term.clearTextureAtlas()
  term.refresh(0, term.rows - 1)
}
const onVisible = () => document.visibilityState === 'visible' && redraw()
let scale: MediaQueryList | null = null
function watchScale() {
  scale?.removeEventListener('change', onScale)
  scale = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  scale.addEventListener('change', onScale)
}
function onScale() {
  redraw()
  watchScale()
}

onMounted(async () => {
  // Both weights: bold drawn in a stand-in font until JetBrains Mono's arrives looks out of line.
  const size = prefs.terminalFontSize.value
  await Promise.all([document.fonts.load(`${size}px "JetBrains Mono"`), document.fonts.load(`bold ${size}px "JetBrains Mono"`)]).catch(() => {})
  if (disposed) return

  term = new Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    fontSize: prefs.terminalFontSize.value,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    macOptionIsMeta: true,
    scrollback: prefs.terminalScrollback.value,
    theme: theme(),
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  search = new SearchAddon()
  term.loadAddon(search)
  search.onDidChangeResults((r) => (results.value = r.resultCount ? { index: r.resultIndex, count: r.resultCount } : { index: -1, count: 0 }))
  term.loadAddon(new WebLinksAddon((e, uri) => e.metaKey && void openUrl(uri)))
  term.registerLinkProvider({ provideLinks: fileLinks })
  // Links are checked against the repository's files, which the sidebar may not have loaded yet.
  if (!ws.files.list.value.length) void ws.files.load()
  term.open(el.value!)
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // The DOM renderer is a fine fallback.
  }
  // Straight away, not on the next frame: the shell starts at this size.
  if (el.value && el.value.offsetWidth > 0 && el.value.offsetHeight > 0) fit?.fit()

  term.attachCustomKeyEventHandler((e) => {
    if (!e.metaKey || e.type !== 'keydown') return true
    if (e.key === 'k') {
      term!.clear()
      return false
    }
    // ⌘D splits the tab, as in iTerm.
    if (e.key === 'd' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      emit('split')
      return false
    }
    // ⌘F finds in this terminal rather than the graph; ⇧⌘F still searches the files.
    if (e.key === 'f' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      void openFind()
      return false
    }
    return !APP_KEYS.has(e.key.toLowerCase())
  })

  try {
    const { id, shell } = await pty.spawn(props.session.cwd, term.cols, term.rows, prefs.shell.value || null, (e) => {
      if (e.type === 'data') term?.write(e.data)
      else emit('exit')
    })
    if (disposed) return void pty.kill(id)
    ptyId = id
    emit('title', props.session.command ? props.session.title : shell)
    // Typed in as if by hand, so the shell's own setup (PATH, aliases) applies, and you're left at its prompt after.
    if (props.session.command) void pty.write(id, `${props.session.command}\r`)
  } catch (e) {
    showToast(`Could not start a shell: ${e}`, 'error')
    return emit('exit')
  }

  term.onData((data) => ptyId && void pty.write(ptyId, data))
  term.onResize(({ cols, rows }) => {
    clearTimeout(ptyTimer)
    ptyTimer = setTimeout(() => ptyId && void pty.resize(ptyId, cols, rows), 120)
  })
  term.onTitleChange((title) => title && emit('title', title))
  observer = new ResizeObserver(fitNow)
  observer.observe(el.value!)
  window.addEventListener('panel-resize-end', fitNow)
  scheme.addEventListener('change', updateTheme)
  document.fonts.addEventListener('loadingdone', redraw)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', redraw)
  watchScale()
  if (props.active && props.focus) term.focus()
})

watch(prefs.terminalScrollback, (lines) => term && (term.options.scrollback = lines))

watch(prefs.terminalFontSize, (size) => {
  if (!term) return
  term.options.fontSize = size
  redraw()
  fitNow()
})

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    fitNow()
    redraw()
    if (props.focus) term?.focus()
  },
)

onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  window.removeEventListener('panel-resize-end', fitNow)
  clearTimeout(fitTimer)
  clearTimeout(ptyTimer)
  scheme.removeEventListener('change', updateTheme)
  document.fonts.removeEventListener('loadingdone', redraw)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', redraw)
  scale?.removeEventListener('change', onScale)
  if (ptyId) void pty.kill(ptyId)
  term?.dispose()
})

defineExpose({ focus: () => term?.focus() })
</script>

<template>
  <div class="terminal-host">
    <div ref="el" class="terminal-view" />
    <div v-if="finding" class="find" @keydown="onFindKey">
      <input ref="findInput" v-model="query" type="text" placeholder="Find" spellcheck="false" autocomplete="off" @input="find()" />
      <span class="count">{{ !query ? '' : results?.count ? `${results.index + 1} of ${results.count}` : 'No results' }}</span>
      <button class="ghost" :class="{ on: caseSensitive }" title="Match case" @click="((caseSensitive = !caseSensitive), find())">Aa</button>
      <button class="ghost" title="Previous (⇧↵)" :disabled="!results?.count" @click="find(true)">
        <Icon name="chevron" :size="11" class="up" />
      </button>
      <button class="ghost" title="Next (↵)" :disabled="!results?.count" @click="find()"><Icon name="chevron" :size="11" class="down" /></button>
      <button class="ghost" title="Close (Esc)" @click="closeFind"><Icon name="x" :size="12" /></button>
    </div>
  </div>
</template>

<style scoped>
.terminal-host {
  position: absolute;
  inset: 0;
}
.terminal-view {
  position: absolute;
  inset: 8px 4px 4px 12px;
}
.terminal-view :deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.find {
  position: absolute;
  z-index: 5;
  top: 10px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 4px 4px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--popover);
  box-shadow: var(--shadow);
}
.find input {
  width: 180px;
  height: 24px;
  border: none;
  background: none;
  font-size: 12.5px;
  outline: none;
}
.find .count {
  min-width: 64px;
  color: var(--fg-faint);
  font-size: 11px;
  text-align: right;
}
.find button {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: none;
  color: var(--fg-muted);
  font-size: 11px;
}
.find button.on {
  background: var(--selected);
  color: var(--fg);
}
.find .up {
  transform: rotate(-90deg);
}
.find .down {
  transform: rotate(90deg);
}
</style>
