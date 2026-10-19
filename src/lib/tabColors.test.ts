import { describe, expect, it } from 'vite-plus/test'
import { autoTabColor, freshTabColor, tabColor, TAB_COLORS } from './tabColors'

describe('tab colours', () => {
  it('gives a repository the same colour every time', () => {
    expect(autoTabColor('/Users/me/Dev/acantha')).toBe(autoTabColor('/Users/me/Dev/acantha'))
    expect(TAB_COLORS.map((c) => c.value)).toContain(autoTabColor('/Users/me/Dev/acantha'))
  })

  it('avoids colours other open tabs already have', () => {
    const taken = [autoTabColor('/a')]
    expect(freshTabColor('/a', taken)).not.toBe(taken[0])
    expect(freshTabColor('/a', [])).toBe(autoTabColor('/a'))
  })

  it('prefers a picked colour, and allows none', () => {
    expect(tabColor('/repo', { '/repo': '#e35d5d' })).toBe('#e35d5d')
    expect(tabColor('/repo', { '/repo': 'none' })).toBeNull()
    expect(tabColor(null, {})).toBeNull()
  })
})
