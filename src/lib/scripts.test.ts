import { describe, expect, it } from 'vitest'
import { scriptRows, scriptRun, shellQuote, type Script } from './scripts'

describe('shellQuote', () => {
  it('keeps everything literal, quotes included', () => {
    expect(shellQuote(`it's $HOME; rm -rf /`)).toBe(`'it'\\''s $HOME; rm -rf /'`)
  })
})

describe('scriptRun', () => {
  it('runs Vite+ tasks from the root, naming the package', () => {
    expect(scriptRun('vp', { package: 'app', dir: 'app', name: 'build', command: 'x' })).toEqual({ dir: '', command: `npx vp run 'app#build'` })
    expect(scriptRun('vp', { package: null, dir: '', name: 'check', command: 'x' })).toEqual({ dir: '', command: `npx vp run 'check'` })
  })

  it('runs npm scripts in their own folder', () => {
    expect(scriptRun('npm', { package: null, dir: 'web', name: 'dev', command: 'x' })).toEqual({ dir: 'web', command: `npm run 'dev'` })
  })
})

describe('scriptRows', () => {
  const s = (dir: string, name: string): Script => ({ package: null, dir, name, command: '' })
  const show = (rows: ReturnType<typeof scriptRows>) =>
    rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'folder' ? `${r.label}/` : r.script.name}`)
  const scripts = [s('', 'build'), s('web', 'dev'), s('packages/api', 'start'), s('packages/api', 'test'), s('', 'lint')]

  it('puts the root scripts in a "root" folder, then each folder, compacting single-folder chains', () => {
    expect(show(scriptRows(scripts))).toEqual(['root/', '  build', '  lint', 'packages/api/', '  start', '  test', 'web/', '  dev'])
  })

  it('hides what a collapsed folder holds, root included', () => {
    expect(show(scriptRows(scripts, new Set(['packages/api', ''])))).toEqual(['root/', 'packages/api/', 'web/', '  dev'])
  })

  it('keeps folders that hold more than one folder', () => {
    expect(show(scriptRows([s('apps/a', 'x'), s('apps/b', 'y')]))).toEqual(['apps/', '  a/', '    x', '  b/', '    y'])
  })
})
