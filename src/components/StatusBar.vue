<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { BASELINES, bytesText, levelOf, overall, verdict, type MemoryUse, type Part } from '@/lib/memory'
import { openMenu, type MenuEntry } from '@/composables/useContextMenu'
import { isOn } from '@/features'
import { relativeDate } from '@/composables/dates'
import { runCommand } from '@/composables/commands'
import { togglePanel } from '@/composables/slackLinks'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import Icon from './Icon.vue'

const { active, workspaces, sleepOtherWorkspaces } = useWorkspaces()

/**
 * What Acantha's using, looked at every few seconds: the total, with a dot saying whether it's in its usual range.
 * Clicking it says what's using it, part by part against its usual, and offers what would free some.
 */
const memory = ref<MemoryUse | null>(null)
const lookAtMemory = async () => (memory.value = await invoke<MemoryUse>('memory_use').catch(() => memory.value))
void lookAtMemory()
const memoryTimer = setInterval(() => isOn('memory') && void lookAtMemory(), 5000)
onBeforeUnmount(() => clearInterval(memoryTimer))
const memoryLevel = computed(() => (memory.value ? overall(memory.value) : 'good'))

const PARTS: { part: Part; name: string }[] = [
  { part: 'app', name: BASELINES.app.name },
  { part: 'agents', name: BASELINES.agents.name },
  { part: 'types', name: BASELINES.types.name },
  { part: 'terminals', name: 'Terminals and what runs in them' },
]
async function memoryMenu(e: MouseEvent) {
  const m = (await lookAtMemory()) ?? memory.value
  if (!m) return
  const awake = workspaces.value.filter((w) => w.repo.repo.value && w !== active.value)
  const entries: MenuEntry[] = [
    {
      header: `Memory: ${bytesText(m.total)}`,
      detail: `${verdict(m)}${m.system ? ` ${Math.round((m.total / m.system) * 100)}% of this Mac’s ${bytesText(m.system)}.` : ''}`,
    },
    ...PARTS.filter(({ part }) => m[part] > 0 || part === 'app').map(({ part, name }) => {
      const level = levelOf(part, m[part])
      const usual = part === 'terminals' ? 0 : BASELINES[part].usual
      const detail = !level
        ? 'Whatever you’re running there (a dev server, a build)'
        : level === 'good'
          ? `✓ Within its usual ${bytesText(usual)}`
          : `⚠ Above its usual ${bytesText(usual)}${level === 'high' ? ', by a lot' : ''}`
      return { header: `${name} · ${bytesText(m[part])}`, detail }
    }),
    'separator',
    {
      header: 'Biggest',
      detail: m.top
        .slice(0, 4)
        .map((p) => `${p.name} ${bytesText(p.bytes)}`)
        .join(' · '),
    },
    'separator',
    { label: 'Put Other Tabs to Sleep', icon: 'moon', disabled: !awake.length, run: () => active.value && sleepOtherWorkspaces(active.value.id) },
    { label: 'Look Again', icon: 'refresh', run: () => void lookAtMemory() },
  ]
  openMenu(e, entries)
}

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
    <button
      v-if="memory && isOn('memory')"
      class="ghost status-btn memory"
      :title="`Acantha’s using ${bytesText(memory.total)}: click for what, and whether that’s usual`"
      @click="memoryMenu"
    >
      <span class="dot" :class="memoryLevel" /> {{ bytesText(memory.total) }}
    </button>
    <button
      v-if="repo"
      class="ghost status-btn"
      :class="{ on: !prefs.graphCollapsed.value }"
      title="Show or collapse the graph"
      @click="prefs.graphCollapsed.value = !prefs.graphCollapsed.value"
    >
      <Icon name="history" :size="12" /> Graph
    </button>
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
      :class="{ on: prefs.panelOpen.value || active.panel.expanded.value }"
      title="Show or hide the panel: Slack messages and to-do lists"
      @click="togglePanel(active)"
    >
      <Icon name="message" :size="12" /> Panel
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
.memory .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--add);
}
.memory .dot.fair {
  background: var(--modify);
}
.memory .dot.high {
  background: var(--del);
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
