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
  it('takes bullets when there are any, otherwise every line', () => {
    expect(parseLines('- a\nstray\n- b').map((t) => t.text)).toEqual(['a', 'b'])
    expect(parseLines(' first \n\nsecond').map((t) => t.text)).toEqual(['first', 'second'])
  })
})

describe('slackPlain', () => {
  it('flattens links, mentions and emphasis', () => {
    expect(slackPlain('*Ship* <https://x.dev|the fix> for <@U1> in <#C1|merge> &amp; tell <!here>', { U1: 'Ann' })).toBe(
      'Ship the fix for @Ann in #merge & tell @here',
    )
  })
})
