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

/**
 * Every non-empty line as a to-do, with any bullet, number or checkbox taken off. Lists copied from Slack or a canvas
 * often lose some of their markers, so unmarked lines count too; only an unmarked heading ending in ":" is left out.
 */
export function parseLines(text: string): TodoDraft[] {
  const out: TodoDraft[] = []
  for (const line of text.split(/\r?\n/)) {
    const marked = parseBullets(line)[0]
    if (marked) out.push(marked)
    else if (line.trim() && !/:\s*$/.test(line)) out.push({ text: line.trim(), done: false })
  }
  return out
}

/** Whether pasted text is a list worth turning into to-dos: two or more bullet or numbered lines. */
export const looksLikeList = (text: string) => parseBullets(text).length >= 2

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
