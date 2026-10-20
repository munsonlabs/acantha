import { describe, expect, it } from 'vitest'
import { prepareCanvas, parseSlackLink, renderSlackText } from './slack'

describe('parseSlackLink', () => {
  it('reads a message link', () => {
    expect(parseSlackLink('https://example.slack.com/archives/C0123ABC/p1729012345678900')).toEqual({
      kind: 'message',
      channel: 'C0123ABC',
      ts: '1729012345.678900',
      threadTs: null,
    })
  })

  it('reads a reply link with its thread', () => {
    const link = parseSlackLink('https://example.slack.com/archives/C0123ABC/p1729012399000100?thread_ts=1729012345.678900&cid=C0123ABC')
    expect(link).toMatchObject({ ts: '1729012399.000100', threadTs: '1729012345.678900' })
  })

  it('reads a canvas link', () => {
    expect(parseSlackLink('https://example.slack.com/docs/T0AAA/F0BBB')).toEqual({ kind: 'canvas', file: 'F0BBB' })
  })

  it('ignores anything else', () => {
    expect(parseSlackLink('https://example.com/archives/C1/p1729012345678900')).toBeNull()
    expect(parseSlackLink('https://example.slack.com/messages/C1')).toBeNull()
    expect(parseSlackLink('not a link')).toBeNull()
  })
})

describe('renderSlackText', () => {
  const users = { U1: { id: 'U1', name: 'Ann', avatar: null } }

  it('turns links and mentions into markup', () => {
    expect(renderSlackText('see <https://x.dev/a?b=1&amp;c=2|the doc> <@U1> <#C1|merge> <!here>', users)).toBe(
      'see <a href="https://x.dev/a?b=1&amp;c=2">the doc</a> <span class="mention">@Ann</span> <span class="mention">#merge</span> <span class="mention">@here</span>',
    )
  })

  it('formats text but not code', () => {
    expect(renderSlackText('*bold* _it_ ~gone~ `*not*`')).toBe('<b>bold</b> <i>it</i> <s>gone</s> <code>*not*</code>')
    expect(renderSlackText('```\nconst a = 1 < 2\n```')).toBe('<pre><code>const a = 1 &lt; 2</code></pre>')
  })

  it('quotes, breaks lines and swaps emoji', () => {
    expect(renderSlackText('&gt; quoted\nreply :tada:')).toBe('<blockquote>quoted</blockquote>reply 🎉')
  })

  it('knows every standard emoji, skin tones and Slack spellings, and leaves custom ones alone', () => {
    expect(renderSlackText(':rocket: :thumbsup::skin-tone-3: :large_green_circle: :partyparrot:')).toBe('🚀 👍🏼 🟢 :partyparrot:')
  })

  it('escapes anything that looks like HTML', () => {
    expect(renderSlackText('a "b" <script>')).toBe('a &quot;b&quot; &lt;script&gt;')
    expect(renderSlackText('&lt;img src=x onerror=alert(1)&gt;')).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('prepareCanvas', () => {
  it("turns Slack's emoji pictures back into emoji", () => {
    const html =
      '<h1><control><img src="https://slack-imgs.com/x" alt="desktop_computer" data-is-slack style="w">:desktop_computer:</img></control> Setup</h1>'
    expect(prepareCanvas(html)).toBe('<h1><control>🖥️</control> Setup</h1>')
  })

  it('handles a picture without its fallback text, and leaves unknown ones as names', () => {
    expect(prepareCanvas('<p><img alt="warning" src="x"> mind <img alt="partyparrot" src="y"></p>')).toBe('<p>⚠️ mind :partyparrot:</p>')
  })

  it("makes Slack's <lnk> tags ordinary links", () => {
    expect(prepareCanvas('<li><span>1. <lnk href="https://x.dev/pr/1">the PR</lnk></span></li>')).toBe(
      '<li><span>1. <a href="https://x.dev/pr/1">the PR</a></span></li>',
    )
  })

  it('leaves attributes alone', () => {
    expect(prepareCanvas('<a href="https://x.dev/:tada:">:tada:</a>')).toBe('<a href="https://x.dev/:tada:">🎉</a>')
  })
})
