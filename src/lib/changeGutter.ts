/**
 * Change markers in the editor's margin: a bar beside lines added (green) or modified (yellow) since the version git
 * has, and a small mark where lines were deleted. Worked out a moment after each edit, and kept in place by mapping
 * them through edits in between. Loaded with the editor.
 */
import { RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from '@codemirror/view'
import { lineChanges } from './lineDiff'

type Kind = 'added' | 'modified' | 'deleted' | 'deleted-top'

class ChangeMark extends GutterMarker {
  constructor(readonly kind: Kind) {
    super()
  }
  eq(other: ChangeMark) {
    return other.kind === this.kind
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = `cm-change cm-change-${this.kind}`
    return el
  }
}
const MARKS: Record<Kind, ChangeMark> = {
  added: new ChangeMark('added'),
  modified: new ChangeMark('modified'),
  deleted: new ChangeMark('deleted'),
  'deleted-top': new ChangeMark('deleted-top'),
}

/** The text to compare with: the file as git has it (the index), or null for no markers. */
const setBase = StateEffect.define<string | null>()
const baseField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBase)) return e.value
    return value
  },
})

const setMarks = StateEffect.define<RangeSet<GutterMarker>>()
const marksField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value
    return value.map(tr.changes)
  },
})

function computeMarks(view: EditorView): RangeSet<GutterMarker> {
  const base = view.state.field(baseField)
  if (base === null) return RangeSet.empty
  const doc = view.state.doc
  const c = lineChanges(base, doc.toString())
  // One mark a line: an added or modified bar wins over a deletion mark on the same line.
  const byLine = new Map<number, Kind>()
  for (const line of c.added) byLine.set(line, 'added')
  for (const line of c.modified) byLine.set(line, 'modified')
  for (const after of c.deletedAfter) {
    const line = Math.max(after, 1)
    if (line <= doc.lines && !byLine.has(line)) byLine.set(line, after === 0 ? 'deleted-top' : 'deleted')
  }
  const builder = new RangeSetBuilder<GutterMarker>()
  for (const line of [...byLine.keys()].sort((a, b) => a - b))
    if (line <= doc.lines) builder.add(doc.line(line).from, doc.line(line).from, MARKS[byLine.get(line)!])
  return builder.finish()
}

/** Works the markers out again a moment after typing stops, or straight away when the base changes. */
const recompute = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined
    constructor(readonly view: EditorView) {
      this.schedule(0)
    }
    update(u: ViewUpdate) {
      const rebased = u.transactions.some((tr) => tr.effects.some((e) => e.is(setBase)))
      if (rebased || u.docChanged) this.schedule(rebased ? 0 : 250)
    }
    schedule(ms: number) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.view.dispatch({ effects: setMarks.of(computeMarks(this.view)) }), ms)
    }
    destroy() {
      clearTimeout(this.timer)
    }
  },
)

const style = EditorView.baseTheme({
  '.cm-changes-gutter': { width: '3px', marginRight: '3px' },
  '.cm-changes-gutter .cm-gutterElement': { padding: '0' },
  '.cm-change': { width: '3px', height: '100%', borderRadius: '1px' },
  '.cm-change-added': { background: 'var(--add)' },
  '.cm-change-modified': { background: 'var(--modify)' },
  // Deleted lines: a small red wedge on the line they were removed after (above the first line, for the top).
  '.cm-change-deleted, .cm-change-deleted-top': { position: 'relative' },
  '.cm-change-deleted::after, .cm-change-deleted-top::after': {
    content: '""',
    position: 'absolute',
    left: '0',
    borderLeft: '5px solid var(--del)',
    borderTop: '3px solid transparent',
    borderBottom: '3px solid transparent',
  },
  '.cm-change-deleted::after': { bottom: '-3px' },
  '.cm-change-deleted-top::after': { top: '-3px' },
})

export function changeGutter(): Extension {
  return [baseField, marksField, recompute, gutter({ class: 'cm-changes-gutter', markers: (v) => v.state.field(marksField) }), style]
}

/** Sets the text the markers compare with; null clears them. */
export const setChangeBase = (view: EditorView, base: string | null) => view.dispatch({ effects: setBase.of(base) })
