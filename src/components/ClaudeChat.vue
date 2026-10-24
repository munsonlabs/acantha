<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { toolSummary, type Block } from '@/lib/claudeChat'
import { deleteConversation, loadOpenCodeModels, pastConversations, useClaudeConversation, type ClaudeMode } from '@/composables/claude'
import { prefs } from '@/composables/prefs'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'
import { AGENT_NAMES, MODES, MODELS, SUGGESTIONS, TOOL_ICONS, asking, costText, editDiff, statusWords, when, type AgentKind } from '@/lib/claudeView'

/**
 * A repository's Claude conversation: replies as they're written, tool calls as cards (edits as diffs), permission
 * requests as Allow / Deny cards, and the box to write in with the mode and model. The panel's has a bar along the top
 * for its own buttons (the `actions` slot). Files it mentions go to `open`.
 */
/** floating: in a popped-out window, with no bar or background: bubbles on the desktop, each with its own shadow. */
const props = defineProps<{ id: string; root: string; cwd?: string; kind?: AgentKind; floating?: boolean; draft?: string }>()
const emit = defineEmits<{ open: [path: string] }>()
const claude = useClaudeConversation(props.id, props.root, props.cwd ?? props.root, props.kind ?? 'claude')
const kindName = AGENT_NAMES[claude.kind]
/** Its mark: Claude's asterisk, or OpenCode's square. */
const mark = claude.kind === 'opencode' ? '▣' : '✳'
/** The models to pick from: Claude's aliases, or whatever OpenCode's set up with (asked once). */
const models = ref<{ id: string; label: string }[]>(claude.kind === 'opencode' ? [{ id: '', label: 'Default model' }] : MODELS)
if (claude.kind === 'opencode') void loadOpenCodeModels().then((list) => (models.value = [{ id: '', label: 'Default model' }, ...list]))
const chat = claude.chat

const draft = ref(props.draft ?? '')
const input = ref<HTMLTextAreaElement>()
const body = ref<HTMLElement>()
const expanded = ref(new Set<string>())

/** Keeps the newest in view as it's written, unless you've scrolled up to read. */
let pinned = true
const onScroll = () => {
  const el = body.value
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
watch(
  () => JSON.stringify(chat.entries.at(-1) ?? null).length + chat.approvals.length,
  async () => {
    await nextTick()
    if (pinned && body.value) body.value.scrollTop = body.value.scrollHeight
  },
)

function send(text = draft.value) {
  if (!text.trim()) return
  draft.value = ''
  pinned = true
  void claude.send(text)
}

/**
 * Typing a slash command: the ones Claude Code has that match, those starting with what's typed first. /clear is
 * Acantha's own: a new conversation in this tab. Esc puts the list away.
 */
const slashIndex = ref(0)
const slashShown = ref(true)
const CLEAR = { name: 'clear', description: 'Start a new conversation in this tab' }
const slash = computed(() => {
  const typed = /^\/(\S*)$/.exec(draft.value)
  if (!typed || !slashShown.value) return []
  const q = typed[1].toLowerCase()
  const starts = (c: { name: string }) => c.name.toLowerCase().startsWith(q)
  return [CLEAR, ...claude.commands.value.filter((c) => c.name !== 'clear')]
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!starts(a)) - Number(!starts(b)))
    .slice(0, 8)
})
watch(draft, () => {
  slashIndex.value = 0
  slashShown.value = true
})
function pick(c: { name: string }) {
  draft.value = `/${c.name} `
  input.value?.focus()
}

function onKey(e: KeyboardEvent) {
  const list = slash.value
  if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    slashIndex.value = (slashIndex.value + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length
  } else if (list.length && (e.key === 'Tab' || (e.key === 'Enter' && draft.value !== `/${list[slashIndex.value].name}`))) {
    e.preventDefault()
    pick(list[slashIndex.value])
  } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  } else if (e.key === 'Escape' && list.length) {
    e.preventDefault()
    slashShown.value = false
  } else if (e.key === 'Escape' && chat.working) {
    // As in the terminal: the reply stops, and Claude waits for the next message.
    e.preventDefault()
    void claude.interrupt()
  }
}

const rel = (path: string) => (path.startsWith(`${claude.cwd}/`) ? path.slice(claude.cwd.length + 1) : path)
function openFile(path: string) {
  const r = rel(path)
  if (!r.startsWith('/')) emit('open', r)
}
/**
 * Steps (tool calls) shown or folded away: folded, each reply's become one line saying how many and what, a spinner
 * and the step under way while it works, opening that reply's on a click.
 */
const showSteps = prefs.agentSteps
const openSteps = ref(new Set<string>())
type Tool = Extract<Block, { kind: 'tool' }>
const toolsOf = (blocks: (Block | undefined)[]) => blocks.filter((b): b is Tool => b?.kind === 'tool')
const firstTool = (blocks: (Block | undefined)[]) => blocks.findIndex((b) => b?.kind === 'tool')
function stepsLine(blocks: (Block | undefined)[]) {
  const tools = toolsOf(blocks)
  const running = tools.find((t) => t.result === undefined)
  if (running) return toolSummary(running.name, running.input, rel)
  const names = [...new Set(tools.map((t) => t.name))]
  return `${tools.length === 1 ? '1 step' : `${tools.length} steps`} · ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`
}
function toggleSteps(id: string) {
  const next = new Set(openSteps.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openSteps.value = next
}

const fileOf = (b: Extract<Block, { kind: 'tool' }>) => (typeof b.input.file_path === 'string' ? b.input.file_path : null)

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const statusText = computed(() => (claude.status.value === 'idle' ? kindName : statusWords(claude.status.value)))

const cost = () => costText(chat.cost)

/** This repository's past conversations, to pick one up again; a few, newest first. */
const past = computed(() => pastConversations(props.root, claude.cwd, claude.kind).slice(0, 6))

/**
 * A long conversation shows its latest messages, earlier ones a click away, so it costs the same however long it
 * runs: what's on screen is most of what it takes. (The whole of it stays with Claude Code.)
 */
const PAGE = 60
const showing = ref(PAGE)
const hidden = computed(() => Math.max(0, chat.entries.length - showing.value))
const visible = computed(() => chat.entries.slice(hidden.value))
// A new conversation starts at a page again.
watch(
  () => chat.entries.length === 0,
  (empty) => empty && (showing.value = PAGE),
)

defineExpose({ focus: () => input.value?.focus(), claude })
</script>

<template>
  <div class="claude-chat" :class="{ floating }">
    <div v-if="!floating" class="bar">
      <span class="avatar" :class="[claude.status.value, claude.kind]">{{ mark }}</span>
      <div class="who">
        <span class="name">{{ claude.name }}</span>
        <span class="status"
          >{{ statusText }}<template v-if="cost()"> · {{ cost() }}</template></span
        >
      </div>
      <div class="spacer" />
      <button class="ghost icon-btn" title="New conversation" :disabled="!chat.entries.length" @click="claude.clear()">
        <Icon name="plus" :size="14" />
      </button>
      <slot name="actions" />
    </div>
    <div ref="body" class="body" @scroll="onScroll">
      <div v-if="!chat.entries.length" class="welcome">
        <span class="big" :class="claude.kind">{{ mark }}</span>
        <h1>What can I help with in {{ claude.name }}?</h1>
        <p>{{ kindName }}, working in this repository with your own settings.</p>
        <div class="chips">
          <button v-for="s in SUGGESTIONS" :key="s" class="chip" @click="send(s)">{{ s }}</button>
        </div>
        <template v-if="past.length">
          <h2>Pick up where you left off</h2>
          <div class="chips past">
            <div
              v-for="p in past"
              :key="p.id"
              class="chip"
              role="button"
              tabindex="0"
              :title="p.title"
              @click="claude.resume(p.id)"
              @keydown.enter="claude.resume(p.id)"
            >
              <Icon name="history" :size="12" />
              <span class="what">{{ p.title || 'Untitled' }}</span>
              <span class="when">{{ when(p.updated) }}</span>
              <button class="ghost forget" title="Delete this conversation" @click.stop="deleteConversation(p.id)">
                <Icon name="x" :size="11" />
              </button>
            </div>
          </div>
        </template>
      </div>
      <button v-if="hidden" class="ghost earlier" @click="showing += PAGE">
        Show {{ Math.min(hidden, PAGE) }} earlier {{ Math.min(hidden, PAGE) === 1 ? 'message' : 'messages' }}
      </button>
      <template v-for="(e, i) in visible" :key="hidden + i">
        <div v-if="e.kind === 'user'" class="user">{{ e.text }}</div>
        <p v-else-if="e.kind === 'notice'" class="notice" :class="{ error: e.error }">{{ e.text }}</p>
        <div v-else class="assistant">
          <span class="avatar small" :class="claude.kind">{{ mark }}</span>
          <div class="said">
            <template v-for="(b, j) in e.blocks" :key="j">
              <MarkdownView
                v-if="b && b.kind === 'text' && b.text"
                class="text bubble"
                :source="b.text"
                path=""
                :repo="claude.cwd"
                :rev="null"
                @open="openFile"
              />
              <template v-else-if="b && b.kind === 'tool'">
                <!-- Folded, the reply's first step stands for them all: a line that opens them, and folds them again. -->
                <button
                  v-if="!showSteps && j === firstTool(e.blocks)"
                  class="ghost steps"
                  :class="{ error: toolsOf(e.blocks).some((t) => t.isError) }"
                  :title="openSteps.has(e.id) ? 'Fold this reply’s steps' : 'Show this reply’s steps'"
                  @click="toggleSteps(e.id)"
                >
                  <Icon name="chevron" :size="10" class="chev" :class="{ open: openSteps.has(e.id) }" />
                  <span v-if="toolsOf(e.blocks).some((t) => t.result === undefined)" class="spinner" />
                  <span class="summary">{{ stepsLine(e.blocks) }}</span>
                </button>
                <div v-if="showSteps || openSteps.has(e.id)" class="tool" :class="{ error: b.isError, running: b.result === undefined }">
                  <div class="tool-line" @click="toggle(b.id)">
                    <span class="tool-icon"><Icon :name="TOOL_ICONS[b.name] ?? 'app'" :size="12" /></span>
                    <span class="summary" :class="{ mono: b.name === 'Bash' }">{{ toolSummary(b.name, b.input, rel) }}</span>
                    <button v-if="fileOf(b)" class="ghost link" title="Open the file" @click.stop="openFile(fileOf(b)!)">
                      <Icon name="external" :size="11" />
                    </button>
                    <span v-if="b.result === undefined" class="spinner" />
                    <Icon v-else-if="b.result" name="chevron" :size="10" class="chev" :class="{ open: expanded.has(b.id) }" />
                  </div>
                  <div v-if="editDiff(b.input).length && (expanded.has(b.id) || b.name !== 'Write')" class="diff">
                    <div v-for="(l, k) in editDiff(b.input)" :key="k" :class="l.sign === '+' ? 'add' : 'del'">{{ l.sign }} {{ l.text }}</div>
                  </div>
                  <pre v-if="expanded.has(b.id) && b.result" class="result">{{ b.result }}</pre>
                </div>
              </template>
            </template>
          </div>
        </div>
      </template>

      <div v-for="a in chat.approvals" :key="a.requestId" class="approval">
        <div class="ask"><Icon name="warning" :size="13" /> {{ asking(a) }}</div>
        <pre v-if="typeof a.input.command === 'string'" class="command">{{ a.input.command }}</pre>
        <p v-else-if="typeof a.input.file_path === 'string'" class="path">{{ rel(a.input.file_path as string) }}</p>
        <div v-if="editDiff(a.input).length" class="diff">
          <div v-for="(l, k) in editDiff(a.input)" :key="k" :class="l.sign === '+' ? 'add' : 'del'">{{ l.sign }} {{ l.text }}</div>
        </div>
        <p v-if="a.description && typeof a.input.command === 'string'" class="why">{{ a.description }}</p>
        <div class="answer">
          <button class="ghost" @click="claude.answer(a, false)">Deny</button>
          <button class="primary" @click="claude.answer(a, true)">Allow</button>
        </div>
      </div>
      <p v-if="chat.working && !chat.approvals.length" class="thinking"><span class="spinner" /> Working…</p>
    </div>

    <footer>
      <div v-if="slash.length" class="slash" role="listbox">
        <div
          v-for="(c, i) in slash"
          :key="c.name"
          class="slash-item"
          :class="{ on: i === slashIndex }"
          role="option"
          :aria-selected="i === slashIndex"
          @mousedown.prevent="pick(c)"
          @mousemove="slashIndex = i"
        >
          <span class="name">/{{ c.name }}</span>
          <span v-if="'hint' in c && c.hint" class="hint">{{ c.hint }}</span>
          <span class="about">{{ c.description }}</span>
        </div>
      </div>
      <div class="composer">
        <textarea
          ref="input"
          v-model="draft"
          rows="2"
          :placeholder="chat.working ? 'Claude is working… Esc to interrupt' : `Ask Claude about ${claude.name}… (/ for commands)`"
          @keydown="onKey"
        />
        <div class="controls">
          <select
            :value="claude.mode.value"
            title="What Claude may do without asking"
            @change="claude.setMode(($event.target as HTMLSelectElement).value as ClaudeMode)"
          >
            <option v-for="m in MODES" :key="m.id" :value="m.id" :title="m.hint">{{ m.label }}</option>
          </select>
          <select :value="claude.model.value" title="Model" @change="claude.setModel(($event.target as HTMLSelectElement).value)">
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <button
            class="ghost steps-toggle"
            :class="{ on: showSteps }"
            :title="showSteps ? 'Steps shown: click to fold each reply’s into one line' : 'Steps folded: click to show them all'"
            @click="showSteps = !showSteps"
          >
            <Icon name="files" :size="12" />
          </button>
          <div class="spacer" />
          <button v-if="chat.working" class="ghost stop" title="Interrupt (Esc)" @click="claude.interrupt()"><Icon name="stop" :size="11" /></button>
          <button class="send" :disabled="!draft.trim()" title="Send (↵)" @click="send()"><Icon name="push" :size="13" /></button>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.claude-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  /* Nothing in it (a long line of code, a narrow panel) pushes it, or the box to write in, wider than its place; and
     where it sits (a panel's row of tabs, say) doesn't stop its text wrapping. */
  overflow: hidden;
  white-space: normal;
  --claude: #d97757;
}
.bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 50px;
  padding: 0 8px 0 14px;
}
.bar .name {
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.icon-btn,
.bar :slotted(.icon-btn) {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--fg-muted);
}
.bar :slotted(.icon-btn.on) {
  background: color-mix(in srgb, var(--claude) 18%, transparent);
  color: var(--claude);
}
.spacer {
  flex: 1;
  align-self: stretch;
}

.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: auto;
  padding: 24px;
  color: var(--fg-muted);
  text-align: center;
}
.welcome {
  margin-top: 12vh;
}
.big {
  color: var(--claude);
  font-size: 38px;
  line-height: 1;
}
.welcome h1 {
  margin: 14px 0 4px;
  color: var(--fg);
  font-size: 17px;
  font-weight: 600;
}
.welcome p {
  margin: 0;
  font-size: 12.5px;
}
.chips {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 18px;
  width: min(320px, 100%);
}
.chip {
  height: auto;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--popover) 60%, transparent);
  color: var(--fg-muted);
  font-size: 12.5px;
  text-align: left;
}
.welcome h2 {
  margin: 20px 0 0;
  color: var(--fg-faint);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.past .chip {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.past .forget {
  display: grid;
  flex: none;
  width: 20px;
  height: 20px;
  margin: -4px -6px -4px -2px;
  padding: 0;
  place-items: center;
  border-radius: 6px;
  color: var(--fg-faint);
  opacity: 0;
}
.past .chip:hover .forget,
.past .forget:focus-visible {
  opacity: 1;
}
.past .forget:hover {
  color: var(--del);
}
.past .what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.past .when {
  flex: none;
  color: var(--fg-faint);
  font-size: 11px;
}
.chip:hover {
  border-color: color-mix(in srgb, var(--claude) 50%, transparent);
  color: var(--fg);
}

.body {
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
  padding: 6px 16px 12px;
  user-select: text;
  scrollbar-width: thin;
}
.user {
  margin: 14px 0 10px auto;
  max-width: 85%;
  width: fit-content;
  padding: 8px 12px;
  border-radius: 16px 16px 4px 16px;
  background: var(--claude);
  color: #fff;
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.assistant .text {
  max-width: none;
  margin: 0;
  padding: 2px 0 6px;
  font-size: 13px;
  line-height: 1.6;
}
.tool {
  width: fit-content;
  min-width: min(260px, 100%);
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--popover) 55%, transparent);
  font-size: 12px;
}
.tool.error {
  border-color: color-mix(in srgb, var(--del) 50%, transparent);
}
.tool-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 9px;
  cursor: pointer;
}
.tool-icon {
  display: grid;
  flex: none;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
}
.tool.running .tool-icon {
  color: var(--accent);
}
.summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.summary.mono,
.command,
.result,
.diff {
  font-family: var(--mono);
}
.chev {
  flex: none;
  color: var(--fg-faint);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.link {
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--fg-faint);
}
.diff {
  max-height: 200px;
  overflow: auto;
  border-top: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
}
.diff .add {
  padding: 0 10px;
  background: var(--diff-add);
}
.diff .del {
  padding: 0 10px;
  background: var(--diff-del);
}
.result {
  max-height: 220px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 11px;
  white-space: pre-wrap;
}
.notice {
  margin: 10px 0;
  color: var(--fg-faint);
  font-size: 12px;
  font-style: italic;
  text-align: center;
}
.notice.error {
  color: var(--del);
  font-style: normal;
  text-align: left;
  white-space: pre-wrap;
}
.approval {
  margin: 12px 0;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--claude) 55%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--claude) 9%, var(--popover));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--claude) 10%, transparent);
  font-size: 12.5px;
}
.ask {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--claude);
  font-weight: 600;
}
.approval .command {
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--input-bg);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.approval .path,
.approval .why {
  margin: 6px 0;
  color: var(--fg-muted);
}
.approval .diff {
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.answer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
}
.answer button {
  height: 28px;
  padding: 0 16px;
}
.thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 2px;
  color: var(--fg-faint);
  font-size: 12px;
}
.spinner {
  flex: none;
  width: 11px;
  height: 11px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--claude);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

footer {
  position: relative;
  flex: none;
  min-width: 0;
  padding: 6px 12px 12px;
}
.slash {
  position: absolute;
  right: 12px;
  bottom: calc(100% - 2px);
  left: 12px;
  z-index: 2;
  max-height: 280px;
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--popover);
  box-shadow: var(--shadow);
}
.slash-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 12.5px;
  cursor: pointer;
}
.slash-item.on {
  background: var(--selected);
}
.slash-item .name {
  flex: none;
  font-family: var(--mono);
  font-size: 12px;
}
.slash-item .hint {
  flex: none;
  color: var(--fg-faint);
  font-family: var(--mono);
  font-size: 11px;
}
.slash-item .about {
  min-width: 0;
  overflow: hidden;
  color: var(--fg-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.composer {
  padding: 8px 8px 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  background: color-mix(in srgb, var(--popover) 85%, transparent);
  box-shadow: var(--shadow);
  transition: border-color 0.15s;
}
.composer:focus-within {
  border-color: color-mix(in srgb, var(--claude) 60%, transparent);
}
textarea {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  resize: none;
  padding: 2px 0;
  border: none;
  background: none;
  font: 13px/1.5 var(--font);
  outline: none;
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* Narrow, the menus give way first, cut short; the buttons stay whole. */
.controls select {
  flex: 0 1 auto;
  min-width: 0;
  text-overflow: ellipsis;
  height: 24px;
  padding: 0 6px;
  border: none;
  border-radius: 7px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 11.5px;
}
.send,
.stop {
  display: grid;
  flex: none;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  border: none;
  border-radius: 50%;
}
.send {
  background: var(--claude);
  color: #fff;
}
.send :deep(svg) {
  transform: rotate(0deg);
}
.send:disabled {
  background: var(--pill);
  color: var(--fg-faint);
}
.stop {
  background: var(--pill);
  color: var(--fg);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
/* Chat bubbles: Claude's on the left beside its mark, yours on the right in its colour. */
.avatar {
  display: grid;
  flex: none;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--claude) 18%, var(--popover));
  color: var(--claude);
  font-size: 16px;
}
.avatar.working {
  animation: pulse 1.4s ease-in-out infinite;
}
.avatar.waiting {
  box-shadow: 0 0 0 2px var(--modify);
}
.avatar.small {
  width: 24px;
  height: 24px;
  margin-top: 2px;
  font-size: 13px;
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.who .status {
  color: var(--fg-faint);
  font-size: 11px;
}
.assistant {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 10px 0;
}
.said {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.assistant .text.bubble {
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 8px 12px;
  border-radius: 4px 16px 16px 16px;
  background: var(--hover);
}
.assistant .text.bubble :deep(> :first-child) {
  margin-top: 0;
}
.assistant .text.bubble :deep(> :last-child) {
  margin-bottom: 0;
}

.earlier {
  display: block;
  margin: 4px auto 10px;
  height: 26px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--fg-faint);
  font-size: 12px;
}
.steps {
  display: flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  max-width: 100%;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--fg-muted);
  font-size: 12px;
}
.steps.error {
  border-color: color-mix(in srgb, var(--del) 50%, transparent);
}
.steps .summary {
  min-width: 0;
}
.steps-toggle {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border-radius: 7px;
  color: var(--fg-faint);
}
.steps-toggle.on {
  color: var(--fg-muted);
  background: var(--pill);
}
.floating .steps {
  background: var(--hover);
}
/* Floating: nothing behind the conversation but the desktop, so everything on it is solid, with its own shadow, and the
   oldest fade away up top. Each of Claude's replies is one card (its words and its tool calls together), rather than
   a scatter of small pieces, so there's less to pick out from whatever's behind. */
.floating {
  --lift: 0 0 0 0.5px var(--border-strong), 0 8px 24px rgb(0 0 0 / 32%);
}
.floating .body {
  display: flex;
  flex-direction: column;
  padding: 40px 14px 8px;
  mask-image: linear-gradient(to bottom, transparent, #000 90px);
}
.floating .body > :first-child {
  margin-top: auto;
}
.floating .body::-webkit-scrollbar {
  display: none;
}
.floating .said {
  flex: 0 1 auto;
  gap: 8px;
  max-width: 100%;
  padding: 10px 12px;
  border-radius: 4px 18px 18px 18px;
  background: var(--popover);
  box-shadow: var(--lift);
}
.floating .assistant .text.bubble {
  padding: 0;
  border-radius: 0;
  background: none;
  font-size: 13.5px;
  line-height: 1.55;
}
.floating .tool {
  background: var(--hover);
}
.floating .summary {
  color: var(--fg);
}
.floating .user {
  font-size: 13.5px;
}
.floating .user,
.floating .approval,
.floating .composer {
  box-shadow: var(--lift);
}
.floating .approval {
  background: color-mix(in srgb, var(--claude) 12%, var(--popover));
}
.floating .notice,
.floating .thinking,
.floating .welcome h2 {
  width: fit-content;
  margin: 10px auto;
  padding: 5px 12px;
  border-radius: 12px;
  background: var(--popover);
  box-shadow: var(--lift);
}
.floating .thinking {
  margin-left: 32px;
}
.floating .avatar.small {
  box-shadow: 0 3px 10px rgb(0 0 0 / 25%);
}
.floating .welcome {
  align-items: flex-end;
  margin: auto 0 0;
  padding: 16px 0;
}
.floating .welcome .big,
.floating .welcome h1,
.floating .welcome p {
  display: none;
}
.floating .welcome h2 {
  margin: 18px 0 0;
}
.floating .chips {
  align-items: flex-end;
}
.floating .chip {
  width: fit-content;
  max-width: 100%;
  border: none;
  border-radius: 14px;
  background: var(--popover);
  box-shadow: var(--lift);
}
.floating footer {
  padding: 4px 14px 6px;
}
.floating .composer {
  border: none;
  border-radius: 16px;
  background: var(--popover);
}
.opencode {
  --claude: #8b8bf0;
}
</style>
