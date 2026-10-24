import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import { applyEvent, newChat, type Approval, type SlashCommand } from '@/lib/claudeChat'
import { prune, type SavedConversation } from '@/lib/claudeView'
import { prefs } from './prefs'
import { usePersisted } from './usePersisted'

export type { SavedConversation }
export type ClaudeMode = 'auto' | 'plan' | 'default' | 'acceptEdits'

/** The slash commands Claude Code last said it has, to offer before a conversation's started it. */
const knownCommands = usePersisted<SlashCommand[]>('claude-commands', [])

/** Every conversation, open or past, by id (an open one's is its agent's). */
export const conversations = usePersisted<Record<string, SavedConversation>>('claude-conversations', {}, { sync: true })

const keep = () => ({ days: prefs.claudeKeepDays.value, perRepo: prefs.claudeKeepPerRepo.value })
conversations.value = prune(conversations.value, keep())
// Tighter limits take effect straight away.
watch([prefs.claudeKeepDays, prefs.claudeKeepPerRepo], () => (conversations.value = prune(conversations.value, keep())))
// Where sessions were kept before there could be more than one conversation a repository.
try {
  localStorage.removeItem('acantha:claude-sessions')
} catch {}

const newId = () => Math.random().toString(36).slice(2, 10)

function save(id: string, change: Partial<SavedConversation> | null) {
  const rest = { ...conversations.value }
  if (change) rest[id] = { ...rest[id], ...change }
  else delete rest[id]
  conversations.value = rest
}

/** A repository's past conversations, newest first. */
/** A repository's past conversations that ran in `cwd` (Claude Code keeps sessions by folder), newest first. */
export const pastConversations = (repo: string, cwd = repo) =>
  Object.entries(conversations.value)
    .filter(([, c]) => c.closed && c.repo === repo && (c.cwd ?? c.repo) === cwd && c.sessionId)
    .sort(([, a], [, b]) => b.updated - a.updated)
    .map(([id, c]) => ({ id, ...c }))

/** Its tab's closed: Claude stops, and the conversation goes in the past ones (if anything was said). */
export function closeConversation(id: string) {
  void invoke('claude_close', { id })
  const c = conversations.value[id]
  if (c) save(id, c.sessionId ? { closed: true } : null)
}

/** Forgets a repository's conversations, open and past: its tab is closed. */
export function forgetRepo(repo: string) {
  for (const [id, c] of Object.entries(conversations.value)) {
    if (c.repo !== repo) continue
    void invoke('claude_close', { id })
    save(id, null)
  }
}

/**
 * Deletes a past conversation for good: from the list, and the session Claude Code keeps, so `claude --resume` won't
 * find it either. Pruning and closing a repository only take them off the list.
 */
export async function deleteConversation(id: string) {
  const session = conversations.value[id]?.sessionId
  save(id, null)
  if (session) await invoke('claude_delete_session', { session }).catch(() => {})
}

/** Every past conversation, newest first, across repositories. */
export const allPast = () =>
  Object.entries(conversations.value)
    .filter(([, c]) => c.closed && c.sessionId)
    .sort(([, a], [, b]) => b.updated - a.updated)
    .map(([id, c]) => ({ id, ...c }))

/** Deletes every past conversation for good. Open ones stay. */
export async function deleteAllPast() {
  await Promise.all(allPast().map((c) => deleteConversation(c.id)))
}

/**
 * A view of one conversation (`id`, an agent tab's) in a repository, run in `cwd`: the repository, or a worktree of it
 * the agent has to itself. The conversation lives in the app's backend
 * (src-tauri/src/claude.rs), so the panel and a popped-out window show the same one. Subscribing replays what's been
 * said (from Claude Code's own record of the session, after a restart), then follows along; what you do here goes back
 * there, and every view sees it. Ends with the component (or scope) that made it.
 */
export function useClaudeConversation(id: string, root: string, cwd = root) {
  const chat = reactive(newChat())
  const mode = ref<ClaudeMode>(prefs.claudeMode.value)
  const model = ref<string>(prefs.claudeModel.value)
  const name = root.split('/').pop() ?? root
  const fresh = (): SavedConversation => ({ repo: root, ...(cwd !== root ? { cwd } : {}), updated: Date.now() })
  if (!conversations.value[id]) save(id, fresh())
  let viewId: number | null = null
  let disposed = false
  /** Which subscription is current: one replaced by a resume may still have lines on the way. */
  let gen = 0

  function onLine(line: string) {
    try {
      applyEvent(chat, JSON.parse(line))
    } catch {
      return
    }
    if (chat.commands.some((c) => c.description) && chat.commands !== knownCommands.value) knownCommands.value = chat.commands
    const saved = conversations.value[id]
    if (!saved) return
    if (chat.sessionId && saved.sessionId !== chat.sessionId) save(id, { sessionId: chat.sessionId })
    const first = !saved.title && chat.entries.find((e) => e.kind === 'user')
    if (first) save(id, { title: first.text.slice(0, 80) })
  }

  function connect() {
    const channel = new Channel<string>()
    const mine = ++gen
    channel.onmessage = (line) => mine === gen && onLine(line)
    const saved = conversations.value[id]?.sessionId
    void invoke<number>('claude_subscribe', { id, resume: saved ?? null, onEvent: channel }).then((view) => {
      viewId = view
      if (disposed) void invoke('claude_unsubscribe', { id, view })
      // A saved session whose history Claude Code no longer has to show: it still remembers it.
      if (!chat.entries.length && saved)
        chat.entries.push({ kind: 'notice', text: 'Carrying on from last time: Claude remembers the conversation, though it isn’t shown here.' })
    })
  }
  connect()
  onScopeDispose(() => {
    disposed = true
    if (viewId != null) void invoke('claude_unsubscribe', { id, view: viewId })
  })

  async function send(text: string) {
    const message = text.trim()
    if (!message) return
    // Claude Code's /clear would leave this showing what it's forgotten: a new conversation instead.
    if (message === '/clear') return clear()
    save(id, { updated: Date.now() })
    try {
      await invoke('claude_send', { id, repo: cwd, text: message, mode: mode.value, model: model.value || null })
    } catch (e) {
      chat.entries.push({ kind: 'notice', text: String(e), error: true })
    }
  }

  const answer = (a: Approval, allow: boolean) =>
    invoke('claude_answer', { id, requestId: a.requestId, allow, input: a.input }).catch((e) =>
      chat.entries.push({ kind: 'notice', text: String(e), error: true }),
    )

  /** Stops the reply under way, as Esc does in the terminal; Claude carries on from there with the next message. */
  const interrupt = () => invoke('claude_interrupt', { id })

  /** The slash commands to offer: this conversation's, or the last ones Claude Code listed, before it's started. */
  const commands = computed(() => (chat.commands.length ? chat.commands : knownCommands.value).filter((c) => !c.name.startsWith('_')))

  /** A new conversation in this tab; the one it had goes in the past ones, to pick up again. */
  async function clear() {
    const saved = conversations.value[id]
    if (saved?.sessionId) save(newId(), { ...saved, closed: true })
    await invoke('claude_clear', { id })
    save(id, null)
    save(id, fresh())
  }

  /** Carries on a past conversation in this tab, in place of what's here. */
  function resume(pastId: string) {
    const past = conversations.value[pastId]
    if (!past?.sessionId) return
    if (viewId != null) void invoke('claude_unsubscribe', { id, view: viewId })
    viewId = null
    // Not claude_close: that would close this conversation's window, which may be where this is.
    void invoke('claude_reset', { id })
    save(pastId, null)
    save(id, null)
    save(id, { ...past, closed: false, updated: Date.now() })
    Object.assign(chat, newChat())
    connect()
  }

  /** A new mode or model applies from the next message: an idle Claude is let go, and the next message resumes. */
  async function setMode(m: ClaudeMode) {
    mode.value = prefs.claudeMode.value = m
    if (!chat.working) await invoke('claude_stop', { id })
  }
  async function setModel(m: string) {
    model.value = prefs.claudeModel.value = m
    if (!chat.working) await invoke('claude_stop', { id })
  }

  const status = computed(() => (chat.approvals.length ? 'waiting' : chat.working ? 'working' : 'idle'))

  return { id, root, cwd, name, chat, mode, model, status, commands, send, answer, interrupt, clear, resume, setMode, setModel }
}
