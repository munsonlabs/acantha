import { describe, expect, it } from 'vitest'
import { findFileRefs, resolveFileRef } from './termLinks'

const refs = (text: string) => findFileRefs(text).map((r) => [text.slice(r.start, r.end), r.path, r.line, r.col])

describe('findFileRefs', () => {
  it('finds paths with lines and columns in the usual formats', () => {
    expect(refs('src/lib/git.ts:42:7 - error TS2322')).toEqual([['src/lib/git.ts:42:7', 'src/lib/git.ts', 42, 7]])
    expect(refs('  at foo (./src/App.vue:12)')).toEqual([['./src/App.vue:12', './src/App.vue', 12, undefined]])
    expect(refs('src/a.ts(3,9): error')).toEqual([['src/a.ts(3,9)', 'src/a.ts', 3, 9]])
    expect(refs('modified:   README.md')).toEqual([['README.md', 'README.md', undefined, undefined]])
    expect(refs('/Users/me/repo/x.rs:1')).toEqual([['/Users/me/repo/x.rs:1', '/Users/me/repo/x.rs', 1, undefined]])
  })

  it('leaves URLs, versions and plain words alone', () => {
    expect(refs('see https://example.com/docs/a.js')).toEqual([])
    expect(refs('version 1.2.3 done')).toEqual([])
    expect(refs('hello world')).toEqual([])
  })
})

describe('resolveFileRef', () => {
  const files = ['src/lib/git.ts', 'src/App.vue', 'packages/web/src/main.ts', 'README.md']
  const root = '/r'
  it('resolves from the terminal folder, the top, or a unique ending', () => {
    expect(resolveFileRef('lib/git.ts', root, '/r/src', files)).toBe('src/lib/git.ts')
    expect(resolveFileRef('src/App.vue', root, '/r/src', files)).toBe('src/App.vue')
    expect(resolveFileRef('src/main.ts', root, '/r', files)).toBe('packages/web/src/main.ts')
    expect(resolveFileRef('/r/README.md', root, '/r', files)).toBe('README.md')
  })

  it('finds nothing outside the repository or for missing files', () => {
    expect(resolveFileRef('/elsewhere/README.md', root, '/r', files)).toBeNull()
    expect(resolveFileRef('nope.ts', root, '/r', files)).toBeNull()
    expect(resolveFileRef('../git.ts', root, '/r/src', files)).toBeNull()
  })
})
