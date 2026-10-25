import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { symbolsOf, TYPED, toLocation, toPos, typeCompletions, type TypeService } from './types'

describe('places', () => {
  const doc = Text.of(['const a = 1', 'a.toFixed()'])
  it('counts lines and offsets from 1, as tsserver does, and back', () => {
    expect(toLocation(doc, 0)).toEqual({ line: 1, offset: 1 })
    expect(toLocation(doc, 14)).toEqual({ line: 2, offset: 3 })
    expect(toPos(doc, { line: 2, offset: 3 })).toBe(14)
    // Past the end of a line, or the file, stays inside it.
    expect(toPos(doc, { line: 1, offset: 99 })).toBe(11)
    expect(toPos(doc, { line: 9, offset: 1 })).toBe(12)
  })

  it('knows which files TypeScript understands', () => {
    expect(['a.ts', 'b.tsx', 'c.js', 'd.mjs', 'e.cts'].every((f) => TYPED.test(f))).toBe(true)
    expect(['a.vue', 'b.json', 'c.md', 'd.d'].some((f) => TYPED.test(f))).toBe(false)
  })
})

describe('typeCompletions', () => {
  it('asks after a dot, at the right place, and lists what TypeScript offers in its order', async () => {
    let asked: Record<string, unknown> = {}
    const ts: TypeService = {
      ask: async (_command, args) => {
        asked = args
        return {
          entries: [
            { name: 'toFixed', kind: 'method', sortText: '11' },
            { name: 'valueOf', kind: 'method', sortText: '15' },
          ],
        }
      },
      tell: () => {},
      onDiagnostics: () => () => {},
      goTo: () => {},
    }
    const state = EditorState.create({ doc: 'a.' })
    const result = await typeCompletions('/r/x.ts', ts)(new CompletionContext(state, 2, false))
    expect(asked).toMatchObject({ file: '/r/x.ts', line: 1, offset: 3, triggerCharacter: '.' })
    expect(result?.options.map((o) => [o.label, o.type])).toEqual([
      ['toFixed', 'method'],
      ['valueOf', 'method'],
    ])
    expect(result!.options[0].boost!).toBeGreaterThan(result!.options[1].boost!)
    // Not after a space, unless asked for.
    expect(await typeCompletions('/r/x.ts', ts)(new CompletionContext(EditorState.create({ doc: 'a ' }), 2, false))).toBeNull()
  })
})

describe('symbolsOf', () => {
  it('keeps what you could reasonably jump to, not every local variable', () => {
    const entries = [
      { name: 'resolveName', kind: 'function', start: { line: 6, offset: 1 } },
      { name: 'parts', kind: 'const', containerName: 'resolveName', start: { line: 7, offset: 9 } },
      { name: 'dir', kind: 'parameter', start: { line: 6, offset: 20 } },
      { name: 'API_URL', kind: 'const', start: { line: 1, offset: 1 } },
      { name: 'render', kind: 'method', containerName: 'Widget', start: { line: 10, offset: 3 } },
    ]
    expect(symbolsOf(entries).map((s) => s.name)).toEqual(['resolveName', 'API_URL', 'render'])
    expect(symbolsOf('nope')).toEqual([])
    expect(symbolsOf([{ name: 1 }])).toEqual([])
  })
})
