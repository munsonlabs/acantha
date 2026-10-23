import { describe, expect, it } from 'vite-plus/test'
import { applyEvent, newChat, toolSummary, type Entry } from './claudeChat'

// Shapes as Claude Code 2.1 prints them (from a real run), trimmed to what's read.
const msgId = 'msg_1'
const stream = (event: object) => ({ type: 'stream_event', event, api_message_id: msgId })

describe('applyEvent', () => {
  it('builds a reply from streamed text and a tool call, then the tool result', () => {
    const s = newChat()
    applyEvent(s, { type: 'system', subtype: 'init', session_id: 'abc', model: 'claude-haiku-5-5' })
    applyEvent(s, stream({ type: 'message_start', message: { id: msgId } }))
    applyEvent(s, stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
    applyEvent(s, stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }))
    applyEvent(s, stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Prob' } }))
    applyEvent(s, stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ably.' } }))
    applyEvent(s, stream({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'Bash', input: {} } }))
    applyEvent(s, stream({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":' } }))
    applyEvent(s, stream({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"ls"}' } }))
    applyEvent(s, stream({ type: 'content_block_stop', index: 2 }))
    applyEvent(s, {
      type: 'assistant',
      message: { id: msgId, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
    })
    applyEvent(s, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt', is_error: false }] } })
    applyEvent(s, { type: 'result', subtype: 'success', session_id: 'abc', total_cost_usd: 0.0025 })

    const reply = s.entries[0] as Extract<Entry, { kind: 'assistant' }>
    expect(s.sessionId).toBe('abc')
    expect(reply.blocks[1]).toEqual({ kind: 'text', text: 'Probably.' })
    expect(reply.blocks[2]).toMatchObject({ kind: 'tool', name: 'Bash', input: { command: 'ls' }, result: 'a.txt', isError: false })
    expect(s.cost).toBe(0.0025)
    expect(s.working).toBe(false)
  })

  it('takes a whole message that never streamed', () => {
    const s = newChat()
    applyEvent(s, { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } })
    expect(s.entries).toEqual([{ kind: 'assistant', id: 'm2', blocks: [{ kind: 'text', text: 'Done.' }] }])
  })

  it('turns a permission request into an approval, and answers it', () => {
    const s = newChat()
    const a = applyEvent(s, {
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'touch x' }, blocked_path: '/r/x' },
    })
    expect(a).toMatchObject({ requestId: 'r1', tool: 'Bash', path: '/r/x' })
    expect(s.approvals).toHaveLength(1)
    // Answered from any window, it goes from all of them.
    applyEvent(s, { type: 'acantha_answered', request_id: 'r1', allow: true })
    expect(s.approvals).toHaveLength(0)
  })

  it('carries the cost across processes of the same conversation', () => {
    const s = newChat()
    applyEvent(s, { type: 'result', total_cost_usd: 0.01 })
    applyEvent(s, { type: 'acantha_exit' })
    applyEvent(s, { type: 'result', total_cost_usd: 0.02 })
    expect(s.cost).toBeCloseTo(0.03)
  })
})

describe("Acantha's own lines", () => {
  it('records messages sent, stops and clears', () => {
    const s = newChat()
    applyEvent(s, { type: 'acantha_user', text: 'hello' })
    expect(s.entries).toEqual([{ kind: 'user', text: 'hello' }])
    expect(s.working).toBe(true)
    applyEvent(s, { type: 'acantha_stopped' })
    expect(s.working).toBe(false)
    applyEvent(s, { type: 'acantha_cleared' })
    expect(s.entries).toEqual([])
  })
})

describe('interrupting and commands', () => {
  it('shows an interruption once, not the error the interrupted turn ends with', () => {
    const s = newChat()
    applyEvent(s, { type: 'acantha_user', text: 'write a story' })
    applyEvent(s, { type: 'acantha_interrupted' })
    applyEvent(s, { type: 'result', subtype: 'error_during_execution', is_error: true })
    expect(s.entries.at(-1)).toEqual({ kind: 'notice', text: 'Interrupted.' })
    expect(s.working).toBe(false)
    // The next error is one.
    applyEvent(s, { type: 'result', is_error: true, result: 'Overloaded' })
    expect(s.entries.at(-1)).toMatchObject({ error: true, text: 'Overloaded' })
  })

  it('takes the slash commands: names, then descriptions', () => {
    const s = newChat()
    applyEvent(s, { type: 'system', subtype: 'init', slash_commands: ['compact', 'review'] })
    expect(s.commands).toEqual([{ name: 'compact' }, { name: 'review' }])
    applyEvent(s, { type: 'system', subtype: 'commands_changed', commands: [{ name: 'compact', description: 'Summarise', argumentHint: '' }] })
    expect(s.commands).toEqual([{ name: 'compact', description: 'Summarise', hint: undefined }])
  })
})

describe('toolSummary', () => {
  const rel = (p: string) => p.replace('/repo/', '')
  it('says what a tool call did', () => {
    expect(toolSummary('Bash', { command: 'npm test' }, rel)).toBe('$ npm test')
    expect(toolSummary('Edit', { file_path: '/repo/src/x.ts' }, rel)).toBe('Edited src/x.ts')
    expect(toolSummary('mcp__thing', {}, rel)).toBe('mcp__thing')
  })
})
