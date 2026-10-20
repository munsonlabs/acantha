export interface TodoDraft {
  text: string
  done: boolean
}

const BULLET = /^\s*(?:[-*+•◦▪‣–]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/
const CHECKBOX = /^\s*\[([ xX])\]\s+(.+?)\s*$/

/** The bulleted, numbered or checkbox lines in some text, as to-dos. `- [x] done` and `[x] done` start ticked. */
export function parseBullets(text: string): TodoDraft[] {
  const out: TodoDraft[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(BULLET) ?? line.match(CHECKBOX)
    if (!m) continue
    const [, box, item] = m
    out.push({ text: item, done: !!box && box.toLowerCase() === 'x' })
  }
  return out
}

/** Every non-empty line, bullet or not: for pasting into a list's "add" box. */
export function parseLines(text: string): TodoDraft[] {
  const bullets = parseBullets(text)
  if (bullets.length) return bullets
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, done: false }))
}

/** Slack's markup as plain text: links become their label, mentions their name, emphasis marks go. */
export function slackPlain(text: string, names: Record<string, string> = {}) {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id: string, label?: string) => `@${names[id] ?? label ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(\w+)(?:\^[^|>]*)?(?:\|([^>]+))?>/g, (_, name: string, label?: string) => label ?? `@${name}`)
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/(^|\s)[*_~]([^*_~\n]+)[*_~](?=$|[\s.,!?:;)])/g, '$1$2')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
