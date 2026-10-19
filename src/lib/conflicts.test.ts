import { describe, expect, it } from 'vite-plus/test'
import { parseConflicts, serialize, type ConflictBlock } from './conflicts'

const FILE = ['a', '<<<<<<< HEAD', 'ours', '||||||| base', 'old', '=======', 'theirs', '>>>>>>> feature', 'z'].join('\n')

const conflict = (text: string) => parseConflicts(text).find((s): s is ConflictBlock => s.type === 'conflict')!

describe('conflicts', () => {
  it('splits a file into text and conflicts, dropping the diff3 base', () => {
    const block = conflict(FILE)
    expect(block).toMatchObject({ current: ['ours'], incoming: ['theirs'], currentLabel: 'HEAD', incomingLabel: 'feature' })
  })

  it.each([
    ['current', 'a\nours\nz'],
    ['incoming', 'a\ntheirs\nz'],
    ['both', 'a\nours\ntheirs\nz'],
    ['both-reversed', 'a\ntheirs\nours\nz'],
  ] as const)('resolves to %s', (resolution, expected) => {
    const segments = parseConflicts(FILE)
    ;(segments[1] as ConflictBlock).resolution = resolution
    expect(serialize(segments)).toBe(expected)
  })

  it('uses hand-edited text for a custom resolution', () => {
    const segments = parseConflicts(FILE)
    Object.assign(segments[1], { resolution: 'custom', custom: 'merged\nby hand' })
    expect(serialize(segments)).toBe('a\nmerged\nby hand\nz')
  })

  it('leaves an unterminated marker as text', () => {
    const text = 'a\n<<<<<<< HEAD\nb'
    expect(parseConflicts(text).every((s) => s.type === 'text')).toBe(true)
    expect(serialize(parseConflicts(text))).toBe(text)
  })
})
