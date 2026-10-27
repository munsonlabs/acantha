import { describe, expect, it } from 'vitest'
import { contextAround, parseReply } from './editAsk'

describe('parseReply', () => {
  it('takes the code from an edit', () => {
    expect(parseReply('EDIT\n```ts\n/** Adds. */\nfunction add() {}\n```', 'function add() {}')).toEqual({
      kind: 'edit',
      code: '/** Adds. */\nfunction add() {}',
    })
  })

  it('keeps the selection’s trailing newline as it was', () => {
    expect(parseReply('EDIT\n```\nx\n```', 'y\n')).toEqual({ kind: 'edit', code: 'x\n' })
    expect(parseReply('EDIT\n```\nx\n\n```', 'y')).toEqual({ kind: 'edit', code: 'x' })
  })

  it('reads an answer, code blocks and all', () => {
    expect(parseReply('ANSWER\nIt adds:\n```\na + b\n```', '')).toEqual({ kind: 'answer', text: 'It adds:\n```\na + b\n```' })
  })

  it('makes do without the first line', () => {
    expect(parseReply('```js\nlet a\n```', '')).toEqual({ kind: 'edit', code: 'let a' })
    expect(parseReply('It returns a number.', '')).toEqual({ kind: 'answer', text: 'It returns a number.' })
    expect(parseReply('EDIT\nlet a', '')).toEqual({ kind: 'edit', code: 'let a' })
  })
})

describe('contextAround', () => {
  it('sends a small file whole', () => {
    expect(contextAround('abcdef', 2, 4)).toEqual({ before: 'ab', selected: 'cd', after: 'ef' })
  })

  it('cuts a big one at whole lines', () => {
    const line = `${'x'.repeat(99)}\n`
    const doc = line.repeat(2000)
    const { before, after } = contextAround(doc, 100_000, 100_100)
    expect(before.startsWith('…\nx')).toBe(true)
    expect(after.endsWith('\n…')).toBe(true)
    expect(before.length).toBeLessThanOrEqual(60_002)
  })
})
