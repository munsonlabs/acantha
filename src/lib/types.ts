/**
 * Type awareness for TypeScript and JavaScript in the editor, from the repository's own TypeScript language service
 * (tsserver, run by the backend: see src-tauri/src/tsserver.rs): types on hover, completions that know the code,
 * errors underlined as you type, and ⌘-click or F12 to go to a definition. The editor keeps tsserver told of every
 * change, so its answers are about the text on screen, saved or not.
 */
import { type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { Extension, Text } from '@codemirror/state'
import { EditorView, hoverTooltip, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** A place in a file as tsserver counts: lines and offsets from 1. */
interface Location {
  line: number
  offset: number
}

export interface TsDiagnostic {
  start: Location
  end: Location
  text: string
  category: string
  code?: number
}

/** How the editor reaches TypeScript: the backend, through the component that made it. */
export interface TypeService {
  /** Asks something and waits for the answer (null when there isn't one). */
  ask: (command: string, args: Record<string, unknown>) => Promise<unknown>
  /** Tells it something that needs no answer. */
  tell: (command: string, args: Record<string, unknown>) => void
  /** Follows the file's errors, as tsserver reports them (syntax and types separately). Returns a stop. */
  onDiagnostics: (listener: (kind: string, diagnostics: TsDiagnostic[]) => void) => () => void
  /** Shows a definition: here, or in another file. */
  goTo: (file: string, line: number, col: number) => void
}

/** Files TypeScript understands. */
export const TYPED = /\.(m?[jt]sx?|c[jt]s)$/

export const toLocation = (doc: Text, pos: number): Location => {
  const line = doc.lineAt(pos)
  return { line: line.number, offset: pos - line.from + 1 }
}
export const toPos = (doc: Text, at: Location) => {
  const line = doc.line(Math.min(Math.max(at.line, 1), doc.lines))
  return Math.min(line.from + Math.max(at.offset - 1, 0), line.to)
}

/** tsserver's kinds of thing as CodeMirror's completion types, for their icons. */
const KINDS: Record<string, string> = {
  function: 'function',
  'local function': 'function',
  method: 'method',
  property: 'property',
  getter: 'property',
  setter: 'property',
  var: 'variable',
  let: 'variable',
  const: 'constant',
  'local var': 'variable',
  parameter: 'variable',
  class: 'class',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  'enum member': 'enum',
  module: 'namespace',
  'external module name': 'namespace',
  keyword: 'keyword',
}

/** tsserver's display parts (from completion details) as plain text. */
const partsText = (parts: unknown) => (Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '')

/** Keeps tsserver told of the file: open, every change as it's made, closed; and asks for its errors once typing pauses. */
function sync(file: string, ts: TypeService) {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined
      diagnostics: Record<string, Diagnostic[]> = {}
      stop: () => void
      constructor(readonly view: EditorView) {
        ts.tell('open', { file, fileContent: view.state.doc.toString() })
        this.stop = ts.onDiagnostics((kind, list) => this.show(kind, list))
        this.check()
      }
      update(u: ViewUpdate) {
        if (!u.docChanged) return
        // Each change against the text before it, latest first, so the earlier ones' places still hold.
        const changes: { from: number; to: number; text: string }[] = []
        u.changes.iterChanges((from, to, _f, _t, inserted) => changes.push({ from, to, text: inserted.toString() }))
        for (const c of changes.reverse()) {
          const start = toLocation(u.startState.doc, c.from)
          const end = toLocation(u.startState.doc, c.to)
          ts.tell('change', { file, line: start.line, offset: start.offset, endLine: end.line, endOffset: end.offset, insertString: c.text })
        }
        this.check()
      }
      check() {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => ts.tell('geterr', { files: [file], delay: 0 }), 400)
      }
      show(kind: string, list: TsDiagnostic[]) {
        const doc = this.view.state.doc
        this.diagnostics[kind] = list.map((d) => ({
          from: toPos(doc, d.start),
          to: Math.max(toPos(doc, d.end), toPos(doc, d.start)),
          severity: d.category === 'error' ? 'error' : d.category === 'warning' ? 'warning' : 'info',
          message: d.text,
          source: d.code ? `TS${d.code}` : 'TypeScript',
        }))
        this.view.dispatch(setDiagnostics(this.view.state, Object.values(this.diagnostics).flat()))
      }
      destroy() {
        clearTimeout(this.timer)
        this.stop()
        ts.tell('close', { file })
      }
    },
  )
}

/** A thing's type (and its documentation) on hover. */
function hoverTypes(file: string, ts: TypeService) {
  return hoverTooltip(async (view, pos) => {
    const info = (await ts.ask('quickinfo', { file, ...toLocation(view.state.doc, pos) })) as {
      displayString?: string
      documentation?: string
      start?: Location
      end?: Location
    } | null
    if (!info?.displayString) return null
    const doc = view.state.doc
    return {
      pos: info.start ? toPos(doc, info.start) : pos,
      end: info.end ? toPos(doc, info.end) : pos,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-type-info'
        const code = document.createElement('code')
        code.textContent = info.displayString!
        dom.append(code)
        if (info.documentation) {
          const p = document.createElement('p')
          p.textContent = info.documentation
          dom.append(p)
        }
        return { dom }
      },
    }
  })
}

/**
 * Completions that know the code: what's in scope, an object's members after a dot. Each says what it is when picked
 * out in the list.
 */
export function typeCompletions(file: string, ts: TypeService) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(/[\w$]*/)
    if (!word) return null
    const before = ctx.state.sliceDoc(word.from - 1, word.from)
    if (word.from === word.to && !ctx.explicit && before !== '.') return null
    const at = toLocation(ctx.state.doc, ctx.pos)
    const info = (await ts.ask('completionInfo', {
      file,
      ...at,
      prefix: word.text,
      ...(before === '.' ? { triggerCharacter: '.' } : {}),
    })) as { entries?: { name: string; kind: string; sortText: string; kindModifiers?: string }[] } | null
    if (!info?.entries || ctx.aborted) return null
    const options: Completion[] = info.entries.slice(0, 300).map((e) => ({
      label: e.name,
      type: KINDS[e.kind] ?? 'variable',
      // tsserver's order: lower sort text first.
      boost: -Math.min(Number.parseInt(e.sortText, 10) || 0, 99),
      info: async () => {
        const details = (await ts.ask('completionEntryDetails', { file, ...at, entryNames: [e.name] })) as
          | { displayParts?: unknown; documentation?: unknown }[]
          | null
        const d = details?.[0]
        if (!d) return null
        const dom = document.createElement('div')
        dom.className = 'cm-type-info'
        const code = document.createElement('code')
        code.textContent = partsText(d.displayParts)
        dom.append(code)
        const docs = partsText(d.documentation)
        if (docs) {
          const p = document.createElement('p')
          p.textContent = docs
          dom.append(p)
        }
        return dom
      },
    }))
    return { from: word.from, options, validFor: /^[\w$]*$/ }
  }
}

/** Goes to the definition of what's at `pos`. */
async function goToDefinition(view: EditorView, pos: number, ts: TypeService, file: string) {
  const found = (await ts.ask('definition', { file, ...toLocation(view.state.doc, pos) })) as { file: string; start: Location }[] | null
  const first = found?.[0]
  if (first) ts.goTo(first.file, first.start.line, first.start.offset)
  return !!first
}

/** Everything type-aware, for a file (`file`, its absolute path) TypeScript understands. */
export function typeAware(file: string, ts: TypeService): Extension {
  return [
    sync(file, ts),
    lintGutter(),
    hoverTypes(file, ts),
    keymap.of([{ key: 'F12', run: (view) => (void goToDefinition(view, view.state.selection.main.head, ts, file), true) }]),
    EditorView.domEventHandlers({
      // ⌘-click goes to the definition, as in VS Code.
      mousedown(e, view) {
        if (!e.metaKey || e.button !== 0) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos == null) return false
        e.preventDefault()
        void goToDefinition(view, pos, ts, file)
        return true
      },
    }),
    EditorView.theme({
      '.cm-type-info': { maxWidth: '560px', padding: '6px 9px', fontSize: '12px' },
      '.cm-type-info code': { display: 'block', fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', color: 'var(--fg)' },
      '.cm-type-info p': { margin: '6px 0 0', color: 'var(--fg-muted)', whiteSpace: 'pre-wrap' },
      '.cm-tooltip-lint': { padding: '2px 0' },
      '.cm-diagnostic': { fontFamily: 'var(--font)', fontSize: '12px' },
    }),
  ]
}
