import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPatch, canPickLines, parseDiff } from './diff'

// Real repositories, so the patches are checked by `git apply` itself rather than by eye.
let dir = ''
const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
const apply = (patch: string, ...flags: string[]) =>
  execFileSync('git', ['-C', dir, 'apply', '--whitespace=nowarn', ...flags, '-'], { input: patch, encoding: 'utf8' })
const write = (text: string) => writeFileSync(join(dir, 'f.txt'), text)
const index = () => git('show', ':f.txt')
const tree = () => readFileSync(join(dir, 'f.txt'), 'utf8')
/** The indexes of the changed lines whose text is in `texts`. */
const pick = (diff: ReturnType<typeof parseDiff>, ...texts: string[]) =>
  new Set(diff.lines.flatMap((l, i) => ((l.kind === 'add' || l.kind === 'del') && texts.includes(l.text) ? [i] : [])))

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acantha-diff-'))
  git('init', '-q')
  write(`${lines(20).join('\n')}\n`)
  git('add', 'f.txt')
  git('-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'one')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('buildPatch', () => {
  it('stages one added line of several', () => {
    const l = lines(20)
    write(`${[...l.slice(0, 3), 'new A', 'new B', ...l.slice(3)].join('\n')}\n`)
    const diff = parseDiff(git('diff', '--', 'f.txt'))
    expect(canPickLines(diff)).toBe(true)
    apply(buildPatch(diff, pick(diff, 'new B'))!, '--cached')
    expect(index()).toBe(`${[...l.slice(0, 3), 'new B', ...l.slice(3)].join('\n')}\n`)
  })

  it('stages a removal on its own, leaving the other changes', () => {
    const l = lines(20)
    write(`${[...l.slice(0, 2), 'changed 3', ...l.slice(3)].join('\n')}\n`)
    const diff = parseDiff(git('diff', '--', 'f.txt'))
    apply(buildPatch(diff, pick(diff, 'line 3'))!, '--cached')
    expect(index()).toBe(`${[...l.slice(0, 2), ...l.slice(3)].join('\n')}\n`)
  })

  it('stages from a later hunk only, and from both', () => {
    const l = lines(20)
    const edited = [...l]
    edited[1] = 'top'
    edited[17] = 'bottom'
    write(`${edited.join('\n')}\n`)
    let diff = parseDiff(git('diff', '--', 'f.txt'))
    expect(diff.lines.filter((x) => x.kind === 'hunk')).toHaveLength(2)
    apply(buildPatch(diff, pick(diff, 'line 18', 'bottom'))!, '--cached')
    expect(index()).toBe(`${[...l.slice(0, 17), 'bottom', ...l.slice(18)].join('\n')}\n`)
    git('reset', '-q')
    // An added line in the first hunk shifts where the second one lands.
    write(`${[...edited.slice(0, 5), 'extra', ...edited.slice(5)].join('\n')}\n`)
    diff = parseDiff(git('diff', '--', 'f.txt'))
    apply(buildPatch(diff, pick(diff, 'extra', 'line 18', 'bottom'))!, '--cached')
    expect(index()).toBe(`${[...l.slice(0, 5), 'extra', ...l.slice(5, 17), 'bottom', ...l.slice(18)].join('\n')}\n`)
  })

  it('unstages one line, keeping the rest staged', () => {
    const l = lines(20)
    write(`${[...l.slice(0, 3), 'new A', 'new B', ...l.slice(3)].join('\n')}\n`)
    git('add', 'f.txt')
    const diff = parseDiff(git('diff', '--cached', '--', 'f.txt'))
    apply(buildPatch(diff, pick(diff, 'new A'), true)!, '--cached', '-R')
    expect(index()).toBe(`${[...l.slice(0, 3), 'new B', ...l.slice(3)].join('\n')}\n`)
  })

  it('discards one line from the working tree', () => {
    const l = lines(20)
    write(`${[...l.slice(0, 2), 'changed 3', ...l.slice(3, 10), 'added', ...l.slice(10)].join('\n')}\n`)
    const diff = parseDiff(git('diff', '--', 'f.txt'))
    apply(buildPatch(diff, pick(diff, 'added'), true)!, '-R')
    expect(tree()).toBe(`${[...l.slice(0, 2), 'changed 3', ...l.slice(3)].join('\n')}\n`)
  })

  it('keeps the "no newline at end of file" note with its line', () => {
    const l = lines(20)
    write(`${[...l, 'last'].join('\n')}`)
    const diff = parseDiff(git('diff', '--', 'f.txt'))
    apply(buildPatch(diff, pick(diff, 'last'))!, '--cached')
    expect(index()).toBe(`${[...l, 'last'].join('\n')}`)
  })

  it('is null when no change is chosen', () => {
    write(`${lines(20).join('\n')}\nmore\n`)
    expect(buildPatch(parseDiff(git('diff', '--', 'f.txt')), new Set())).toBeNull()
  })
})

describe('canPickLines', () => {
  it('leaves new and deleted files whole', () => {
    writeFileSync(join(dir, 'g.txt'), 'g\n')
    git('add', 'g.txt')
    expect(canPickLines(parseDiff(git('diff', '--cached', '--', 'g.txt')))).toBe(false)
    git('rm', '-q', '--cached', 'f.txt')
    expect(canPickLines(parseDiff(git('diff', '--cached', '--', 'f.txt')))).toBe(false)
  })
})
