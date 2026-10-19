<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UNCOMMITTED, type Commit } from '@/lib/git'
import { colorFor, ROW_H } from '@/lib/graph'
import { compactDate, formatDate, initials, nameHue, shortHash } from '@/lib/format'
import { useWorkspace } from '@/composables/workspace'
import { openMenu } from '@/composables/useContextMenu'
import CommitGraph from './CommitGraph.vue'
import Icon from './Icon.vue'
import RefLabels from './RefLabels.vue'

const ws = useWorkspace()
const { log, rows, layout, refsByHash, loadMore } = ws.repo
const { selected, compareWith, select, compare, closeDetails } = ws.details
const { matchSet, current } = ws.search
const { target } = ws.reveal
const { branchMenu, checkoutBranch, checkoutRemoteBranch, commitMenu, remoteBranchMenu, stashMenu, tagMenu, uncommittedMenu } = ws.menus

const scroller = ref<HTMLElement>()
const graphWidth = computed(() => Math.min(Math.max(layout.value.width, 40), 400))

const refAt = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('[data-ref-kind]')?.dataset

function onClick(e: MouseEvent, c: Commit) {
  if ((e.metaKey || e.ctrlKey) && selected.value && selected.value !== c.hash) return compare(selected.value, c.hash)
  if (selected.value === c.hash && !compareWith.value) return closeDetails()
  select(c.hash)
}

function onContextMenu(e: MouseEvent, c: Commit) {
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
</script>

<template>
  <div class="commit-table" :style="{ '--graph-w': `${graphWidth}px`, '--row-h': `${ROW_H}px` }">
    <div class="row header">
      <div />
      <div>SHA</div>
      <div>Subject</div>
      <div class="c-author">Author</div>
      <div class="c-date">Date</div>
    </div>
    <div ref="scroller" class="scroller">
      <div v-if="!rows.length" class="no-commits">This repository has no commits yet.</div>
      <div class="rows">
        <div class="graph-layer">
          <CommitGraph :layout="layout" :rows="rows" :head="log!.head" />
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
        >
          <div />
          <div class="sha">{{ c.hash === UNCOMMITTED ? '' : shortHash(c.hash) }}</div>
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
          <div class="c-author" :title="c.email">
            <template v-if="c.hash !== UNCOMMITTED">
              <span class="avatar" :style="{ '--hue': nameHue(c.author) }">{{ initials(c.author) }}</span>
              <span class="author">{{ c.author }}</span>
            </template>
          </div>
          <div class="c-date" :title="formatDate(c.date)">{{ c.hash === UNCOMMITTED ? '' : compactDate(c.date) }}</div>
        </div>
      </div>
      <button v-if="log!.hasMore" class="load-more" @click="loadMore">Load more commits</button>
    </div>
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
  grid-template-columns: var(--graph-w) 64px minmax(0, 1fr) 150px 112px;
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
.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: hsl(var(--hue) 55% 62%);
  color: #141414;
  font-size: 8.5px;
  font-weight: 700;
}
.c-date {
  justify-content: flex-end;
  color: var(--fg-muted);
  font: 11.5px var(--mono);
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
@container (max-width: 640px) {
  .row {
    grid-template-columns: var(--graph-w) 64px minmax(0, 1fr) 112px;
  }
  .c-author {
    display: none !important;
  }
}
@container (max-width: 480px) {
  .row {
    grid-template-columns: var(--graph-w) minmax(0, 1fr);
  }
  .c-date,
  .sha,
  .header > div:nth-child(2) {
    display: none !important;
  }
}
</style>
