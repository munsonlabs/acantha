import { describe, expect, it } from 'vitest'
import { parseBullets, parseLines, slackPlain } from './todos'

describe('parseBullets', () => {
  it('reads dashes, stars, Slack bullets and numbers', () => {
    expect(parseBullets('Plan:\n- one\n* two\n• three\n  ◦ nested\n1. four\n2) five\nnot a bullet').map((t) => t.text)).toEqual([
      'one',
      'two',
      'three',
      'nested',
      'four',
      'five',
    ])
  })

  it('keeps checkbox state', () => {
    expect(parseBullets('- [x] shipped\n- [ ] review\n[X] tested')).toEqual([
      { text: 'shipped', done: true },
      { text: 'review', done: false },
      { text: 'tested', done: true },
    ])
  })

  it('finds nothing in plain text', () => {
    expect(parseBullets('just a sentence\n-not a bullet')).toEqual([])
  })
})

describe('parseLines', () => {
  it('takes every line, marked or not, leaving out headings', () => {
    expect(parseLines('Plan:\n- a\nstray\n- [x] b').map((t) => [t.text, t.done])).toEqual([
      ['a', false],
      ['stray', false],
      ['b', true],
    ])
    expect(parseLines(' first \n\nsecond').map((t) => t.text)).toEqual(['first', 'second'])
  })

  it('keeps the lines that lost their bullets on the way from a canvas', () => {
    const pasted = '1. feature/a\n2. feature/b (requires feature/c)\n3. feature/d\nfeature/e ➕\nfeature/f ➕'
    expect(parseLines(pasted).map((t) => t.text)).toEqual([
      'feature/a',
      'feature/b (requires feature/c)',
      'feature/d',
      'feature/e ➕',
      'feature/f ➕',
    ])
  })
})

describe('slackPlain', () => {
  it('flattens links, mentions and emphasis', () => {
    expect(slackPlain('*Ship* <https://x.dev|the fix> for <@U1> in <#C1|merge> &amp; tell <!here>', { U1: 'Ann' })).toBe(
      'Ship the fix for @Ann in #merge & tell @here',
    )
  })
})
