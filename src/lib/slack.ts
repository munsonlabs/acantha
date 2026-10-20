import { invoke } from '@tauri-apps/api/core'
import { nameToEmoji } from 'gemoji'

export type SlackLink = { kind: 'message'; channel: string; ts: string; threadTs: string | null } | { kind: 'canvas'; file: string }

/**
 * A message link (Copy link on a message: `…/archives/C123/p1729012345678900`, with `?thread_ts=…` for a reply) or a
 * canvas link (`…/docs/T123/F456`). Anything else is null.
 */
export function parseSlackLink(text: string): SlackLink | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (!/(^|\.)slack\.com$/.test(url.hostname)) return null
  const message = url.pathname.match(/^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})\/?$/)
  if (message) return { kind: 'message', channel: message[1], ts: `${message[2]}.${message[3]}`, threadTs: url.searchParams.get('thread_ts') }
  const canvas = url.pathname.match(/^\/docs\/[A-Z0-9]+\/(F[A-Z0-9]+)\/?$/)
  if (canvas) return { kind: 'canvas', file: canvas[1] }
  return null
}

export interface SlackUser {
  id: string
  name: string
  avatar: string | null
}

export interface SlackMessage {
  ts: string
  user: string | null
  author: string | null
  text: string
  files: { name: string; permalink: string | null }[]
  edited: boolean
}

export interface SlackThread {
  channel: string
  messages: SlackMessage[]
  users: Record<string, SlackUser>
}

export interface SlackCanvas {
  title: string
  html: string
  channels: string[]
  permalink: string | null
}

/** `allowed`: channel IDs that may be read; empty for any the token can see. */
export const slack = {
  thread: (channel: string, ts: string, threadTs: string | null, allowed: string[]) =>
    invoke<SlackThread>('slack_thread', { channel, ts, threadTs, allowed }),
  canvas: (file: string, allowed: string[]) => invoke<SlackCanvas>('slack_canvas', { file, allowed }),
}

/** Slack's names that GitHub's emoji list (gemoji) spells differently. */
const SLACK_EMOJI: Record<string, string> = {
  simple_smile: '🙂',
  large_green_circle: '🟢',
  large_yellow_circle: '🟡',
  large_orange_circle: '🟠',
  large_purple_circle: '🟣',
  large_brown_circle: '🟤',
  large_green_square: '🟩',
  large_yellow_square: '🟨',
  large_red_square: '🟥',
  large_blue_square: '🟦',
  white_frowning_face: '☹️',
  thumbsup_all: '👍',
}

const SKIN_TONES = ['', '', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']

const EMOJI_CODE = /:([a-z0-9_+'-]+):(?::skin-tone-([2-6]):)?/g

/** Every `:name:` in plain text as its emoji. */
export const replaceEmoji = (text: string) => text.replace(EMOJI_CODE, (m, name: string, tone?: string) => emoji(name, tone) ?? m)

/**
 * A canvas as Slack exports it, with its emoji as text. Slack writes each one as a picture,
 * `<img alt="name" src="…">:name:</img>`, and the picture needs the token to load.
 */
export function canvasEmoji(html: string) {
  const named = html.replace(/<img\b[^>]*\balt="([a-z0-9_+'-]+)"[^>]*>(?::\1:)?(?:<\/img>)?/g, ':$1:')
  // Only in text, between tags, so attributes and URLs are left alone.
  return named.replace(/>([^<]+)</g, (_, text: string) => `>${replaceEmoji(text)}<`)
}

/** `:name:`, with Slack's `::skin-tone-N:` after it, as the emoji. Custom workspace emoji stay as text. */
function emoji(name: string, tone?: string) {
  const found = SLACK_EMOJI[name] ?? nameToEmoji[name]
  if (!found) return null
  // A skin tone replaces the emoji's variation selector, if it has one.
  return tone ? found.replace(/\uFE0F$/, '') + SKIN_TONES[Number(tone)] : found
}

const escape = (s: string) =>
  s
    .replace(/&(?!(?:amp|lt|gt|quot|#\d+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Slack's message markup as HTML: links, mentions, `code`, ```blocks```, *bold*, _italic_, ~strike~, > quotes and
 * common :emoji:. Slack sends `&`, `<` and `>` in text already escaped; everything is escaped again on the way out,
 * and the result should still go through DOMPurify before it's shown.
 */
export function renderSlackText(text: string, users: Record<string, SlackUser> = {}): string {
  const held: string[] = []
  const hold = (html: string) => `\uE000${held.push(html) - 1}\uE000`

  let s = text
    .replace(/```\n?([\s\S]*?)```/g, (_, code: string) => hold(`<pre><code>${escape(code.replace(/\n$/, ''))}</code></pre>`))
    .replace(/`([^`\n]+)`/g, (_, code: string) => hold(`<code>${escape(code)}</code>`))
    .replace(/<([^<>\s][^<>]*)>/g, (_, inner: string) => {
      const [target, label] = inner.split('|', 2)
      if (target.startsWith('@')) {
        const id = target.slice(1)
        return hold(`<span class="mention">@${escape(users[id]?.name ?? label ?? id)}</span>`)
      }
      if (target.startsWith('#')) return hold(`<span class="mention">#${escape(label ?? target.slice(1))}</span>`)
      if (target.startsWith('!')) {
        const special = target.slice(1).split('^')[0]
        return hold(`<span class="mention">${escape(label ?? `@${special}`)}</span>`)
      }
      if (/^(https?:|mailto:)/.test(target)) return hold(`<a href="${escape(target)}">${escape(label ?? target)}</a>`)
      return hold(escape(`<${inner}>`))
    })

  s = escape(s)
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/gm, '$1<b>$2</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/gm, '$1<i>$2</i>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?:;])/gm, '$1<s>$2</s>')
    .replace(EMOJI_CODE, (m, name: string, tone?: string) => emoji(name, tone) ?? m)

  // Quotes: consecutive lines starting with "> ".
  s = s.replace(/(?:^&gt; ?.*(?:\n|$))+/gm, (block) => `<blockquote>${block.replace(/^&gt; ?/gm, '').replace(/\n$/, '')}</blockquote>`)
  s = s.replace(/\n/g, '<br>').replace(/<\/blockquote><br>/g, '</blockquote>')
  return s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => held[Number(i)])
}
