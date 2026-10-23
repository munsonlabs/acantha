import { describe, expect, it } from 'vitest'
import { resolveName, worktreeName } from './paths'

describe('resolveName', () => {
  it('names something in the folder, or nested in it', () => {
    expect(resolveName('src', 'x.ts')).toBe('src/x.ts')
    expect(resolveName('src', 'utils/x.ts')).toBe('src/utils/x.ts')
    expect(resolveName('', 'x.ts')).toBe('x.ts')
  })

  it('moves up with .., or from the top with a leading /', () => {
    expect(resolveName('src/lib', '../x.ts')).toBe('src/x.ts')
    expect(resolveName('src/lib', '/docs/x.md')).toBe('docs/x.md')
    expect(resolveName('src', './x.ts')).toBe('src/x.ts')
  })

  it("can't climb above the repository, and empty names name nothing", () => {
    expect(resolveName('src', '../../../x')).toBe('x')
    expect(resolveName('', '..')).toBe('')
    expect(resolveName('src', '/')).toBe('')
  })
})

describe('worktreeName', () => {
  it('names a worktree by its folder, or by its path inside the main one', () => {
    expect(worktreeName('/code/app-fix', '/code/app')).toBe('app-fix')
    expect(worktreeName('/code/app/tests/.build/baseline/src', '/code/app')).toBe('tests/.build/baseline/src')
    // A sibling whose name merely starts the same isn't inside it.
    expect(worktreeName('/code/app2', '/code/app')).toBe('app2')
    expect(worktreeName('/code/app', undefined)).toBe('app')
  })
})
