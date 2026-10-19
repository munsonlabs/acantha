<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

const { log, branches, showRemotes, setBranches } = useWorkspace().repo
const open = ref(false)
const query = ref('')
const root = ref<HTMLElement>()

interface Option {
  rev: string
  label: string
}

const options = computed(() => {
  const refs = log.value?.refs ?? []
  const q = query.value.trim().toLowerCase()
  const keep = (o: Option) => !q || o.label.toLowerCase().includes(q)
  return {
    local: refs
      .filter((r) => r.kind === 'branch')
      .map((r) => ({ rev: `refs/heads/${r.name}`, label: r.name }))
      .filter(keep),
    remote: showRemotes.value
      ? refs
          .filter((r) => r.kind === 'remote')
          .map((r) => ({ rev: `refs/remotes/${r.remote}/${r.name}`, label: `${r.remote}/${r.name}` }))
          .filter(keep)
      : [],
  }
})

const label = computed(() => {
  const picked = branches.value
  if (!picked.length) return 'All branches'
  const name = (rev: string) => rev.replace(/^refs\/(heads|remotes)\//, '')
  return picked.length <= 2 ? picked.map(name).join(', ') : `${picked.length} branches`
})

function toggle(rev: string) {
  const picked = branches.value.includes(rev) ? branches.value.filter((b) => b !== rev) : [...branches.value, rev]
  void setBranches(picked)
}

function onlyCurrent() {
  const head = log.value?.headBranch
  if (head) void setBranches([`refs/heads/${head}`])
}

const onDown = (e: MouseEvent) => {
  if (open.value && !root.value?.contains(e.target as Node)) open.value = false
}
const onKey = (e: KeyboardEvent) => {
  if (open.value && e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  }
}
watch(open, (o) => {
  if (o) query.value = ''
})
window.addEventListener('mousedown', onDown, true)
window.addEventListener('keydown', onKey, true)
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDown, true)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div ref="root" class="branch-filter">
    <button class="ghost trigger" :class="{ active: branches.length }" @click="open = !open">
      <Icon name="branch" :size="13" />
      <span>{{ label }}</span>
      <Icon name="chevron" :size="11" class="chev" />
    </button>
    <Transition name="pop">
      <div v-if="open" class="popover menu">
        <input v-model="query" type="text" placeholder="Filter branches" spellcheck="false" autocomplete="off" autofocus />
        <div class="quick">
          <button class="ghost" :class="{ on: !branches.length }" @click="setBranches([])">All branches</button>
          <button class="ghost" :disabled="!log?.headBranch" @click="onlyCurrent">Current only</button>
        </div>
        <div class="list">
          <template
            v-for="group in [
              { title: 'Local', items: options.local },
              { title: 'Remote', items: options.remote },
            ]"
            :key="group.title"
          >
            <div v-if="group.items.length" class="group">{{ group.title }}</div>
            <label v-for="o in group.items" :key="o.rev" class="option">
              <input type="checkbox" :checked="branches.includes(o.rev)" @change="toggle(o.rev)" />
              <span>{{ o.label }}</span>
            </label>
          </template>
          <p v-if="!options.local.length && !options.remote.length" class="none">No matching branches</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.branch-filter {
  position: relative;
}
.trigger {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 260px;
  height: 26px;
  padding: 0 7px;
  border-radius: 6px;
  color: var(--fg-muted);
  font-size: 12px;
}
.trigger span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.trigger.active {
  background: var(--pill);
  color: var(--fg);
}
.chev {
  transform: rotate(90deg);
}
.popover {
  position: absolute;
  top: 30px;
  left: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 280px;
  padding: 8px;
}
.popover input[type='text'] {
  height: 28px;
}
.quick {
  display: flex;
  gap: 4px;
}
.quick button {
  flex: 1;
  height: 26px;
  font-size: 12px;
}
.quick button.on {
  background: var(--pill);
}
.list {
  max-height: 320px;
  overflow: auto;
}
.group {
  padding: 6px 6px 2px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
}
.option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 6px;
  font-size: 12.5px;
}
.option:hover {
  background: var(--hover);
}
.option input {
  margin: 0;
  accent-color: var(--accent);
}
.option span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.none {
  margin: 8px 6px;
  color: var(--fg-faint);
  font-size: 12px;
}
</style>
