<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import logo from '@/assets/logo.svg'
import { basename } from '@/lib/format'
import { prefs } from '@/composables/prefs'
import { showToast } from '@/composables/useToast'
import { useWorkspace, useWorkspaces } from '@/composables/workspace'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { pickRepo, openInWorkspace } = useWorkspaces()
const recents = prefs.recents

/** Commit Snake, for a break; its code loads only when it's first played. */
const MiniGame = defineAsyncComponent(() => import('./MiniGame.vue'))
const playing = ref(false)

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
  <div v-if="playing" class="game">
    <MiniGame @close="playing = false" />
  </div>
  <div v-else class="empty">
    <div class="card">
      <img class="logo" :src="logo" alt="" />
      <h1>Open a repository</h1>
      <p>Pick a folder, drop one onto the window, or choose a recent repository.</p>
      <button class="primary" @click="pickRepo"><Icon name="folder" /> Open Folder… <kbd>⌘O</kbd></button>
      <button class="ghost play" title="Play Commit Snake" @click="playing = true"><Icon name="play" :size="12" /> Play Commit Snake</button>
      <ul v-if="recents.length">
        <li class="label">
          Recent
          <button class="ghost clear" title="Forget all recent repositories" @click="forget()">Clear</button>
        </li>
        <li v-for="r in recents" :key="r" class="recent">
          <a href="#" :title="r" @click.prevent="ws.repo.repo.value ? openInWorkspace(r) : ws.repo.openRepo(r)">
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
  width: min(440px, 100%);
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
</style>
