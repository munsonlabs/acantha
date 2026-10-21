import { describe, expect, it } from 'vitest'
import { overall, parseChecks } from './github'

describe('parseChecks', () => {
  it('reads check runs and commit statuses', () => {
    const checks = parseChecks([
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI', detailsUrl: 'u' },
      { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { __typename: 'StatusContext', context: 'vercel', state: 'FAILURE', targetUrl: 'v' },
    ])
    expect(checks.map((c) => [c.name, c.state])).toEqual([
      ['CI / build', 'pass'],
      ['lint', 'pending'],
      ['docs', 'skipped'],
      ['vercel', 'fail'],
    ])
  })
})

describe('overall', () => {
  const c = (...states: string[]) => states.map((state) => ({ name: state, state, url: null }) as never)
  it('fails on any failure, then waits on anything pending', () => {
    expect(overall(c('pass', 'fail', 'pending'))).toBe('fail')
    expect(overall(c('pass', 'pending'))).toBe('pending')
    expect(overall(c('pass', 'skipped'))).toBe('pass')
    expect(overall(c('skipped'))).toBe('skipped')
    expect(overall([])).toBeNull()
  })
})
