<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import DOMPurify from 'dompurify'
import { openUrl } from '@tauri-apps/plugin-opener'
import { formatDate } from '@/lib/format'
import { canvasEmoji, renderSlackText, slack, type SlackCanvas, type SlackMessage, type SlackThread } from '@/lib/slack'
import { displayDate } from '@/composables/dates'
import { prefs } from '@/composables/prefs'
import { openSlackLink, promptSlackLink } from '@/composables/slackLinks'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

/** docked: the panel under the terminal; otherwise expanded in place of the graph. */
const props = defineProps<{ docked?: boolean }>()
const ws = useWorkspace()
const current = ws.ui.slack
const expanded = ws.ui.slackExpanded

const thread = shallowRef<SlackThread | null>(null)
const canvas = shallowRef<SlackCanvas | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
let seq = 0

async function load() {
  const open = current.value
  if (!open) return
  const id = ++seq
  loading.value = true
  error.value = null
  try {
    const allowed = prefs.slackChannels.value
    if (open.link.kind === 'message') {
      const t = await slack.thread(open.link.channel, open.link.ts, open.link.threadTs, allowed)
      if (id === seq) {
        thread.value = t
        canvas.value = null
      }
    } else {
      const c = await slack.canvas(open.link.file, allowed)
      if (id === seq) {
        canvas.value = c
        thread.value = null
      }
    }
  } catch (e) {
    if (id === seq) error.value = String(e)
  } finally {
    if (id === seq) loading.value = false
  }
}

watch(
  () => current.value?.url,
  () => {
    thread.value = canvas.value = null
    void load()
  },
  { immediate: true },
)

function close() {
  current.value = null
  expanded.value = false
}
const expand = () => (expanded.value = true)
function dock() {
  expanded.value = false
  prefs.slackOpen.value = true
}
const collapse = () => (prefs.slackOpen.value = false)

const seconds = (ts: string) => Math.floor(Number(ts))
const author = (m: SlackMessage) => (m.user ? (thread.value?.users[m.user]?.name ?? m.user) : (m.author ?? 'Slack'))
const avatar = (m: SlackMessage) => (m.user ? thread.value?.users[m.user]?.avatar : null)
const initial = (m: SlackMessage) => author(m).slice(0, 1).toUpperCase()
const html = (m: SlackMessage) => DOMPurify.sanitize(renderSlackText(m.text, thread.value?.users))
/** The message the link pointed at, when it's a reply further down a thread. */
const target = computed(() => (current.value?.link.kind === 'message' ? current.value.link.ts : null))

// Slack's canvas export is a whole page; keep its content, drop its styles, and leave out pictures (they need the
// token to load).
const canvasHtml = computed(() => {
  if (!canvas.value) return ''
  return DOMPurify.sanitize(canvasEmoji(canvas.value.html), {
    FORBID_TAGS: ['style', 'img', 'video', 'audio', 'iframe'],
    FORBID_ATTR: ['style'],
  })
})

const title = computed(() => {
  if (!current.value) return 'Slack'
  if (canvas.value) return canvas.value.title
  const n = thread.value ? thread.value.messages.length - 1 : 0
  return n > 0 ? `Slack thread · ${n} ${n === 1 ? 'reply' : 'replies'}` : 'Slack message'
})

/** Links to other Slack messages open here; everything else in the browser. */
async function onClick(e: MouseEvent) {
  const a = (e.target as Element).closest('a')
  const href = a?.getAttribute('href')
  if (!href) return
  e.preventDefault()
  if (!(await openSlackLink(ws, href))) void openUrl(href)
}
</script>

<template>
  <div class="slack-view" :class="{ pane: props.docked, docked: props.docked }">
    <header class="pane-header">
      <span class="title"><Icon name="message" :size="13" /> {{ title }}</span>
      <div class="spacer" />
      <template v-if="current">
        <button class="ghost icon-btn" title="Refresh" :disabled="loading" @click="load"><Icon name="refresh" /></button>
        <button class="ghost icon-btn" title="Open in Slack" @click="openUrl(current.url)"><Icon name="external" /></button>
        <button v-if="props.docked" class="ghost icon-btn" title="Expand over the graph" @click="expand"><Icon name="maximize" /></button>
        <button v-else class="ghost icon-btn" title="Back under the terminal (Esc)" @click="dock"><Icon name="minimize" /></button>
        <button class="ghost icon-btn" title="Close this message" @click="close"><Icon name="x" /></button>
      </template>
      <button v-if="props.docked" class="ghost icon-btn" title="Hide the Slack panel" @click="collapse"><Icon name="minus" /></button>
    </header>

    <div class="body" @click="onClick">
      <div v-if="!current" class="empty">
        <Icon name="message" :size="22" />
        <p>Copy a Slack message or canvas link, then press <kbd>⌘V</kbd> anywhere outside a text box.</p>
        <button class="ghost" @click="promptSlackLink(ws)">Paste a link… <kbd>⇧⌘L</kbd></button>
      </div>
      <p v-else-if="error" class="note error">{{ error }}</p>
      <Skeleton v-else-if="!thread && !canvas" :lines="8" :gap="18" />

      <ol v-else-if="thread" class="messages">
        <template v-for="(m, i) in thread.messages" :key="m.ts">
          <li v-if="i === 1" class="divider">{{ thread.messages.length - 1 }} {{ thread.messages.length === 2 ? 'reply' : 'replies' }}</li>
          <li class="message" :class="{ target: thread.messages.length > 1 && m.ts === target }">
            <img v-if="avatar(m)" class="avatar" :src="avatar(m)!" alt="" />
            <span v-else class="avatar">{{ initial(m) }}</span>
            <div class="content">
              <div class="meta">
                <span class="name">{{ author(m) }}</span>
                <span class="time" :title="formatDate(seconds(m.ts))">{{ displayDate(seconds(m.ts)) }}</span>
                <span v-if="m.edited" class="edited">(edited)</span>
              </div>
              <!-- eslint-disable-next-line vue/no-v-html -- built by renderSlackText, sanitised with DOMPurify -->
              <div class="text" v-html="html(m)" />
              <div v-if="m.files.length" class="files">
                <a v-for="f in m.files" :key="f.name" :href="f.permalink ?? undefined"><Icon name="file" :size="12" /> {{ f.name }}</a>
              </div>
            </div>
          </li>
        </template>
      </ol>

      <!-- eslint-disable-next-line vue/no-v-html -- sanitised with DOMPurify above -->
      <article v-else-if="canvas" class="canvas" v-html="canvasHtml" />
    </div>
  </div>
</template>

<style scoped>
.slack-view {
  display: flex;
  flex-direction: column;
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  padding: 0 6px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.messages {
  max-width: 820px;
  margin: 0 auto;
  padding: 12px 16px 32px;
  list-style: none;
}
.message {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
}
.message.target {
  background: var(--match);
}
.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--pill);
  color: var(--fg-muted);
  font-weight: 600;
}
.content {
  min-width: 0;
  flex: 1;
}
.meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.name {
  font-weight: 600;
}
.time,
.edited {
  color: var(--fg-faint);
  font-size: 11.5px;
}
.text {
  margin-top: 2px;
  font-size: 13.5px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  user-select: text;
}
.text :deep(a),
.files a,
.canvas :deep(a) {
  color: var(--ansi-blue);
  text-decoration: none;
}
.text :deep(a:hover),
.files a:hover,
.canvas :deep(a:hover) {
  text-decoration: underline;
}
.text :deep(.mention) {
  padding: 0 3px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
}
.text :deep(code),
.canvas :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--pill);
  font: 12.5px var(--mono);
}
.text :deep(pre),
.canvas :deep(pre) {
  overflow: auto;
  margin: 6px 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
}
.text :deep(pre code),
.canvas :deep(pre code) {
  padding: 0;
  background: none;
}
.text :deep(blockquote),
.canvas :deep(blockquote) {
  margin: 4px 0;
  padding: 0 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--fg-muted);
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
}
.files a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 10px;
  color: var(--fg-faint);
  font-size: 11.5px;
}
.divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--border);
}
.canvas {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 32px 48px;
  font-size: 14px;
  line-height: 1.65;
  user-select: text;
}
.canvas :deep(h1),
.canvas :deep(h2) {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.canvas :deep(table) {
  border-collapse: collapse;
}
.canvas :deep(th),
.canvas :deep(td) {
  padding: 6px 12px;
  border: 1px solid var(--border);
}
/* Docked under the terminal: tighter, so a thread reads in a narrow column. */
.docked .messages {
  padding: 6px 6px 16px;
}
.docked .message {
  gap: 8px;
  padding: 6px;
}
.docked .avatar {
  width: 26px;
  height: 26px;
  border-radius: 7px;
}
.docked .text {
  font-size: 12.5px;
}
.docked .canvas {
  padding: 12px 16px 24px;
  font-size: 13px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 20px;
  color: var(--fg-faint);
  font-size: 12px;
  text-align: center;
}
.empty p {
  max-width: 260px;
  margin: 0;
}
.note {
  margin: 24px;
  color: var(--fg-faint);
}
.note.error {
  color: var(--danger, #e5534b);
}
</style>
