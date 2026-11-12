/**
 * Re-indents JSON without re-reading its values, so numbers and the order of keys stay exactly as written. Throws
 * when the text isn't JSON.
 */
export function formatJson(text: string, indent = '  ') {
  JSON.parse(text)
  const empty = /\s*([}\]])/y
  let out = ''
  let depth = 0
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') out += text[++i]
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === '{' || c === '[') {
      empty.lastIndex = i + 1
      const closed = empty.exec(text)
      if (closed) {
        out += c + closed[1]
        i += closed[0].length
      } else out += `${c}\n${indent.repeat(++depth)}`
    } else if (c === '}' || c === ']') out += `\n${indent.repeat(--depth)}${c}`
    else if (c === ',') out += `,\n${indent.repeat(depth)}`
    else if (c === ':') out += ': '
    else if (!/\s/.test(c)) out += c
  }
  return `${out}\n`
}
