import { describe, expect, it } from 'vitest'
import { scriptRun, shellQuote } from './scripts'

describe('shellQuote', () => {
  it('keeps everything literal, quotes included', () => {
    expect(shellQuote(`it's $HOME; rm -rf /`)).toBe(`'it'\\''s $HOME; rm -rf /'`)
  })
})

describe('scriptRun', () => {
  it('runs Vite+ tasks from the root, naming the package', () => {
    expect(scriptRun('vp', { package: 'app', name: 'build', command: 'x' })).toEqual({ dir: '', command: `npx vp run 'app#build'` })
    expect(scriptRun('vp', { package: null, name: 'check', command: 'x' })).toEqual({ dir: '', command: `npx vp run 'check'` })
  })

  it('runs npm scripts in their own folder', () => {
    expect(scriptRun('npm', { package: 'web', name: 'dev', command: 'x' })).toEqual({ dir: 'web', command: `npm run 'dev'` })
  })
})
