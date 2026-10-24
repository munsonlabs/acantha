<script setup lang="ts">
import { computed } from 'vue'
import { isOn } from '@/features'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

/**
 * A repository tour's card, floating over the centre while it's on: the stop's title, where it is, and what to know,
 * with the way back and on (the editor showing the stop's file at its lines), and a way to ask an agent about it.
 */
const ws = useWorkspace()
const { tour } = ws
const t = computed(() => tour.current())
const stop = computed(() => t.value?.stops[t.value.at])
const lines = computed(() =>
  stop.value ? (stop.value.end > stop.value.start ? `lines ${stop.value.start}–${stop.value.end}` : `line ${stop.value.start}`) : '',
)

function askAbout() {
  const s = stop.value
  if (s) ws.agents.askAgent(`About ${s.file}, ${lines.value} (“${s.title}” on a tour of this repository): `)
}
</script>

<template>
  <Transition name="pop">
    <aside v-if="tour.showing.value && (tour.planning.value || stop)" class="tour-card" role="dialog" aria-label="Repository tour">
      <template v-if="tour.planning.value">
        <div class="head">
          <span class="spinner" />
          <span class="title">Planning a tour…</span>
          <div class="spacer" />
          <button class="ghost icon-btn" title="Hide (the tour carries on being planned)" @click="tour.hide()">
            <Icon name="minus" :size="12" />
          </button>
        </div>
        <p class="note">
          Claude Code is reading the code, changing nothing, to choose where to start and what to show. This takes about half a minute.
        </p>
      </template>
      <template v-else-if="t && stop">
        <div class="head">
          <span class="count">{{ t.at + 1 }} / {{ t.stops.length }}</span>
          <span class="title">{{ stop.title }}</span>
          <div class="spacer" />
          <button class="ghost icon-btn" title="Hide the tour (carry on later)" @click="tour.hide()"><Icon name="minus" :size="12" /></button>
          <button class="ghost icon-btn" title="End the tour" @click="tour.end()"><Icon name="x" :size="12" /></button>
        </div>
        <button class="ghost where" title="Show it again" @click="tour.go(t.at)">
          <Icon name="file" :size="11" /> {{ stop.file }} · {{ lines }}
        </button>
        <p class="note">{{ stop.note }}</p>
        <div class="foot">
          <div class="dots">
            <button v-for="(s, i) in t.stops" :key="i" class="dot" :class="{ on: i === t.at }" :title="s.title" @click="tour.go(i)" />
          </div>
          <div class="spacer" />
          <button v-if="isOn('claude')" class="ghost" title="Ask an agent about this stop" @click="askAbout">
            <Icon name="bot" :size="12" /> Ask
          </button>
          <button :disabled="t.at === 0" @click="tour.go(t.at - 1)">Back</button>
          <button v-if="t.at < t.stops.length - 1" class="primary" @click="tour.go(t.at + 1)">Next</button>
          <button v-else class="primary" @click="tour.end()">Done</button>
        </div>
      </template>
    </aside>
  </Transition>
</template>

<style scoped>
.tour-card {
  position: absolute;
  right: 50%;
  bottom: 16px;
  z-index: 20;
  width: min(560px, calc(100% - 32px));
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--popover);
  box-shadow: var(--shadow);
  transform: translateX(50%);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.count {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--pill);
  color: var(--fg-muted);
  font: 500 11px var(--font);
}
.title {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1;
}
.icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--fg-faint);
}
.where {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  margin-top: 6px;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--fg-muted);
  font: 11.5px var(--mono);
}
.note {
  margin: 8px 0 10px;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.55;
}
.foot {
  display: flex;
  align-items: center;
  gap: 6px;
}
.foot button:not(.dot) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
}
.dots {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--border-strong);
}
.dot.on {
  background: var(--accent);
}
.spinner {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
