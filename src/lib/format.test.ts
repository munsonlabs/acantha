import { describe, expect, it } from 'vite-plus/test'
import { reflowMessage } from './format'

describe('reflowMessage', () => {
  it('joins hard-wrapped paragraph lines', () => {
    expect(reflowMessage('A glowing graph on a tile, in the\napp lane colours.')).toBe('A glowing graph on a tile, in the app lane colours.')
  })

  it('keeps blank lines, list items and trailers, joining wrapped list items', () => {
    const text = 'Subject\n\n- First item that is\n  continued here\n- Second item\n\nCo-Authored-By: Someone <a@b.c>'
    expect(reflowMessage(text)).toBe('Subject\n\n- First item that is continued here\n- Second item\n\nCo-Authored-By: Someone <a@b.c>')
  })

  it('leaves indented code alone', () => {
    expect(reflowMessage('Run this:\n\n    npm test\n    npm run build')).toBe('Run this:\n\n    npm test\n    npm run build')
  })
})
