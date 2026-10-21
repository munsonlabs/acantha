import { describe, expect, it } from 'vitest'
import { wordsIn } from './words'

describe('wordsIn', () => {
  it('finds each identifier once, skipping short words and numbers', () => {
    expect([...wordsIn('const formatDate = (d) => formatDate(d) + 1234 + $store.café_x')]).toEqual(['const', 'formatDate', '$store', 'café_x'])
  })
})
