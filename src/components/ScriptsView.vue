<script lang="ts">
import type { Scripts as ScriptList } from '@/lib/scripts'

/** Each repository's list, kept for the session (across tab switches); Refresh asks again. */
const cache = new Map<string, ScriptList>()
</script>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { listScripts, scriptKey, scriptRows, scriptRun, type Script, type Scripts } from '@/lib/scripts'
import { useWorkspace } from '@/composables/workspace'
import FileIcon from './FileIcon.vue'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

/**
 * The repository's scripts: Vite+ tasks (as `vp run` lists them, nested packages included) or npm scripts from every
 * package.json. Run opens one in its own terminal tab, so it keeps going (a dev server, say) whatever the panel shows.
 */
const ws = useWorkspace()
const { repo } = ws.repo
const { sessions } = ws.terminals

const data = shallowRef<Scripts | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const filter = ref('')

async function load(fresh = false) {
  const root = repo.value
  if (!root) return
  const cached = cache.get(root)
  if (cached && !fresh) return void (data.value = cached)
  loading.value = true
  error.value = null
  try {
    const result = await listScripts(root)
    cache.set(root, result)
    if (repo.value === root) data.value = result
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => load())

/** Folders you've closed. While filtering, everything that matches shows. */
const collapsed = ref(new Set<string>())

const rows = computed(() => {
  const d = data.value
  if (!d) return []
  const q = filter.value.trim().toLowerCase()
  const shown = q ? d.scripts.filter((s) => `${s.dir} ${s.package ?? ''} ${s.name} ${s.command}`.toLowerCase().includes(q)) : d.scripts
  return scriptRows(shown, q ? new Set() : collapsed.value)
})

function toggle(path: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(path)) next.add(path)
  collapsed.value = next
}

/** The tool's logo beside each script: npm's, or Vite's for Vite+ tasks (from the file icons). */
const logo = computed(() => (data.value?.tool === 'vp' ? 'vite.config.ts' : '.npmrc'))

const terminalFor = (s: Script) => data.value && sessions.value.find((t) => t.script === scriptKey(data.value!.tool, s))

function run(s: Script) {
  const d = data.value
  if (!d || !repo.value) return
  const open = terminalFor(s)
  if (open) return ws.terminals.show(open.key)
  const { dir, command } = scriptRun(d.tool, s)
  ws.terminals.add(dir ? `${repo.value}/${dir}` : undefined, { title: s.name, command, script: scriptKey(d.tool, s) })
}
</script>

<template>
  <div class="scripts">
    <div class="bar">
      <span v-if="data" class="tool">{{ data.tool === 'vp' ? 'Vite+ tasks' : 'npm scripts' }}</span>
      <label class="filter">
        <Icon name="search" :size="12" />
        <input v-model="filter" type="text" placeholder="Filter" spellcheck="false" autocomplete="off" />
      </label>
      <button class="ghost icon-btn" title="Refresh" :disabled="loading" @click="load(true)"><Icon name="refresh" /></button>
    </div>

    <div class="list">
      <p v-if="error" class="note error">{{ error }}</p>
      <Skeleton v-else-if="!data" :lines="8" :gap="14" />
      <p v-else-if="!data.scripts.length" class="note">No scripts found: no Vite+ tasks, and no package.json with scripts.</p>
      <p v-else-if="!rows.length" class="note">Nothing matches.</p>
      <template v-for="r in rows" :key="r.kind === 'folder' ? `f:${r.path}` : `s:${r.script.dir}:${r.script.name}`">
        <div
          v-if="r.kind === 'folder'"
          class="row folder"
          :style="{ paddingLeft: `${6 + r.depth * 14}px` }"
          :title="r.path || 'The repository root'"
          @click="toggle(r.path)"
        >
          <Icon name="chevron" :size="11" class="chev" :class="{ open: !collapsed.has(r.path) || filter.trim() }" />
          <FileIcon :path="r.path || 'root'" folder :open="!collapsed.has(r.path)" />
          <span class="folder-name">{{ r.label }}</span>
        </div>
        <div v-else class="row" :class="{ open: terminalFor(r.script) }" :style="{ paddingLeft: `${8 + r.depth * 14}px` }">
          <FileIcon :path="logo" />
          <span class="name">{{ r.script.name }}</span>
          <span class="command" :title="r.script.command">{{ r.script.command }}</span>
          <template v-if="terminalFor(r.script)">
            <button class="ghost icon-btn" title="Show its terminal" @click="ws.terminals.show(terminalFor(r.script)!.key)">
              <Icon name="terminal" :size="13" />
            </button>
            <button class="ghost icon-btn" title="Stop and close its terminal" @click="ws.terminals.close(terminalFor(r.script)!.key)">
              <Icon name="stop" :size="12" />
            </button>
          </template>
          <button v-else class="ghost icon-btn run" title="Run in a terminal tab" @click="run(r.script)"><Icon name="play" :size="12" /></button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scripts {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}
.tool {
  color: var(--fg-muted);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.filter {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--fg-faint);
}
.filter:focus-within {
  border-color: var(--ring);
}
.filter input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
}
.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 6px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.folder {
  gap: 5px;
  cursor: default;
}
.folder-name {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  flex: none;
  color: var(--fg-faint);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 4px 0 8px;
  border-radius: 7px;
}
.row:hover {
  background: var(--hover);
}
.row.open .name::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--accent);
  vertical-align: middle;
}
.name {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  font: 12px var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font: 11.5px var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-btn {
  flex: none;
  width: 24px;
  height: 24px;
  color: var(--fg-faint);
}
.run {
  opacity: 0;
}
.row:hover .run,
.run:focus-visible {
  opacity: 1;
}
.icon-btn:hover {
  color: var(--accent);
}
.note {
  margin: 16px 8px;
  color: var(--fg-faint);
  font-size: 12px;
}
.note.error {
  color: var(--danger, #e5534b);
}
</style>
