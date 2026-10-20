<script setup lang="ts">
import { computed } from 'vue'
import { relativeDate } from '@/composables/dates'
import { runCommand } from '@/composables/commands'
import { toggleSlackPanel } from '@/composables/slackLinks'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import Icon from './Icon.vue'

const { active } = useWorkspaces()

const repo = computed(() => active.value?.repo.repo.value ?? null)
const log = computed(() => active.value?.repo.log.value ?? null)

const status = computed(() => active.value?.status.status.value ?? null)

/** "Behind origin/main by 2 · fetched 3m ago" */
const syncTitle = computed(() => {
  const s = status.value
  if (!s?.upstream) return ''
  const fetched = active.value?.repo.lastFetch.value
  const parts = [s.behind ? `${s.behind} to pull from ${s.upstream}` : `Up to date with ${s.upstream}`]
  if (s.ahead) parts.push(`${s.ahead} to push`)
  parts.push(fetched ? `fetched ${relativeDate(fetched / 1000)}` : 'not fetched yet')
  return parts.join(' · ')
})

/** The repo path as breadcrumbs, with the home directory shortened to "~". */
const crumbs = computed(() => {
  if (!repo.value) return []
  const parts = repo.value.split('/').filter(Boolean)
  return parts[0] === 'Users' && parts.length > 2 ? ['~', ...parts.slice(2)] : parts
})
</script>

<template>
  <footer class="statusbar">
    <template v-if="repo">
      <span class="crumbs" :title="repo">
        <Icon name="home" :size="12" />
        <template v-for="(c, i) in crumbs" :key="i">
          <Icon v-if="i" name="chevron" :size="10" class="sep" />
          <span :class="{ last: i === crumbs.length - 1 }">{{ c }}</span>
        </template>
      </span>
      <span v-if="log" class="item"><Icon name="branch" :size="12" />{{ log.headBranch ?? 'detached' }}</span>
      <button
        v-if="status?.upstream"
        class="ghost status-btn sync"
        :class="{ behind: status.behind }"
        :title="syncTitle"
        @click="runCommand('source-control')"
      >
        <template v-if="status.behind || status.ahead">
          <span v-if="status.behind">↓{{ status.behind }}</span>
          <span v-if="status.ahead">↑{{ status.ahead }}</span>
        </template>
        <Icon v-else name="check" :size="12" />
      </button>
      <span v-if="log?.uncommitted" class="item modified">{{ log.uncommitted }} changed</span>
      <span v-if="active?.status.status.value?.operation" class="item operation">{{ active.status.status.value.operation }} in progress</span>
    </template>
    <span v-else class="item">No repository</span>
    <div class="spacer" />
    <span v-if="log" class="item">{{ log.commits.length }}{{ log.hasMore ? '+' : '' }} commits</span>
    <button v-if="repo" class="ghost status-btn" :class="{ on: prefs.sidebarOpen.value }" @click="prefs.sidebarOpen.value = !prefs.sidebarOpen.value">
      <Icon name="scm" :size="12" /> Git
      <span v-if="active?.status.files.value.length" class="badge">{{ active.status.files.value.length }}</span>
      <kbd>⌘B</kbd>
    </button>
    <button v-if="active && repo" class="ghost status-btn" :class="{ on: active.terminals.open.value }" @click="active.terminals.toggle()">
      <Icon name="terminal" :size="12" /> Terminal <kbd>⌘J</kbd>
    </button>
    <button
      v-if="active && repo"
      class="ghost status-btn"
      :class="{ on: prefs.slackOpen.value || active.ui.slackExpanded.value }"
      title="Show or hide the Slack panel"
      @click="toggleSlackPanel(active)"
    >
      <Icon name="message" :size="12" /> Slack
    </button>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
  height: 28px;
  padding: 0 12px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.crumbs,
.item {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.crumbs .sep {
  opacity: 0.5;
}
.crumbs .last {
  color: var(--fg);
}
.sync {
  gap: 6px;
}
.sync.behind {
  color: var(--accent);
  font-weight: 600;
}
.modified {
  color: var(--modify);
}
.operation {
  color: var(--del);
  font-weight: 550;
}
.status-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  font-size: 11.5px;
}
.status-btn.on {
  color: var(--fg);
}
.badge {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--pill);
  color: var(--fg);
  font-size: 10px;
}
kbd {
  font: 10.5px var(--font);
  opacity: 0.6;
}
</style>
