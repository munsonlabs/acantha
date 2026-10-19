import { describe, expect, it } from 'vite-plus/test'
import { commitUrl, webUrl } from './remote'

describe('remote urls', () => {
  it.each([
    ['git@github.com:munsonlabs/packages.git', 'https://github.com/munsonlabs/packages'],
    ['https://github.com/munsonlabs/packages.git', 'https://github.com/munsonlabs/packages'],
    ['ssh://git@gitlab.com/group/project.git', 'https://gitlab.com/group/project'],
    ['https://user:secret-token@github.com/o/r.git', 'https://github.com/o/r'],
  ])('%s', (remote, web) => expect(webUrl(remote)).toBe(web))

  it('ignores remotes that are not on the web', () => {
    expect(webUrl('/Users/me/origin.git')).toBeNull()
    expect(webUrl(null)).toBeNull()
  })

  it('uses each host’s commit path', () => {
    expect(commitUrl('git@github.com:o/r.git', 'abc')).toBe('https://github.com/o/r/commit/abc')
    expect(commitUrl('git@gitlab.com:o/r.git', 'abc')).toBe('https://gitlab.com/o/r/-/commit/abc')
  })
})
