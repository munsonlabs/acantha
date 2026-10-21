<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { git, type PackageReadme } from '@/lib/git'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'
import Skeleton from './Skeleton.vue'

/**
 * Rendered Markdown in the panel: a file from the repository (`path`), following it as it changes, unsaved edits in the
 * editor included; or a package's README (`pkg`), from node_modules or npm.
 */
const props = defineProps<{ path?: string; pkg?: string }>()

const ws = useWorkspace()
const { repo } = ws.repo

const fileText = ref<string | null>(null)
const readme = ref<PackageReadme | null>(null)
const error = ref<string | null>(null)

/** The file as it is in the editor while it has unsaved edits, else as it is on disk. */
const source = computed(() => {
  if (props.pkg) return readme.value?.text ?? null
  return (props.path && ws.files.drafts.value.get(props.path)?.text) ?? fileText.value
})

async function load() {
  const root = repo.value
  if (!root) return
  try {
    if (props.pkg) {
      readme.value = await git.packageReadme(root, props.pkg)
    } else if (props.path) {
      const file = await git.readFile(root, null, props.path)
      if (file.kind !== 'text') throw new Error(`${props.path} isn't a text file`)
      fileText.value = file.text
    }
    error.value = null
  } catch (e) {
    error.value = String(e)
  }
}

onMounted(load)
// The file changed on disk: a save, a formatter, a checkout.
watch(ws.files.diskChanged, () => props.path && void load())

/** A link to another Markdown file opens in its own panel tab; anything else in the file preview. */
function follow(path: string) {
  if (/\.(md|markdown|mdx)$/i.test(path)) ws.panel.addMarkdown(path)
  else void ws.files.open(path)
}
</script>

<template>
  <div class="md-panel">
    <div v-if="pkg && readme" class="bar">
      <strong>{{ readme.name }}</strong>
      <span v-if="readme.version" class="muted">{{ readme.version }}</span>
      <span class="pill">{{ readme.source === 'installed' ? 'installed' : 'latest on npm' }}</span>
      <div class="spacer" />
      <button class="ghost icon-btn" title="Open on npm" @click="openUrl(`https://www.npmjs.com/package/${readme.name}`)">
        <Icon name="external" :size="13" />
      </button>
    </div>
    <div v-else-if="path" class="bar">
      <span class="muted path">{{ path }}</span>
      <div class="spacer" />
      <button class="ghost icon-btn" title="Edit the file" @click="ws.files.open(path, 'edit', null)"><Icon name="pencil" :size="13" /></button>
    </div>
    <p v-if="error" class="note error">{{ error }}</p>
    <Skeleton v-else-if="source === null" :lines="8" />
    <div v-else class="scroll">
      <MarkdownView :source="source" :path="path ?? 'README.md'" :repo="repo!" :rev="null" @open="follow" />
    </div>
  </div>
</template>

<style scoped>
.md-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.muted {
  color: var(--fg-muted);
}
.path {
  overflow: hidden;
  font: 11.5px var(--mono);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pill {
  padding: 0 6px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10.5px;
}
.spacer {
  flex: 1;
}
.icon-btn {
  width: 26px;
  height: 26px;
  color: var(--fg-muted);
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}
.scroll :deep(.markdown) {
  padding: 16px 20px 32px;
  font-size: 13px;
}
.note {
  margin: 12px;
  color: var(--fg-faint);
  font-size: 12px;
}
.error {
  color: var(--del);
  white-space: pre-wrap;
}
</style>
