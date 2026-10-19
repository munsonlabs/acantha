<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { openUrl } from '@tauri-apps/plugin-opener'
import { git } from '@/lib/git'

const props = defineProps<{ source: string; path: string; repo: string; rev: string | null }>()
const emit = defineEmits<{ open: [path: string] }>()
const el = ref<HTMLElement>()

// Rendered markdown runs in the app's own webview, so anything executable is stripped.
const html = computed(() => DOMPurify.sanitize(marked.parse(props.source, { async: false, gfm: true })))

const isExternal = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url)

/** Resolves a link or image path relative to the markdown file, as GitHub does. */
function resolve(target: string) {
  const clean = decodeURIComponent(target.split('#')[0].split('?')[0])
  const parts = clean.startsWith('/') ? [] : props.path.split('/').slice(0, -1)
  for (const part of clean.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** Relative images live in the repository, so load them through git rather than the webview. */
async function loadImages() {
  await nextTick()
  for (const img of el.value?.querySelectorAll('img') ?? []) {
    const src = img.getAttribute('src')
    if (!src || isExternal(src)) continue
    img.removeAttribute('src')
    const file = await git.readFile(props.repo, props.rev, resolve(src)).catch(() => null)
    if (file?.kind === 'image') img.src = `data:${file.mime};base64,${file.data}`
  }
}

function onClick(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a')
  const href = link?.getAttribute('href')
  if (!href) return
  e.preventDefault()
  if (href.startsWith('#')) document.getElementById(href.slice(1))?.scrollIntoView()
  else if (isExternal(href)) void openUrl(href)
  else emit('open', resolve(href))
}

watch(html, loadImages, { immediate: true })
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- sanitised with DOMPurify above -->
  <article ref="el" class="markdown" @click="onClick" v-html="html" />
</template>

<style scoped>
.markdown {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 32px 48px;
  font-size: 14px;
  line-height: 1.65;
  user-select: text;
}
.markdown :deep(h1),
.markdown :deep(h2) {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.markdown :deep(h1) {
  font-size: 26px;
}
.markdown :deep(h2) {
  margin-top: 28px;
  font-size: 20px;
}
.markdown :deep(h3) {
  font-size: 16px;
}
.markdown :deep(a) {
  color: var(--ansi-blue);
  text-decoration: none;
}
.markdown :deep(a:hover) {
  text-decoration: underline;
}
.markdown :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--pill);
  font: 12.5px var(--mono);
}
.markdown :deep(pre) {
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--input-bg);
}
.markdown :deep(pre code) {
  padding: 0;
  background: none;
}
.markdown :deep(blockquote) {
  margin: 0;
  padding: 0 14px;
  border-left: 3px solid var(--border-strong);
  color: var(--fg-muted);
}
.markdown :deep(table) {
  border-collapse: collapse;
}
.markdown :deep(th),
.markdown :deep(td) {
  padding: 6px 12px;
  border: 1px solid var(--border);
}
.markdown :deep(img) {
  max-width: 100%;
}
.markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
}
</style>
