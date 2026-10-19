<script setup lang="ts">
import { basename } from '@/lib/format'
import { prefs } from '@/composables/prefs'
import { useWorkspace, useWorkspaces } from '@/composables/workspace'
import Icon from './Icon.vue'

const ws = useWorkspace()
const { pickRepo, openInWorkspace } = useWorkspaces()
const recents = prefs.recents

const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
</script>

<template>
  <div class="empty">
    <div class="card">
      <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M22 12v40" stroke="#6ea8e8" />
        <path d="M22 20c0 8 20 6 20 14v4c0 6-20 4-20 14" stroke="#b98ce0" />
        <circle cx="22" cy="12" r="4.5" fill="#6ea8e8" />
        <circle cx="42" cy="34" r="4.5" fill="#b98ce0" />
        <circle cx="22" cy="52" r="4.5" fill="#6ea8e8" />
      </svg>
      <h1>Open a repository</h1>
      <p>Pick a folder, drop one onto the window, or choose a recent repository.</p>
      <button class="primary" @click="pickRepo"><Icon name="folder" /> Open Folder… <kbd>⌘O</kbd></button>
      <ul v-if="recents.length">
        <li class="label">Recent</li>
        <li v-for="r in recents" :key="r">
          <a href="#" :title="r" @click.prevent="ws.repo.repo.value ? openInWorkspace(r) : ws.repo.openRepo(r)">
            <Icon name="history" :size="13" />
            <strong>{{ basename(r) }}</strong>
            <span>{{ home(r) }}</span>
          </a>
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
  width: 56px;
  height: 56px;
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
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
  padding: 0 10px 6px;
  color: var(--fg-faint);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
a {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
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
