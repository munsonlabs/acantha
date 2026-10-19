<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { UNCOMMITTED, type Commit } from '@/lib/git'
import { colorFor, ROW_H } from '@/lib/graph'
import { formatDate, shortHash } from '@/lib/format'
import { displayDate } from '@/composables/dates'
import { useWorkspace } from '@/composables/workspace'
import { openMenu, useContextMenu } from '@/composables/useContextMenu'
import Avatar from './Avatar.vue'
import CommitGraph from './CommitGraph.vue'
import CommitHoverCard from './CommitHoverCard.vue'
import Icon from './Icon.vue'
import RefLabels from './RefLabels.vue'

const ws = useWorkspace()
const { log, rows, layout, refsByHash, stats, loadMore } = ws.repo
const { selected, compareWith, select, compare, closeDetails } = ws.details
const { matchSet, current } = ws.search
const { target } = ws.reveal
const { branchMenu, checkoutBranch, checkoutRemoteBranch, commitMenu, remoteBranchMenu, stashMenu, tagMenu, uncommittedMenu } = ws.menus
const { menu } = useContextMenu()

const scroller = ref<HTMLElement>()
const graphWidth = computed(() => Math.min(Math.max(layout.value.width, 40), 400))

/** The row under the mouse, whose branch line the graph highlights. */
const hoverRow = ref<number | null>(null)
const highlight = computed(() => (hoverRow.value === null ? null : (layout.value.nodes[hoverRow.value]?.color ?? null)))

/** The hover card appears after a pause, then follows the mouse quickly from row to row while it is open. */
const card = shallowRef<{ commit: Commit; x: number; y: number } | null>(null)
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let mouseX = 0

function hideCard(delay = 0) {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  if (delay) hideTimer = setTimeout(() => (card.value = null), delay)
  else card.value = null
}

function onEnter(e: MouseEvent, c: Commit, i: number) {
  hoverRow.value = i
  mouseX = e.clientX
  clearTimeout(hideTimer)
  clearTimeout(showTimer)
  if (c.hash === UNCOMMITTED || c.stash) return hideCard(150)
  const row = e.currentTarget as HTMLElement
  showTimer = setTimeout(
    () => {
      if (menu.value) return
      card.value = { commit: c, x: mouseX + 12, y: row.getBoundingClientRect().bottom + 4 }
    },
    card.value ? 150 : 700,
  )
}

const keepCard = () => clearTimeout(hideTimer)

function openCard() {
  if (card.value) void select(card.value.commit.hash)
  hideCard()
}
const trackMouse = (e: MouseEvent) => (mouseX = e.clientX)

function onLeave() {
  hoverRow.value = null
  clearTimeout(showTimer)
  hideTimer = setTimeout(() => (card.value = null), 200)
}

const refAt = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('[data-ref-kind]')?.dataset

function onClick(e: MouseEvent, c: Commit) {
  hideCard()
  if ((e.metaKey || e.ctrlKey) && selected.value && selected.value !== c.hash) return compare(selected.value, c.hash)
  if (selected.value === c.hash && !compareWith.value) return closeDetails()
  select(c.hash)
}

function onContextMenu(e: MouseEvent, c: Commit) {
  hideCard()
  const ref = refAt(e)
  if (ref?.refKind === 'branch') return openMenu(e, branchMenu(ref.refName!))
  if (ref?.refKind === 'remote') return openMenu(e, remoteBranchMenu(ref.refRemote!, ref.refName!))
  if (ref?.refKind === 'tag') return openMenu(e, tagMenu(ref.refName!))
  if (c.stash) return openMenu(e, stashMenu(c.stash))
  openMenu(e, c.hash === UNCOMMITTED ? uncommittedMenu() : commitMenu(c))
}

function onDoubleClick(e: MouseEvent) {
  const ref = refAt(e)
  if (ref?.refKind === 'branch') void checkoutBranch(ref.refName!)
  if (ref?.refKind === 'remote') void checkoutRemoteBranch(ref.refRemote!, ref.refName!)
}

watch(target, (t) => {
  const el = scroller.value
  if (!t || !el) return
  const top = t.row * ROW_H
  if (top < el.scrollTop) el.scrollTop = top - ROW_H * 2
  else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight / 2
})

// Any key, like opening the palette, dismisses the card.
const onKey = () => hideCard()
window.addEventListener('keydown', onKey, true)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  hideCard()
})
</script>

<template>
  <div class="commit-table" :style="{ '--graph-w': `${graphWidth}px`, '--row-h': `${ROW_H}px` }">
    <div class="row header">
      <div />
      <div class="c-sha">SHA</div>
      <div>Subject</div>
      <div class="c-changes">Changes</div>
      <div class="c-author">Author</div>
      <div class="c-date">Date</div>
    </div>
    <div ref="scroller" class="scroller" @scroll.passive="hideCard()">
      <div v-if="!rows.length" class="no-commits">This repository has no commits yet.</div>
      <div class="rows">
        <div class="graph-layer">
          <CommitGraph :layout="layout" :rows="rows" :head="log!.head" :highlight="highlight" />
        </div>
        <div
          v-for="(c, i) in rows"
          :key="c.hash"
          class="row commit"
          :class="{
            selected: c.hash === selected || c.hash === compareWith,
            uncommitted: c.hash === UNCOMMITTED,
            stash: !!c.stash,
            head: c.hash === log!.head,
            match: matchSet.has(i),
            'match-current': current === i,
          }"
          @click="onClick($event, c)"
          @dblclick="onDoubleClick"
          @contextmenu.prevent="onContextMenu($event, c)"
          @mouseenter="onEnter($event, c, i)"
          @mousemove="trackMouse"
          @mouseleave="onLeave"
        >
          <div />
          <div class="sha c-sha">{{ c.hash === UNCOMMITTED ? '' : shortHash(c.hash) }}</div>
          <div class="desc">
            <span v-if="c.stash" class="stash-label"><Icon name="archive" :size="11" /> {{ c.stash.selector }}</span>
            <RefLabels
              v-if="refsByHash.has(c.hash) || (c.hash === log!.head && !log!.headBranch)"
              :refs="refsByHash.get(c.hash)"
              :color="colorFor(layout.nodes[i].color)"
              :head-branch="log!.headBranch"
              :detached="c.hash === log!.head && !log!.headBranch"
            />
            <span class="subject">{{ c.subject }}</span>
          </div>
          <div class="c-changes">
            <template v-if="stats.get(c.hash)?.files">
              <span class="files"><Icon name="file" :size="11" />{{ stats.get(c.hash)!.files }}</span>
              <span class="add">+{{ stats.get(c.hash)!.additions }}</span>
              <span class="del">−{{ stats.get(c.hash)!.deletions }}</span>
            </template>
          </div>
          <div class="c-author" :title="c.email">
            <template v-if="c.hash !== UNCOMMITTED">
              <Avatar :name="c.author" :email="c.email" />
              <span class="author">{{ c.author }}</span>
            </template>
          </div>
          <div class="c-date" :title="formatDate(c.date)">{{ c.hash === UNCOMMITTED ? '' : displayDate(c.date) }}</div>
        </div>
      </div>
      <button v-if="log!.hasMore" class="load-more" @click="loadMore">Load more commits</button>
    </div>
    <CommitHoverCard v-if="card" :commit="card.commit" :x="card.x" :y="card.y" @enter="keepCard" @leave="hideCard(200)" @open="openCard" />
  </div>
</template>

<style scoped>
.commit-table {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  container-type: inline-size;
}
.row {
  display: grid;
  grid-template-columns: var(--graph-w) 64px minmax(0, 1fr) 104px 150px 96px;
  align-items: center;
  height: var(--row-h);
}
.row > div {
  display: flex;
  align-items: center;
  overflow: hidden;
  padding-right: 12px;
  white-space: nowrap;
}
.header {
  flex: none;
  height: 26px;
  color: var(--fg-faint);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.scroller {
  flex: 1;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.rows {
  position: relative;
}
.graph-layer {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 1;
  width: var(--graph-w);
  overflow: hidden;
  pointer-events: none;
}
.commit {
  cursor: default;
}
.commit:hover {
  background: var(--hover);
}
.commit.selected {
  background: var(--selected);
}
.commit.match {
  background: var(--match);
}
.commit.match-current {
  box-shadow: inset 2px 0 0 var(--fg);
}
.sha {
  color: var(--fg-faint);
  font: 11.5px var(--mono);
}
.desc {
  gap: 0;
}
.subject {
  overflow: hidden;
  text-overflow: ellipsis;
}
.commit.stash .subject {
  color: var(--fg-muted);
}
.stash-label {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 18px;
  margin-right: 6px;
  padding: 0 6px 0 5px;
  border: 1px dashed var(--border-strong);
  border-radius: 5px;
  color: var(--fg-muted);
  font-size: 11px;
}
.commit.uncommitted .subject {
  font-style: italic;
  color: var(--fg-muted);
}
.c-author {
  gap: 7px;
  color: var(--fg-muted);
}
.author {
  overflow: hidden;
  text-overflow: ellipsis;
}
.c-date {
  justify-content: flex-end;
  color: var(--fg-muted);
  font-size: 12px;
}
.c-changes {
  gap: 6px;
  font: 11px var(--mono);
}
.header .c-changes {
  font: inherit;
}
.files {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--fg-faint);
}
.add {
  color: var(--add);
}
.del {
  color: var(--del);
}
.load-more {
  display: block;
  margin: 12px auto 20px;
}
.no-commits {
  padding: 40px;
  text-align: center;
  color: var(--fg-muted);
}
@container (max-width: 900px) {
  .row {
    grid-template-columns: var(--graph-w) 64px minmax(0, 1fr) 150px 96px;
  }
  .c-changes {
    display: none !important;
  }
}
@container (max-width: 680px) {
  .row {
    grid-template-columns: var(--graph-w) 64px minmax(0, 1fr) 96px;
  }
  .c-changes,
  .c-author {
    display: none !important;
  }
}
@container (max-width: 480px) {
  .row {
    grid-template-columns: var(--graph-w) minmax(0, 1fr);
  }
  .c-changes,
  .c-author,
  .c-date,
  .c-sha {
    display: none !important;
  }
}
</style>
