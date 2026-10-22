<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { git, type ReflogEntry } from '@/lib/git'
import { compactDate, shortHash } from '@/lib/format'
import { openMenu } from '@/composables/useContextMenu'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

/**
 * Where HEAD has been, newest first: every commit, checkout, reset, rebase and merge. Commits that are on no branch any
 * more (left behind by a reset, a rebase or a deleted branch) are marked, and right-clicking one gives the graph's commit
 * menu, so getting one back is a branch or a reset away.
 */
const ws = useWorkspace()
const { repo, log } = ws.repo

const entries = shallowRef<ReflogEntry[] | null>(null)
const error = ref<string | null>(null)
const lostOnly = ref(false)

async function load() {
  const root = repo.value
  if (!root) return
  try {
    entries.value = await git.reflog(root)
    error.value = null
  } catch (e) {
    error.value = String(e)
  }
}
onMounted(load)
// Every checkout, commit or reset adds to it.
watch(
  () => log.value?.head,
  () => void load(),
)

const shown = computed(() => (lostOnly.value ? (entries.value ?? []).filter((e) => e.lost) : (entries.value ?? [])))
const lostCount = computed(() => entries.value?.filter((e) => e.lost).length ?? 0)

/** The kind of move, for its badge: the word before the colon ("checkout", "reset", "rebase (finish)"). */
const kind = (e: ReflogEntry) => e.action.split(':')[0].replace(/\s*\(.*\)/, '')
/** The rest of the action, after the kind. */
const detail = (e: ReflogEntry) => e.action.slice(e.action.indexOf(':') + 1).trim()

/** The graph's own commit menu, for a commit the graph may no longer show. */
async function menu(ev: MouseEvent, e: ReflogEntry) {
  const root = repo.value!
  const d = await git.commit(root, e.hash).catch(() => null)
  if (!d) return showToast(`${shortHash(e.hash)} is gone: git has cleaned it up`, 'error')
  openMenu(ev, ws.menus.commitMenu({ hash: e.hash, parents: d.parents, author: d.author, email: d.email, date: d.authorDate, subject: e.subject }))
}
</script>

<template>
  <div class="reflog">
    <div class="bar">
      <span class="muted">Where HEAD has been</span>
      <div class="spacer" />
      <label class="check" :title="'Commits on no branch any more: only the reflog still reaches them'">
        <input v-model="lostOnly" type="checkbox" /> only lost ({{ lostCount }})
      </label>
      <button class="ghost icon-btn" title="Refresh" @click="load"><Icon name="refresh" :size="13" /></button>
    </div>
    <p v-if="error" class="note error">{{ error }}</p>
    <Skeleton v-else-if="!entries" :lines="8" />
    <p v-else-if="!shown.length" class="note">{{ lostOnly ? 'Nothing lost: every commit here is still on a branch.' : 'No history yet.' }}</p>
    <ul v-else>
      <li
        v-for="e in shown"
        :key="e.selector"
        :class="{ lost: e.lost }"
        :title="`${e.selector} · ${e.action}\n${e.subject}${e.lost ? '\nOn no branch any more: right-click to make one' : ''}`"
        @click="ws.details.select(e.hash)"
        @contextmenu.prevent="menu($event, e)"
      >
        <span class="kind" :class="kind(e).split(' ')[0]">{{ kind(e) }}</span>
        <span class="subject">{{ e.subject }}</span>
        <span class="detail">{{ detail(e) }}</span>
        <span v-if="e.lost" class="pill" title="On no branch any more">lost</span>
        <span class="sha">{{ shortHash(e.hash) }}</span>
        <span class="date">{{ compactDate(e.date) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.reflog {
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
.spacer {
  flex: 1;
}
.check {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.icon-btn {
  width: 26px;
  height: 26px;
  color: var(--fg-muted);
}
ul {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 4px 8px 12px;
  overflow: auto;
  list-style: none;
  scrollbar-width: thin;
}
li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12.5px;
}
li:hover {
  background: var(--hover);
}
.kind {
  flex: none;
  min-width: 64px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10.5px;
  text-align: center;
}
.kind.reset,
.kind.rebase {
  color: var(--modify);
}
.kind.commit,
.kind.merge {
  color: var(--add);
}
.subject {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
li.lost .subject {
  color: var(--modify);
}
.pill {
  flex: none;
  padding: 0 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--modify) 18%, transparent);
  color: var(--modify);
  font-size: 10.5px;
}
.sha,
.date {
  flex: none;
  color: var(--fg-faint);
  font: 11px var(--mono);
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
