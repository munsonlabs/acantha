import { describe, expect, it } from 'vitest'
import { importCandidates, pathBeingTyped } from './importPaths'

const files = [
  'src/App.vue',
  'src/main.ts',
  'src/lib/format.ts',
  'src/lib/format.test.ts',
  'src/lib/git.ts',
  'src/lib/deep/x.ts',
  'src/components/Icon.vue',
  'src/assets/logo.svg',
  'README.md',
]
const labels = (dir: string, from = 'src/main.ts') => importCandidates(from, dir, files).map((c) => c.label)

describe('importCandidates', () => {
  it('lists the folder next to the file, folders first, dropping script extensions', () => {
    expect(labels('./')).toEqual(['assets/', 'components/', 'lib/', 'App.vue'])
  })

  it('follows a typed folder', () => {
    expect(labels('./lib/')).toEqual(['deep/', 'format', 'format.test', 'git'])
  })

  it('goes up with ../', () => {
    expect(labels('../', 'src/lib/format.ts')).toEqual(['assets/', 'components/', 'lib/', 'App.vue', 'main'])
    expect(labels('../../', 'src/lib/format.ts')).toEqual(['src/', 'README.md'])
  })

  it("doesn't offer the file itself, or anything above the repository", () => {
    expect(labels('./', 'src/lib/git.ts')).not.toContain('git')
    expect(labels('../../', 'src/main.ts')).toEqual([])
  })
})

describe('@/ and other paths', () => {
  it('reads @/ as the nearest src folder', () => {
    expect(labels('@/', 'src/components/Icon.vue')).toEqual(['assets/', 'lib/', 'App.vue', 'main'])
    expect(labels('@/lib/')).toEqual(['deep/', 'format', 'format.test', 'git'])
    expect(importCandidates('pkg/a/src/x.ts', '@/', ['pkg/a/src/x.ts', 'pkg/a/src/y.ts', 'src/z.ts']).map((c) => c.label)).toEqual(['y'])
    expect(importCandidates('README.md', '@/', ['README.md', 'docs/a.md'])).toEqual([])
  })

  it('keeps extensions outside imports', () => {
    expect(importCandidates('src/main.ts', './lib/', files, false).map((c) => c.label)).toContain('format.ts')
  })
})

describe('pathBeingTyped', () => {
  it('finds a path in an import, a string, an attribute or a url()', () => {
    expect(pathBeingTyped("import A from '../li")).toEqual({ typed: '../li', isImport: true })
    expect(pathBeingTyped("const C = defineAsyncComponent(() => import('@/comp")).toEqual({ typed: '@/comp', isImport: true })
    expect(pathBeingTyped("readFile('./data/")).toEqual({ typed: './data/', isImport: false })
    expect(pathBeingTyped('<img src="./assets/')).toEqual({ typed: './assets/', isImport: false })
    expect(pathBeingTyped('background: url(../img/')).toEqual({ typed: '../img/', isImport: false })
  })

  it('leaves everything else alone', () => {
    expect(pathBeingTyped("import A from 'vue")).toBeNull()
    expect(pathBeingTyped('a / b')).toBeNull()
    expect(pathBeingTyped("'./done' + x")).toBeNull()
  })
})
