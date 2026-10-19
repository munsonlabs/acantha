<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import StatusSection from './StatusSection.vue'

const ws = useWorkspace()
const { log } = ws.repo
const { status, staged, unstaged, conflicts, message, amend, busy, refresh, setAmend, commit, push, pull } = ws.status
const { fetchAll } = ws.menus

const canPush = computed(() => !!status.value && (!!status.value.upstream || !!log.value?.remotes.length))
const clean = computed(() => !!status.value && !staged.value.length && !unstaged.value.length && !conflicts.value.length)

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void commit()
  }
}
</script>

<template>
  <section class="pane scm">
    <header class="pane-header">
      <span class="title" :title="status?.upstream ? `Tracking ${status.upstream}` : 'No upstream'">
        <Icon name="branch" :size="13" />
        {{ status?.branch ?? 'detached HEAD' }}
      </span>
      <div class="spacer" />
      <button class="ghost icon-btn" title="Pull" :disabled="busy || !status?.upstream" @click="pull"><Icon name="pull" /></button>
      <button class="ghost icon-btn" title="Fetch from all remotes" :disabled="busy || !log?.remotes.length" @click="fetchAll">
        <Icon name="fetch" />
      </button>
      <button class="ghost icon-btn" title="Refresh" @click="refresh"><Icon name="refresh" /></button>
    </header>
    <div class="scm-body">
      <div class="composer">
        <textarea
          v-model="message"
          :placeholder="amend ? 'Amend commit message' : 'Commit message'"
          rows="3"
          spellcheck="true"
          @keydown="onKeydown"
        />
        <span class="hint">⌘↵ to commit</span>
      </div>
      <div class="meta">
        <span><span class="dot" :class="{ on: staged.length }" />{{ staged.length }} file{{ staged.length === 1 ? '' : 's' }} staged</span>
        <span v-if="status?.upstream" class="upstream" :title="`${status.ahead} ahead, ${status.behind} behind`">
          {{ status.upstream }}
          <template v-if="status.ahead || status.behind"> ↑{{ status.ahead }} ↓{{ status.behind }}</template>
        </span>
      </div>
      <div class="buttons">
        <button class="primary" :disabled="busy || !message.trim()" @click="commit">
          <Icon name="check" :size="13" /> {{ amend ? 'Amend' : 'Commit' }}
        </button>
        <button :disabled="busy || !canPush" @click="push">
          <Icon name="push" :size="13" /> Push<span v-if="status?.ahead" class="badge">{{ status.ahead }}</span>
        </button>
      </div>
      <label class="amend check"
        ><input type="checkbox" :checked="amend" @change="setAmend(($event.target as HTMLInputElement).checked)" /> Amend last commit</label
      >

      <div class="lists">
        <StatusSection title="Merge Conflicts" :files="conflicts" mode="conflict" />
        <StatusSection title="Staged Changes" :files="staged" mode="staged" />
        <StatusSection title="Changes" :files="unstaged" mode="unstaged" />
        <p v-if="clean" class="clean"><Icon name="check" :size="13" /> Working tree clean</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.scm {
  display: flex;
  flex-direction: column;
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  padding: 0 6px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.scm-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.composer {
  position: relative;
}
textarea {
  display: block;
  width: 100%;
  min-height: 74px;
  max-height: 240px;
  padding: 9px 10px 22px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--input-bg);
  color: var(--fg);
  font: 12.5px/1.45 var(--font);
  resize: vertical;
  outline: none;
  user-select: text;
}
textarea:focus {
  border-color: var(--ring);
}
textarea::placeholder {
  color: var(--fg-faint);
}
.hint {
  position: absolute;
  bottom: 6px;
  left: 10px;
  color: var(--fg-faint);
  font-size: 10.5px;
  pointer-events: none;
}
.meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 2px;
  color: var(--fg-muted);
  font-size: 11px;
}
.meta > span {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-faint);
}
.dot.on {
  background: var(--add);
}
.upstream {
  overflow: hidden;
  color: var(--fg-faint);
  text-overflow: ellipsis;
}
.buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.buttons button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.badge {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--pill);
  font-size: 10.5px;
}
.amend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 2px 4px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.lists {
  margin-top: 8px;
}
.clean {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 4px;
  color: var(--fg-faint);
  font-size: 12px;
}
</style>
