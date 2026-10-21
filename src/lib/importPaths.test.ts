import { describe, expect, it } from 'vitest'
import { importCandidates } from './importPaths'

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
