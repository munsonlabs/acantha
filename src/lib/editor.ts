/**
 * The CodeMirror editor. Everything here is heavy, so components import this module dynamically, on first edit.
 * Colours come from the app's CSS variables, so the editor follows the light and dark themes on its own.
 */
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { vim } from '@replit/codemirror-vim'

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
  '.cm-vim-panel': { fontFamily: 'var(--mono)', padding: '2px 8px' },
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
  vim: boolean
  onChange: (doc: string) => void
  onSave: () => void
}

export function createEditor(parent: HTMLElement, { doc, path, vim: vimMode, onChange, onSave }: EditorOptions) {
  const language = new Compartment()
  const keys = new Compartment()

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        // Vim has to come before the other keymaps to see keys first.
        keys.of(vimMode ? vim() : []),
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
        theme,
        syntaxHighlighting(highlight),
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
    /** Replaces the text, e.g. after reloading from disk, without counting as an edit. */
    setDoc: (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    setVim: (on: boolean) => view.dispatch({ effects: keys.reconfigure(on ? vim() : []) }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}

export type Editor = ReturnType<typeof createEditor>
