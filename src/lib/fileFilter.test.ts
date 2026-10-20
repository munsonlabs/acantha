import { describe, expect, it } from 'vitest'
import { fileFilterMatcher, filterPathspecs, parseFileFilter } from './fileFilter'

describe('parseFileFilter', () => {
  it('reads extensions, patterns, folders and exclusions', () => {
    expect(parseFileFilter('ts, .vue  *.test.ts src/ !*.lock')).toEqual({
      include: ['**/*.ts', '**/*.vue', '**/*.test.ts', 'src/**'],
      exclude: ['**/*.lock'],
    })
  })

  it('ignores blanks and a lone !', () => {
    expect(parseFileFilter(' , ! ')).toEqual({ include: [], exclude: [] })
  })

  it('makes git pathspecs', () => {
    expect(filterPathspecs(parseFileFilter('rs !target/'))).toEqual([':(glob)**/*.rs', ':(glob,exclude)target/**'])
  })
})

describe('fileFilterMatcher', () => {
  const match = (input: string) => fileFilterMatcher(parseFileFilter(input))

  it('matches extensions at any depth', () => {
    expect(match('ts')('a.ts')).toBe(true)
    expect(match('ts')('src/lib/a.ts')).toBe(true)
    expect(match('ts')('a.tsx')).toBe(false)
  })

  it('limits to a folder and leaves exclusions out', () => {
    const m = match('src/ !*.test.ts')
    expect(m('src/a.ts')).toBe(true)
    expect(m('src/a.test.ts')).toBe(false)
    expect(m('web/a.ts')).toBe(false)
  })

  it('lets everything through when empty, or with only exclusions', () => {
    expect(match('')('anything')).toBe(true)
    expect(match('!*.lock')('Cargo.lock')).toBe(false)
    expect(match('!*.lock')('main.rs')).toBe(true)
  })
})
