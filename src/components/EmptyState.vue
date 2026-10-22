<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import logo from '@/assets/logo.svg'
import { basename, compactDate } from '@/lib/format'
import { git, type RepoSummary } from '@/lib/git'
import { prefs } from '@/composables/prefs'
import { isOn } from '@/features'
import { showToast } from '@/composables/useToast'
import { useWorkspace, useWorkspaces } from '@/composables/workspace'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { pickRepo, openInWorkspace } = useWorkspaces()
const recents = prefs.recents

/** Commit Snake, for a break; its code loads only when it's first played. */
const MiniGame = defineAsyncComponent(() => import('./MiniGame.vue'))
const playing = ref(false)

/**
 * The dashboard: where each recent repository stands, its branch, uncommitted changes, ahead and behind, and last
 * commit, checked when the screen shows and when the window comes back to the front.
 */
const summaries = shallowRef(new Map<string, RepoSummary>())
async function loadSummaries() {
  if (!isOn('dashboard') || !recents.value.length) return
  const list = await git.summaries(recents.value).catch(() => [])
  summaries.value = new Map(list.map((s) => [s.path, s]))
}
onMounted(() => {
  void loadSummaries()
  window.addEventListener('focus', loadSummaries)
})
onBeforeUnmount(() => window.removeEventListener('focus', loadSummaries))
watch([recents, () => isOn('dashboard')], () => void loadSummaries())

const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')

/** Forgets one recent repository, or all of them. Undo puts the list back as it was. */
function forget(path?: string) {
  const before = recents.value
  recents.value = path ? before.filter((r) => r !== path) : []
  showToast(path ? `Removed ${basename(path)} from recents` : 'Cleared recent repositories', 'ok', {
    label: 'Undo',
    run: async () => void (recents.value = before),
  })
}
</script>

<template>
  <div v-if="playing && isOn('snake')" class="game">
    <MiniGame @close="playing = false" />
  </div>
  <div v-else class="empty">
    <div class="card">
      <img class="logo" :src="logo" alt="" />
      <h1>Open a repository</h1>
      <p>Pick a folder, drop one onto the window, or choose a recent repository.</p>
      <button class="primary" @click="pickRepo"><Icon name="folder" /> Open Folder… <kbd>⌘O</kbd></button>
      <button v-if="isOn('snake')" class="ghost play" title="Play Commit Snake" @click="playing = true">
        <Icon name="play" :size="12" /> Play Commit Snake
      </button>
      <ul v-if="recents.length">
        <li class="label">
          Recent
          <button class="ghost clear" title="Forget all recent repositories" @click="forget()">Clear</button>
        </li>
        <li v-for="r in recents" :key="r" class="recent">
          <a
            v-if="isOn('dashboard') && summaries.get(r)"
            href="#"
            class="status"
            :class="{ missing: summaries.get(r)!.missing }"
            :title="r"
            @click.prevent="ws.repo.repo.value ? openInWorkspace(r) : ws.repo.openRepo(r)"
          >
            <span class="top">
              <strong>{{ basename(r) }}</strong>
              <template v-if="summaries.get(r)!.missing"><span class="pill warn">folder missing</span></template>
              <template v-else>
                <span v-if="summaries.get(r)!.branch" class="pill branch"><Icon name="branch" :size="10" /> {{ summaries.get(r)!.branch }}</span>
                <span v-if="summaries.get(r)!.operation" class="pill warn">{{ summaries.get(r)!.operation }} in progress</span>
                <span class="spacer" />
                <span v-if="summaries.get(r)!.changed" class="changed" :title="`${summaries.get(r)!.changed} uncommitted changes`">
                  ● {{ summaries.get(r)!.changed }}
                </span>
                <span v-if="summaries.get(r)!.ahead" class="sync" :title="`${summaries.get(r)!.ahead} to push`">↑{{ summaries.get(r)!.ahead }}</span>
                <span v-if="summaries.get(r)!.behind" class="sync behind" :title="`${summaries.get(r)!.behind} to pull`"
                  >↓{{ summaries.get(r)!.behind }}</span
                >
              </template>
            </span>
            <span class="bottom">
              <span>{{ home(r) }}</span>
              <template v-if="summaries.get(r)!.lastSubject">
                · <span class="last">{{ summaries.get(r)!.lastSubject }}</span> · {{ compactDate(summaries.get(r)!.lastDate!) }}
              </template>
            </span>
          </a>
          <a v-else href="#" :title="r" @click.prevent="ws.repo.repo.value ? openInWorkspace(r) : ws.repo.openRepo(r)">
            <Icon name="history" :size="13" />
            <strong>{{ basename(r) }}</strong>
            <span>{{ home(r) }}</span>
          </a>
          <button class="ghost icon-btn forget" title="Remove from recents" @click="forget(r)"><Icon name="x" :size="12" /></button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 24px;
  overflow: auto;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(520px, 100%);
  text-align: center;
}
.logo {
  width: 64px;
  height: 64px;
  filter: drop-shadow(0 6px 14px rgb(0 0 0 / 30%));
}
h1 {
  margin: 10px 0 4px;
  font-size: 15px;
  font-weight: 600;
}
p {
  margin: 0 0 18px;
  color: var(--fg-muted);
  font-size: 12.5px;
}
.primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.game {
  height: 100%;
}
.play {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  margin-top: 8px;
  padding: 0 10px;
  color: var(--fg-faint);
  font-size: 12px;
}
.play:hover {
  color: var(--fg);
}
.primary kbd {
  font: 11px var(--font);
  opacity: 0.55;
}
ul {
  width: 100%;
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
  text-align: left;
}
.label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 6px 10px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
}
.clear {
  height: 20px;
  padding: 0 6px;
  color: var(--fg-faint);
  font-size: 11px;
}
.clear:hover {
  color: var(--fg);
}
.recent {
  position: relative;
}
.forget {
  position: absolute;
  top: 50%;
  right: 6px;
  width: 22px;
  height: 22px;
  color: var(--fg-faint);
  opacity: 0;
  transform: translateY(-50%);
}
.recent:hover .forget,
.forget:focus-visible {
  opacity: 1;
}
.forget:hover {
  color: var(--fg);
}
a {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 32px 6px 10px;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
}
a:hover {
  background: var(--hover);
}
a strong {
  font-weight: 500;
}
a span {
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* The dashboard's rows: name, branch and state on top; folder and last commit below. */
a.status {
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}
a.status.missing {
  opacity: 0.6;
}
.top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.bottom {
  display: flex;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11.5px;
  white-space: nowrap;
}
.bottom .last {
  overflow: hidden;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10.5px;
  white-space: nowrap;
}
.pill.warn {
  color: var(--modify);
}
.changed {
  color: var(--modify);
  font-size: 11px;
}
.sync {
  color: var(--fg-muted);
  font: 11px var(--mono);
}
.sync.behind {
  color: var(--accent);
}
</style>
