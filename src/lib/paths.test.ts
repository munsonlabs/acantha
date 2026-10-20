import { describe, expect, it } from 'vitest'
import { resolveName } from './paths'

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
