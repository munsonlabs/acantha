/**
 * A Claude Code conversation, built up from the JSON lines `claude -p --output-format stream-json` prints: text as it's
 * written (from partial messages), tool calls and their results, permission requests, and the cost; plus Acantha's own
 * lines (`acantha_…`, see src-tauri/src/claude.rs) for messages sent, requests answered, stops and clears. Every view
 * of a conversation replays the same lines, so they all agree. `applyEvent` takes one line at a time.
 */

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thinking' }
  | {
      kind: 'tool'
      id: string
      name: string
      input: Record<string, unknown>
      /** The input as it streams in, until it's complete. */
      inputJson: string
      result?: string
      isError?: boolean
    }

export type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; id: string; blocks: Block[] }
  | { kind: 'notice'; text: string; error?: boolean }

/** Claude asking before it uses a tool: answered with `approvalResponse`. */
export interface Approval {
  requestId: string
  tool: string
  input: Record<string, unknown>
  description?: string
  /** The file it would change, when that's what needs approval. */
  path?: string
}

/** A slash command Claude Code offers: built in, a skill, or one of the repository's own. */
export interface SlashCommand {
  name: string
  description?: string
  hint?: string
}

export interface ChatState {
  entries: Entry[]
  /** The slash commands Claude Code says it has, once it's running. */
  commands: SlashCommand[]
  /** Interrupted, so the error the interrupted turn ends with isn't one to show. */
  interrupted: boolean
  approvals: Approval[]
  working: boolean
  sessionId: string | null
  model: string | null
  /** Dollars spent in this conversation, across the processes it ran in. */
  cost: number
  /** What earlier processes spent, to add this one's running total to. */
  costBefore: number
}

export const newChat = (): ChatState => ({
  entries: [],
  commands: [],
  interrupted: false,
  approvals: [],
  working: false,
  sessionId: null,
  model: null,
  cost: 0,
  costBefore: 0,
})

/** Longest tool result kept: enough to read, without keeping a whole log in memory. */
const RESULT_MAX = 4000

function resultText(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : '')).join('\n')
        : ''
  return text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}\n… (${text.length - RESULT_MAX} more characters)` : text
}

function findTool(state: ChatState, id: string) {
  for (const e of state.entries) if (e.kind === 'assistant') for (const b of e.blocks) if (b.kind === 'tool' && b.id === id) return b
  return undefined
}

function assistant(state: ChatState, id: string) {
  let entry = state.entries.find((e): e is Extract<Entry, { kind: 'assistant' }> => e.kind === 'assistant' && e.id === id)
  if (!entry) {
    entry = { kind: 'assistant', id, blocks: [] }
    state.entries.push(entry)
  }
  return entry
}

function block(content: Record<string, unknown>): Block {
  if (content.type === 'tool_use')
    return {
      kind: 'tool',
      id: String(content.id),
      name: String(content.name),
      input: (content.input as Record<string, unknown>) ?? {},
      inputJson: '',
    }
  if (content.type === 'text') return { kind: 'text', text: typeof content.text === 'string' ? content.text : '' }
  return { kind: 'thinking' }
}

/** Updates the conversation with one line of Claude Code's output. Returns a new approval request, if it was one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEvent(state: ChatState, e: any): Approval | null {
  switch (e?.type) {
    case 'system':
      if (e.subtype === 'init') {
        state.sessionId = e.session_id ?? state.sessionId
        state.model = e.model ?? state.model
        // Names only, at first; descriptions follow.
        if (!state.commands.length && Array.isArray(e.slash_commands))
          state.commands = e.slash_commands.filter((n: unknown) => typeof n === 'string').map((name: string) => ({ name }))
      } else if (e.subtype === 'commands_changed' && Array.isArray(e.commands)) {
        state.commands = e.commands
          .filter((c: { name?: unknown }) => typeof c?.name === 'string')
          .map((c: { name: string; description?: string; argumentHint?: string }) => ({
            name: c.name,
            description: c.description,
            hint: c.argumentHint || undefined,
          }))
      }
      return null
    case 'stream_event': {
      const ev = e.event
      const id = e.api_message_id ?? ev?.message?.id
      if (!id) return null
      if (ev.type === 'message_start') assistant(state, id)
      else if (ev.type === 'content_block_start') assistant(state, id).blocks[ev.index] = block(ev.content_block)
      else if (ev.type === 'content_block_delta') {
        const b = assistant(state, id).blocks[ev.index]
        if (b?.kind === 'text' && ev.delta.type === 'text_delta') b.text += ev.delta.text
        if (b?.kind === 'tool' && ev.delta.type === 'input_json_delta') b.inputJson += ev.delta.partial_json
      } else if (ev.type === 'content_block_stop') {
        const b = assistant(state, id).blocks[ev.index]
        if (b?.kind === 'tool' && b.inputJson) {
          try {
            b.input = JSON.parse(b.inputJson)
          } catch {
            // Left as it streamed; the full message brings the input too.
          }
        }
      }
      return null
    }
    case 'assistant': {
      // The whole message: fills in what streaming missed (or everything, if nothing streamed).
      const msg = e.message
      if (!msg?.id) return null
      const entry = assistant(state, msg.id)
      for (const content of msg.content ?? []) {
        if (content.type === 'tool_use') {
          const tool = findTool(state, content.id)
          if (tool) tool.input = content.input ?? tool.input
          else entry.blocks.push(block(content))
        } else if (content.type === 'text' && !entry.blocks.some((b) => b.kind === 'text' && b.text === content.text)) {
          // Streamed text is already there, the same; text that didn't stream is added.
          if (!entry.blocks.some((b) => b.kind === 'text')) entry.blocks.push(block(content))
        }
      }
      return null
    }
    case 'user': {
      for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (c.type !== 'tool_result') continue
        const tool = findTool(state, c.tool_use_id)
        if (tool) {
          tool.result = resultText(c.content)
          tool.isError = !!c.is_error
        }
      }
      return null
    }
    case 'control_request': {
      const r = e.request
      if (r?.subtype !== 'can_use_tool') return null
      const approval: Approval = {
        requestId: e.request_id,
        tool: r.display_name ?? r.tool_name,
        input: r.input ?? {},
        description: r.description,
        path: r.blocked_path,
      }
      state.approvals.push(approval)
      return approval
    }
    case 'result':
      state.working = false
      state.sessionId = e.session_id ?? state.sessionId
      if (typeof e.total_cost_usd === 'number') state.cost = state.costBefore + e.total_cost_usd
      if (e.is_error && !state.interrupted) state.entries.push({ kind: 'notice', text: e.result || 'Claude stopped with an error.', error: true })
      state.interrupted = false
      return null
    case 'acantha_interrupted':
      state.entries.push({ kind: 'notice', text: 'Interrupted.' })
      state.interrupted = true
      state.approvals = []
      return null
    case 'acantha_user':
      state.entries.push({ kind: 'user', text: String(e.text ?? '') })
      state.working = true
      return null
    case 'acantha_answered':
      state.approvals = state.approvals.filter((a) => a.requestId !== e.request_id)
      return null
    case 'acantha_stopped':
      // Claude let go between messages (for a new mode or model), or the end of a resumed session's history.
      state.working = false
      state.interrupted = false
      state.approvals = []
      state.costBefore = state.cost
      return null
    case 'acantha_cleared':
      Object.assign(state, newChat())
      return null
    case 'acantha_exit':
      if (e.stderr && state.working) state.entries.push({ kind: 'notice', text: String(e.stderr), error: true })
      state.working = false
      state.approvals = []
      state.costBefore = state.cost
      return null
    default:
      return null
  }
}

/** A tool call in a line: what it did, for its card ("$ npm test", "Edited src/x.ts"). */
export function toolSummary(name: string, input: Record<string, unknown>, rel: (path: string) => string) {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (name) {
    case 'Bash':
      return `$ ${s('command')}`
    case 'Read':
      return `Read ${rel(s('file_path'))}`
    case 'Write':
      return `Wrote ${rel(s('file_path'))}`
    case 'Edit':
    case 'MultiEdit':
      return `Edited ${rel(s('file_path'))}`
    case 'Grep':
      return `Searched for “${s('pattern')}”`
    case 'Glob':
      return `Looked for ${s('pattern')}`
    case 'WebFetch':
      return `Fetched ${s('url')}`
    case 'WebSearch':
      return `Searched the web for “${s('query')}”`
    case 'Task':
    case 'Agent':
      return `Agent: ${s('description')}`
    case 'TodoWrite':
      return 'Updated its to-do list'
    default:
      return name
  }
}
