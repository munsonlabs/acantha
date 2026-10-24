import { describe, expect, it } from 'vitest'
import { parseTour } from './tour'

describe('parseTour', () => {
  const exists = (p: string) => ['src/main.ts', 'src/app.ts'].includes(p)

  it('reads the stops, wrapped or not, keeping only real files and sensible lines', () => {
    const answer =
      'Here you go:\n```json\n[{"title":"Entry","file":"./src/main.ts","start":3,"end":9,"note":"Starts it."},{"title":"Gone","file":"src/nope.ts","start":1,"end":2,"note":""},{"title":"App","file":"src/app.ts","start":"12","end":5,"note":"The app."}]\n```'
    expect(parseTour(answer, exists)).toEqual([
      { title: 'Entry', file: 'src/main.ts', start: 3, end: 9, note: 'Starts it.' },
      // The end can't come before the start.
      { title: 'App', file: 'src/app.ts', start: 12, end: 12, note: 'The app.' },
    ])
  })

  it('gives nothing for an answer without a tour in it', () => {
    expect(parseTour('Sorry, I could not read the code.', exists)).toEqual([])
    expect(parseTour('[not json]', exists)).toEqual([])
  })
})
