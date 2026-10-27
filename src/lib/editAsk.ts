/** What came back from ⌘I in the editor (see src-tauri/src/ask.rs): code to put in place of the selection, or an answer. */
export type EditReply = { kind: 'edit'; code: string } | { kind: 'answer'; text: string }

/** How much of the file either side of the selection goes with the request: plenty for a file of ordinary size. */
const AROUND = 60_000

/** The file around the selection, cut down either side to what's sent with the request. */
export function contextAround(doc: string, from: number, to: number) {
  const before = doc.slice(Math.max(0, from - AROUND), from)
  const after = doc.slice(to, to + AROUND)
  return {
    before: from > AROUND ? `…\n${before.slice(before.indexOf('\n') + 1)}` : before,
    selected: doc.slice(from, to),
    after: doc.length - to > AROUND ? `${after.slice(0, after.lastIndexOf('\n') + 1)}…` : after,
  }
}

/**
 * Claude's reply: EDIT then a fenced code block, or ANSWER then text. A reply that doesn't say which is an answer,
 * unless it's nothing but one code block. The code keeps the selection's trailing newline as it was: models tend to add
 * or drop one.
 */
export function parseReply(reply: string, selected: string): EditReply {
  const text = reply.trim()
  const head = text.match(/^(EDIT|ANSWER)\s*\n?/)
  const body = head ? text.slice(head[0].length) : text
  const fence = body.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/)
  if (head?.[1] === 'ANSWER' || !fence) {
    if (head?.[1] === 'EDIT' && body) return { kind: 'edit', code: keepEnding(body, selected) }
    return { kind: 'answer', text: body }
  }
  return { kind: 'edit', code: keepEnding(fence[2], selected) }
}

function keepEnding(code: string, selected: string) {
  const bare = code.replace(/\n+$/, '')
  return selected.endsWith('\n') ? `${bare}\n` : bare
}
