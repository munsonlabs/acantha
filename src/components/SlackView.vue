<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import DOMPurify from 'dompurify'
import { openUrl } from '@tauri-apps/plugin-opener'
import { formatDate } from '@/lib/format'
import { prepareCanvas, parseSlackLink, renderSlackText, slack, slackCache, type SlackCanvas, type SlackMessage, type SlackThread } from '@/lib/slack'
import { parseBullets, slackPlain } from '@/lib/todos'
import { displayDate } from '@/composables/dates'
import { prefs } from '@/composables/prefs'
import { openSlackLink } from '@/composables/slackLinks'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

/** One Slack tab of the panel. docked: under the terminal (tighter); otherwise expanded over the graph. */
const props = defineProps<{ tabId: string; url: string; docked?: boolean }>()
const ws = useWorkspace()

const thread = shallowRef<SlackThread | null>(null)
const canvas = shallowRef<SlackCanvas | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const link = computed(() => parseSlackLink(props.url))
let seq = 0

/** Shows the tab's message or canvas: from this session's cache unless `fresh`, else fetched from Slack. */
async function load(fresh = false) {
  const l = link.value
  if (!l) return
  const cached = slackCache.get(props.url)
  if (cached && !fresh) {
    thread.value = cached.thread
    canvas.value = cached.canvas
    error.value = null
    return
  }
  const id = ++seq
  loading.value = true
  error.value = null
  try {
    const allowed = prefs.slackChannels.value
    if (l.kind === 'message') {
      const t = await slack.thread(l.channel, l.ts, l.threadTs, allowed)
      if (id === seq) {
        thread.value = t
        canvas.value = null
      }
    } else {
      const c = await slack.canvas(l.file, allowed)
      if (id === seq) {
        canvas.value = c
        thread.value = null
      }
    }
    if (id === seq) {
      slackCache.set(props.url, { thread: thread.value, canvas: canvas.value })
      // Name the tab after what it shows, unless it has a name already (perhaps one you gave it).
      const tab = ws.panel.tabs.value.find((t) => t.id === props.tabId)
      if (tab?.kind === 'slack' && !tab.title) ws.panel.rename(props.tabId, title.value)
    }
  } catch (e) {
    if (id === seq) error.value = String(e)
  } finally {
    if (id === seq) loading.value = false
  }
}

watch(
  () => props.url,
  () => {
    thread.value = canvas.value = null
    void load()
  },
  { immediate: true },
)

defineExpose({ refresh: () => load(true), loading })

const seconds = (ts: string) => Math.floor(Number(ts))
const author = (m: SlackMessage) => (m.user ? (thread.value?.users[m.user]?.name ?? m.user) : (m.author ?? 'Slack'))
const avatar = (m: SlackMessage) => (m.user ? thread.value?.users[m.user]?.avatar : null)
const initial = (m: SlackMessage) => author(m).slice(0, 1).toUpperCase()
const html = (m: SlackMessage) => DOMPurify.sanitize(renderSlackText(m.text, thread.value?.users))
/** The message the link pointed at, when it's a reply further down a thread. */
const target = computed(() => (link.value?.kind === 'message' ? link.value.ts : null))

const names = computed(() => Object.fromEntries(Object.values(thread.value?.users ?? {}).map((u) => [u.id, u.name])))
const bullets = (m: SlackMessage) => parseBullets(m.text)

/** A message's bullet points as a new to-do list. */
function makeTodos(m: SlackMessage) {
  const items = bullets(m).map((b) => ({ ...b, text: slackPlain(b.text, names.value) }))
  ws.panel.addTodos(`To-dos from ${author(m)}`, items)
}

// Slack's canvas export is a whole page; keep its content, drop its styles, and leave out pictures (they need the
// token to load).
const canvasHtml = computed(() => {
  if (!canvas.value) return ''
  return DOMPurify.sanitize(prepareCanvas(canvas.value.html), {
    FORBID_TAGS: ['style', 'img', 'video', 'audio', 'iframe'],
    FORBID_ATTR: ['style'],
  })
})

/** The tab's label once loaded. Slack writes a canvas title's emoji as :name: codes; it reads better without. */
const title = computed(() => {
  if (canvas.value)
    return (
      canvas.value.title
        .replace(/:[a-z0-9_+'-]+:(?::skin-tone-[2-6]:)?/g, '')
        .replace(/\s+/g, ' ')
        .trim() || 'Canvas'
    )
  const first = thread.value?.messages[0]
  if (!first) return 'Slack'
  const words = slackPlain(first.text, names.value)
    .replace(/:[a-z0-9_+'-]+:/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return words.length > 32 ? `${words.slice(0, 30).trimEnd()}…` : words || author(first)
})

/**
 * Links to other Slack messages and canvases open in a new tab; everything else in the browser. Canvases can link
 * relative to the workspace (`/archives/…`, `/team/…`), so those are resolved against this tab's link first.
 */
function onClick(e: MouseEvent) {
  const a = (e.target as Element).closest('a')
  const raw = a?.getAttribute('href')
  if (!raw) return
  e.preventDefault()
  let href: string
  try {
    href = new URL(raw, props.url).href
  } catch {
    return
  }
  if (!openSlackLink(ws, href) && /^(https?|mailto):/.test(href)) openUrl(href).catch((err) => showToast(`Couldn't open the link: ${err}`, 'error'))
}
</script>

<template>
  <div class="slack-view" :class="{ docked: props.docked }">
    <div class="body" @click="onClick">
      <p v-if="error" class="note error">{{ error }}</p>
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
                <button
                  v-if="bullets(m).length"
                  class="ghost todo-btn"
                  title="Make a to-do list from this message's bullet points"
                  @click.stop="makeTodos(m)"
                >
                  <Icon name="check" :size="11" /> To-dos
                </button>
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
.todo-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  margin-left: auto;
  padding: 0 6px;
  border-radius: 5px;
  color: var(--fg-faint);
  font-size: 11px;
  opacity: 0;
}
.message:hover .todo-btn {
  opacity: 1;
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
.note {
  margin: 24px;
  color: var(--fg-faint);
}
.note.error {
  color: var(--danger, #e5534b);
}
</style>
