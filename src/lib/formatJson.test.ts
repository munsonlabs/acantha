import { describe, expect, it } from 'vite-plus/test'
import { formatJson } from './formatJson'

describe('formatJson', () => {
  it('indents nested values and keeps empty ones closed', () => {
    expect(formatJson('{"a":[1,{"b":null}],"c":{},"d":[ ]}')).toBe(
      '{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ],\n  "c": {},\n  "d": []\n}\n',
    )
  })

  it('leaves strings, numbers and key order as written', () => {
    const text = '{"10":1.0,"2":12345678901234567890,"s":"a, {b}: \\"c\\" \\\\"}'
    expect(formatJson(text)).toBe('{\n  "10": 1.0,\n  "2": 12345678901234567890,\n  "s": "a, {b}: \\"c\\" \\\\"\n}\n')
    expect(formatJson(formatJson(text))).toBe(formatJson(text))
  })

  it('refuses what is not JSON', () => {
    expect(() => formatJson('{a: 1}')).toThrow()
  })
})
