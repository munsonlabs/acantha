/**
 * The CodeMirror editor. Everything here is heavy, so components import this module dynamically, on first edit.
 * Colours come from the app's CSS variables, so the editor follows the light and dark themes on its own.
 */
import { basicSetup } from 'codemirror'
import { completeAnyWord, startCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { importCandidates } from './importPaths'
import { TYPED } from './typed'
import { typeAware, typeCompletions, type TypeService } from './types'
import { changeGutter, setChangeBase } from './changeGutter'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)', fontSize: '12.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--fg)', padding: '8px 0 24px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fg-faint)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 16px 0 20px' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-muted)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--term-selection)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--pill)' },
  '.cm-searchMatch': { backgroundColor: 'var(--match)', outline: '1px solid var(--border-strong)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--term-selection)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--pill)', outline: '1px solid var(--border-strong)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--pill)', border: 'none', color: 'var(--fg-muted)' },
  '.cm-panels': { backgroundColor: 'var(--popover)', color: 'var(--fg)', borderColor: 'var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button': { fontFamily: 'var(--font)', fontSize: '12px' },
  '.cm-textfield': { backgroundColor: 'var(--input-bg)', border: '1px solid var(--border-strong)', borderRadius: '6px', color: 'var(--fg)' },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--pill)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--fg)',
  },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--fg)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--pill)', color: 'var(--fg)' },
})

/** Token colours from the terminal palette, so code reads the same in the editor, terminal and preview. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--ansi-magenta)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: 'var(--ansi-green)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--ansi-yellow)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--fg-faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--ansi-blue)' },
  { tag: [t.typeName, t.className, t.namespace, t.self], color: 'var(--ansi-cyan)' },
  { tag: [t.tagName, t.deleted], color: 'var(--ansi-red)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--ansi-bright-blue)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--fg-muted)' },
  { tag: [t.heading], color: 'var(--ansi-blue)', fontWeight: '600' },
  { tag: [t.link, t.url], color: 'var(--ansi-blue)', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '600' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--fg-muted)' },
  { tag: t.invalid, color: 'var(--del)' },
])

export interface EditorOptions {
  doc: string
  path: string
  /** The repository's files, for completing import paths. */
  files?: () => string[]
  /** Words from the other open files, suggested alongside the ones in this file. */
  words?: () => readonly string[]
  /** Show change markers in the margin, against the text given with `setBase`. */
  changeMarkers?: boolean
  /** TypeScript's view of the file (`file`, its absolute path), for a file it understands: types, errors, definitions. */
  types?: { file: string; service: TypeService }
  onChange: (doc: string) => void
  onSave: () => void
}

/** Files whose imports name other files by path. */
const SCRIPT = /\.(m?[jt]sx?|cjs|cts|mts|vue|svelte|astro)$/

/**
 * Completes the path in an import (`from './…'`, `import('../…')`, `require('./…')`) from the repository's files.
 * Picking a folder opens its contents straight away.
 */
function importPaths(path: string, files: () => string[]) {
  return (ctx: CompletionContext) => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const m = line.text.slice(0, ctx.pos - line.from).match(/(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"](\.{1,2}\/[^'"]*)$/)
    if (!m) return null
    const typed = m[1]
    const cut = typed.lastIndexOf('/') + 1
    const options: Completion[] = importCandidates(path, typed.slice(0, cut), files()).map((c) => ({
      label: c.label,
      type: c.folder ? 'namespace' : 'variable',
      boost: c.folder ? 1 : 0,
      apply: (view, _completion, from, to) => {
        view.dispatch({ changes: { from, to, insert: c.label }, selection: { anchor: from + c.label.length } })
        if (c.folder) startCompletion(view)
      },
    }))
    return { from: ctx.pos - (typed.length - cut), options, validFor: /^[\w.@-]*$/ }
  }
}

/** Completes words found in the other open files. Words also in this file come up once: the duplicates merge. */
function otherWords(words: () => readonly string[]) {
  let from: readonly string[] = []
  let options: Completion[] = []
  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/[\p{L}\p{N}_$]+/u)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    const now = words()
    if (now !== from) {
      from = now
      options = now.map((label) => ({ label, type: 'text' }))
    }
    return { from: word.from, options, validFor: /^[\p{L}\p{N}_$]*$/u }
  }
}

export function createEditor(parent: HTMLElement, { doc, path, files, words, changeMarkers, types, onChange, onSave }: EditorOptions) {
  const typed = !!types && TYPED.test(path)
  const language = new Compartment()

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSave()
              return true
            },
          },
          indentWithTab,
        ]),
        language.of([]),
        // Alongside each language's own suggestions: TypeScript's, where it knows the file; otherwise any word already
        // in this file or the other open ones. And import paths.
        ...(typed
          ? [
              EditorState.languageData.of(() => [{ autocomplete: typeCompletions(types!.file, types!.service) }]),
              typeAware(types!.file, types!.service),
            ]
          : [
              EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
              ...(words ? [EditorState.languageData.of(() => [{ autocomplete: otherWords(words) }])] : []),
            ]),
        ...(files && SCRIPT.test(path) ? [EditorState.languageData.of(() => [{ autocomplete: importPaths(path, files) }])] : []),
        theme,
        syntaxHighlighting(highlight),
        ...(changeMarkers ? [changeGutter()] : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString())
        }),
      ],
    }),
  })

  // Grammars load on demand, after the text is already showing.
  const name = path.split('/').pop() ?? path
  const description = LanguageDescription.matchFilename(languages, name)
  description
    ?.load()
    .then((support) => view.dispatch({ effects: language.reconfigure(support) }))
    .catch(() => {})

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    /**
     * Replaces the text, e.g. after reloading from disk. Only the part that differs is swapped, so the cursor and
     * scroll position stay where they were when a formatter rewrites a few lines.
     */
    setDoc: (text: string) => {
      const old = view.state.doc.toString()
      if (old === text) return
      let start = 0
      while (start < old.length && start < text.length && old[start] === text[start]) start++
      let end = 0
      while (end < old.length - start && end < text.length - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end++
      view.dispatch({ changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) } })
    },
    /** The file as git has it, for the change markers; null clears them. */
    setBase: (text: string | null) => changeMarkers && setChangeBase(view, text),
    /** Puts the cursor at the start of a line (1-based, and a column if given) and scrolls it to the middle. */
    goTo: (line: number, col = 1) => {
      const doc = view.state.doc
      const l = doc.line(Math.min(Math.max(line, 1), doc.lines))
      const at = Math.min(l.from + Math.max(col - 1, 0), l.to)
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}

export type Editor = ReturnType<typeof createEditor>
