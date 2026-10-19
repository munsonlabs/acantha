<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { git, type Commit, type CommitDetails, type FileChange } from '@/lib/git'
import { formatDate, shortHash, splitPath } from '@/lib/format'
import { commitUrl } from '@/lib/remote'
import { displayDate } from '@/composables/dates'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import Avatar from './Avatar.vue'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'

const props = defineProps<{ commit: Commit; x: number; y: number }>()
const emit = defineEmits<{ enter: []; leave: []; open: [] }>()

const ws = useWorkspace()
const { repo, log, stats } = ws.repo

const SHOWN = 8
/** Details and files per commit, kept so moving back and forth between rows doesn't refetch. */
const cache = new Map<string, Promise<{ details: CommitDetails; files: FileChange[] }>>()

const details = shallowRef<CommitDetails | null>(null)
const files = shallowRef<FileChange[] | null>(null)
const el = ref<HTMLElement>()
const pos = ref({ left: props.x, top: props.y })

const stat = computed(() => stats.value.get(props.commit.hash))
const link = computed(() => commitUrl(log.value?.remoteUrl ?? null, props.commit.hash))
const body = computed(() => details.value?.body.split('\n').slice(1).join('\n').trim() ?? '')

watch(
  () => props.commit.hash,
  async (hash) => {
    details.value = null
    files.value = null
    let entry = cache.get(hash)
    if (!entry) {
      const c = props.commit
      entry = Promise.all([git.commit(repo.value!, hash), git.changes(repo.value!, c.parents[0] ?? null, hash)]).then(([details, files]) => ({
        details,
        files,
      }))
      cache.set(hash, entry)
      entry.catch(() => cache.delete(hash))
    }
    const loaded = await entry.catch(() => null)
    if (loaded && hash === props.commit.hash) {
      details.value = loaded.details
      files.value = loaded.files
    }
  },
  { immediate: true },
)

// Keep the card on screen, flipping above the row when there is no room below.
watch(
  [() => props.x, () => props.y, files],
  async () => {
    await nextTick()
    const rect = el.value?.getBoundingClientRect()
    if (!rect) return
    const top = props.y + rect.height > window.innerHeight - 12 ? Math.max(12, props.y - rect.height - 34) : props.y
    pos.value = { left: Math.max(12, Math.min(props.x, window.innerWidth - rect.width - 12)), top }
  },
  { immediate: true },
)

async function copy() {
  await navigator.clipboard.writeText(props.commit.hash)
  showToast('Copied commit hash')
}
</script>

<template>
  <div ref="el" class="card" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @mouseenter="emit('enter')" @mouseleave="emit('leave')">
    <div class="head">
      <span class="sha">{{ shortHash(commit.hash) }}</span>
      <span class="subject">{{ commit.subject }}</span>
    </div>
    <p v-if="body" class="body">{{ body }}</p>
    <div class="meta">
      <Avatar :name="commit.author" :email="commit.email" :size="16" />
      <span class="author">{{ commit.author }}</span>
      <span class="email">{{ commit.email }}</span>
      <span class="date" :title="formatDate(commit.date)">{{ displayDate(commit.date) }}</span>
    </div>
    <div class="actions">
      <button class="ghost" @click="copy"><Icon name="files" :size="12" /> Copy SHA</button>
      <button v-if="link" class="ghost" @click="openUrl(link)"><Icon name="external" :size="12" /> View online</button>
      <button class="ghost" @click="emit('open')"><Icon name="eye" :size="12" /> Details</button>
    </div>
    <div class="files-head">
      <span>Files</span>
      <span v-if="stat?.files" class="stat"
        >{{ stat.files }} · <span class="add">+{{ stat.additions }}</span> <span class="del">−{{ stat.deletions }}</span></span
      >
    </div>
    <ul v-if="files">
      <li v-for="f in files.slice(0, SHOWN)" :key="f.path">
        <FileIcon :path="f.path" :size="13" />
        <span class="name">{{ splitPath(f.path).name }}</span>
        <span class="dir">{{ splitPath(f.path).dir.replace(/\/$/, '') }}</span>
        <span class="status" :class="`s-${f.status}`">{{ f.status }}</span>
      </li>
      <li v-if="files.length > SHOWN" class="more">and {{ files.length - SHOWN }} more</li>
      <li v-if="!files.length" class="more">No file changes (a merge, or an empty commit)</li>
    </ul>
    <p v-else class="more">Loading…</p>
  </div>
</template>

<style scoped>
.card {
  position: fixed;
  z-index: 35;
  width: 380px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--popover);
  box-shadow: var(--shadow);
  font-size: 12px;
  animation: in 0.12s ease-out;
}
@keyframes in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
.head {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.sha {
  flex: none;
  color: var(--fg-faint);
  font: 11px var(--mono);
}
.subject {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
}
.body {
  max-height: 80px;
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--fg-muted);
  white-space: pre-wrap;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: var(--fg-muted);
  white-space: nowrap;
}
.email {
  overflow: hidden;
  color: var(--fg-faint);
  text-overflow: ellipsis;
}
.date {
  margin-left: auto;
}
.actions {
  display: flex;
  gap: 4px;
  margin: 10px -4px 0;
}
.actions button {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 7px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.files-head {
  display: flex;
  justify-content: space-between;
  margin: 10px 0 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  color: var(--fg-faint);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.stat {
  letter-spacing: 0;
  text-transform: none;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
}
.name {
  flex: none;
  max-width: 60%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.status {
  font: 600 11px var(--mono);
}
.s-A {
  color: var(--add);
}
.s-M,
.s-T {
  color: var(--modify);
}
.s-D {
  color: var(--del);
}
.s-R,
.s-C {
  color: var(--rename);
}
.add {
  color: var(--add);
}
.del {
  color: var(--del);
}
.more {
  margin: 4px 0 0;
  color: var(--fg-faint);
  font-size: 11.5px;
}
</style>
