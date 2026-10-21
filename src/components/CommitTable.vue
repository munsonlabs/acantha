<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { UNCOMMITTED, type Commit } from '@/lib/git'
import { colorFor, ROW_H } from '@/lib/graph'
import { formatDate, shortHash } from '@/lib/format'
import { displayDate } from '@/composables/dates'
import { prefs } from '@/composables/prefs'
import { useWorkspace } from '@/composables/workspace'
import { openMenu, useContextMenu, type MenuEntry, type MenuItem } from '@/composables/useContextMenu'
import Avatar from './Avatar.vue'
import CommitGraph from './CommitGraph.vue'
import CommitHoverCard from './CommitHoverCard.vue'
import Icon from './Icon.vue'
import RefLabels from './RefLabels.vue'

const ws = useWorkspace()
const { log, rows, layout, refsByHash, stats, loadMore } = ws.repo
/** Branches checked out in other worktrees, marked on their labels. */
const elsewhere = computed(
  () => new Map((log.value?.worktrees ?? []).filter((w) => w.branch && !w.current).map((w) => [w.branch!, w.path.split('/').pop() ?? w.path])),
)
const { selected, compareWith, select, compare, closeDetails } = ws.details
const { matchSet, current } = ws.search
const { target } = ws.reveal
const { branchMenu, checkoutBranch, checkoutRemoteBranch, commitMenu, remoteBranchMenu, stashMenu, tagMenu, uncommittedMenu } = ws.menus
const { menu } = useContextMenu()

const root = ref<HTMLElement>()
const scroller = ref<HTMLElement>()

/**
 * Only the rows near the visible part of the list are rendered (rows have a fixed height, so their place is known
 * without measuring); the list keeps its full height, so scrolling and jumping to a commit work as before. OVERSCAN
 * rows either side keep fast scrolling from showing gaps.
 */
const OVERSCAN = 20
const scrollTop = ref(0)
const viewHeight = ref(0)
let scrollFrame = 0
function onScroll() {
  hideCard()
  cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => (scrollTop.value = scroller.value?.scrollTop ?? 0))
}
const viewObserver = new ResizeObserver(([entry]) => (viewHeight.value = entry.contentRect.height))
onMounted(() => scroller.value && viewObserver.observe(scroller.value))
onBeforeUnmount(() => {
  viewObserver.disconnect()
  cancelAnimationFrame(scrollFrame)
})
const range = computed(() => {
  const n = rows.value.length
  const start = Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN)
  const end = Math.min(n, Math.ceil((scrollTop.value + (viewHeight.value || 800)) / ROW_H) + OVERSCAN)
  return { start, end: Math.max(start, end) }
})
const windowRows = computed(() => rows.value.slice(range.value.start, range.value.end).map((c, j) => ({ c, i: range.value.start + j })))

/**
 * Columns after the graph, in their default order. Each shows when it isn't turned off in the header's menu and the
 * table is at least `min` wide, so narrow windows drop the least useful first. Quick actions only fit on wide windows.
 * The subject can be moved but not hidden.
 */
const COLUMNS = [
  { id: 'sha', label: 'SHA', width: '64px', min: 480 },
  { id: 'subject', label: 'Subject', width: 'minmax(0, 1fr)', min: 0 },
  { id: 'changes', label: 'Changes', width: '104px', min: 900 },
  { id: 'author', label: 'Author', width: '150px', min: 680 },
  { id: 'date', label: 'Date', width: '96px', min: 480 },
  { id: 'actions', label: 'Quick Actions', width: '112px', min: 1100 },
] as const
type ColumnId = (typeof COLUMNS)[number]['id']

const width = ref(Infinity)
const resize = new ResizeObserver(([entry]) => (width.value = entry.contentRect.width))
onMounted(() => resize.observe(root.value!))
onBeforeUnmount(() => resize.disconnect())

const column = (id: ColumnId) => COLUMNS.find((c) => c.id === id)!

/** The saved order, with any column it doesn't mention (one added since it was saved) at the end. */
const order = computed(() => {
  const saved = prefs.columnOrder.value.filter((id): id is ColumnId => COLUMNS.some((c) => c.id === id))
  return [...saved, ...COLUMNS.map((c) => c.id).filter((id) => !saved.includes(id))]
})
const shown = computed(
  () => new Set<ColumnId>(COLUMNS.filter((c) => width.value >= c.min && !prefs.hiddenColumns.value.includes(c.id)).map((c) => c.id)),
)
const visible = computed(() => order.value.filter((id) => shown.value.has(id)))
const gridColumns = computed(() => ['var(--graph-w)', ...visible.value.map((id) => column(id).width)].join(' '))
/** Cells keep their place in the markup and are laid out by CSS `order`, from these variables. */
const columnVars = computed(() => Object.fromEntries(order.value.map((id, i) => [`--o-${id}`, i + 1])))

/**
 * Dragging a header cell sideways moves its column. `drop` is where it would land: the column it would go before
 * (null for the end) and the x of the marker drawn there.
 */
const header = ref<HTMLElement>()
const dragging = ref<ColumnId | null>(null)
const drop = ref<{ before: ColumnId | null; x: number } | null>(null)
let dragStart: { id: ColumnId; x: number } | null = null

function headerDown(e: PointerEvent) {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col as ColumnId | undefined
  if (e.button !== 0 || !id) return
  dragStart = { id, x: e.clientX }
  header.value!.setPointerCapture(e.pointerId)
}

function headerMove(e: PointerEvent) {
  if (!dragStart) return
  if (!dragging.value && Math.abs(e.clientX - dragStart.x) < 4) return
  dragging.value = dragStart.id
  const box = header.value!.getBoundingClientRect()
  const cells = [...header.value!.querySelectorAll<HTMLElement>('[data-col]')]
    .filter((el) => el.dataset.col !== dragStart!.id)
    .map((el) => ({ id: el.dataset.col as ColumnId, rect: el.getBoundingClientRect() }))
    .sort((a, b) => a.rect.left - b.rect.left)
  const next = cells.find((c) => e.clientX < c.rect.left + c.rect.width / 2)
  const x = next ? next.rect.left : (cells.at(-1)?.rect.right ?? box.right)
  drop.value = { before: next?.id ?? null, x: x - box.left }
}

function headerUp() {
  const id = dragging.value
  if (id && drop.value) {
    const rest = order.value.filter((c) => c !== id)
    const at = drop.value.before ? rest.indexOf(drop.value.before) : rest.length
    rest.splice(at, 0, id)
    prefs.columnOrder.value = rest
  }
  dragStart = null
  dragging.value = null
  drop.value = null
}

function columnsMenu(e: MouseEvent) {
  const hidden = prefs.hiddenColumns.value
  openMenu(e, [
    { header: 'Columns', detail: 'Narrow windows hide some anyway' },
    ...COLUMNS.filter((c) => c.id !== 'subject').map((c) => ({
      label: c.label,
      icon: hidden.includes(c.id) ? undefined : ('check' as const),
      run: () => (prefs.hiddenColumns.value = hidden.includes(c.id) ? hidden.filter((h) => h !== c.id) : [...hidden, c.id]),
    })),
    'separator',
    { label: 'Reset Column Order', icon: 'undo', disabled: !prefs.columnOrder.value.length, run: () => (prefs.columnOrder.value = []) },
  ])
}

/**
 * Commits that just appeared at the top (after a fetch, a commit, or work in the terminal) slide in with a brief
 * highlight. The first load, switching repos, changing the branch filter and "load more" (which adds older commits
 * below) don't count.
 */
const fresh = shallowRef(new Set<string>())
let known: Set<string> | null = null
let freshTimer: ReturnType<typeof setTimeout> | undefined
// Showing different branches, remotes or stashes brings commits into view that aren't new: no slide-in for those.
watch([ws.repo.repo, ws.repo.branches, ws.repo.showRemotes, ws.repo.showStashes], () => (known = null))
watch(rows, (now) => {
  const hashes = now.map((c) => c.hash).filter((h) => h !== UNCOMMITTED)
  if (known) {
    const firstKnown = hashes.findIndex((h) => known!.has(h))
    const added = hashes.slice(0, firstKnown === -1 ? 0 : firstKnown)
    if (added.length && added.length < 50) {
      fresh.value = new Set(added)
      clearTimeout(freshTimer)
      freshTimer = setTimeout(() => (fresh.value = new Set()), 1200)
    }
  }
  known = new Set(hashes)
})
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
  if (c.hash === UNCOMMITTED || c.stash || !prefs.hoverCards.value) return hideCard(150)
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
watch(prefs.hoverCards, (on) => !on && hideCard())

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

/** Quick actions run the same items as the row's context menu, which is only built when one is clicked. */
const runItem = (items: MenuEntry[], label: string) =>
  items.find((m): m is MenuItem => typeof m === 'object' && 'label' in m && m.label === label)?.run()

/** The branch "Checkout" switches to: a local branch at the commit other than the current one, else a remote one. */
function checkoutRef(c: Commit) {
  const refs = log.value!.refs.filter((r) => r.hash === c.hash)
  return refs.find((r) => r.kind === 'branch' && r.name !== log.value!.headBranch) ?? refs.find((r) => r.kind === 'remote')
}

function checkout(c: Commit) {
  const ref = checkoutRef(c)
  if (ref?.kind === 'branch') return checkoutBranch(ref.name)
  if (ref?.kind === 'remote') return checkoutRemoteBranch(ref.remote!, ref.name)
  return runItem(commitMenu(c), 'Checkout…')
}

function checkoutTitle(c: Commit) {
  const ref = checkoutRef(c)
  if (ref) return `Checkout ${ref.remote ? `${ref.remote}/` : ''}${ref.name}`
  return c.hash === log.value!.head ? 'Already checked out' : 'Checkout commit'
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
  <div ref="root" class="commit-table" :style="{ '--graph-w': `${graphWidth}px`, '--row-h': `${ROW_H}px`, '--columns': gridColumns, ...columnVars }">
    <div
      ref="header"
      class="row header"
      :class="{ dragging }"
      @contextmenu.prevent="columnsMenu"
      @pointerdown="headerDown"
      @pointermove="headerMove"
      @pointerup="headerUp"
      @pointercancel="headerUp"
    >
      <div />
      <template v-for="id in visible" :key="id">
        <div :data-col="id" :class="[`c-${id}`, { moving: dragging === id }]">{{ id === 'actions' ? '' : column(id).label }}</div>
      </template>
      <span v-if="drop" class="drop-marker" :style="{ left: `${drop.x}px` }" />
    </div>
    <div ref="scroller" class="scroller" @scroll.passive="onScroll">
      <div v-if="!rows.length" class="no-commits">This repository has no commits yet.</div>
      <div class="rows" :style="{ height: `${rows.length * ROW_H}px` }">
        <div class="graph-layer">
          <CommitGraph :layout="layout" :rows="rows" :head="log!.head" :highlight="highlight" :range="range" />
        </div>
        <div class="window" :style="{ transform: `translateY(${range.start * ROW_H}px)` }">
          <div
            v-for="{ c, i } in windowRows"
            :key="c.hash"
            class="row commit"
            :class="{
              selected: c.hash === selected || c.hash === compareWith,
              uncommitted: c.hash === UNCOMMITTED,
              stash: !!c.stash,
              head: c.hash === log!.head,
              match: matchSet.has(i),
              'match-current': current === i,
              fresh: fresh.has(c.hash),
            }"
            @click="onClick($event, c)"
            @dblclick="onDoubleClick"
            @contextmenu.prevent="onContextMenu($event, c)"
            @mouseenter="onEnter($event, c, i)"
            @mousemove="trackMouse"
            @mouseleave="onLeave"
          >
            <div />
            <div v-if="shown.has('sha')" class="sha c-sha">{{ c.hash === UNCOMMITTED ? '' : shortHash(c.hash) }}</div>
            <div class="desc c-subject">
              <span v-if="c.stash" class="stash-label"><Icon name="archive" :size="11" /> {{ c.stash.selector }}</span>
              <RefLabels
                v-if="refsByHash.has(c.hash) || (c.hash === log!.head && !log!.headBranch)"
                :refs="refsByHash.get(c.hash)"
                :color="colorFor(layout.nodes[i].color)"
                :head-branch="log!.headBranch"
                :detached="c.hash === log!.head && !log!.headBranch"
                :elsewhere="elsewhere"
              />
              <span class="subject">{{ c.subject }}</span>
            </div>
            <div v-if="shown.has('changes')" class="c-changes">
              <template v-if="stats.get(c.hash)?.files">
                <span class="files"><Icon name="file" :size="11" />{{ stats.get(c.hash)!.files }}</span>
                <span class="add">+{{ stats.get(c.hash)!.additions }}</span>
                <span class="del">−{{ stats.get(c.hash)!.deletions }}</span>
              </template>
            </div>
            <div v-if="shown.has('author')" class="c-author" :title="c.email">
              <template v-if="c.hash !== UNCOMMITTED">
                <Avatar :name="c.author" :email="c.email" :size="18" />
                <span class="author">{{ c.author }}</span>
              </template>
            </div>
            <div v-if="shown.has('date')" class="c-date" :title="formatDate(c.date)">{{ c.hash === UNCOMMITTED ? '' : displayDate(c.date) }}</div>
            <div v-if="shown.has('actions')" class="c-actions" @click.stop @dblclick.stop @mouseenter="hideCard()">
              <template v-if="c.stash">
                <button class="ghost icon-btn" title="Apply stash" @click="runItem(stashMenu(c.stash), 'Apply Stash')">
                  <Icon name="inbox" :size="14" />
                </button>
              </template>
              <template v-else-if="c.hash !== UNCOMMITTED">
                <button class="ghost icon-btn" :title="checkoutTitle(c)" :disabled="c.hash === log!.head && !checkoutRef(c)" @click="checkout(c)">
                  <Icon name="checkout" :size="14" />
                </button>
                <button class="ghost icon-btn" title="Create branch here" @click="runItem(commitMenu(c), 'Create Branch…')">
                  <Icon name="branch" :size="14" />
                </button>
                <button class="ghost icon-btn" title="Cherry pick" :disabled="c.hash === log!.head" @click="runItem(commitMenu(c), 'Cherry Pick…')">
                  <Icon name="cherry" :size="14" />
                </button>
              </template>
              <button class="ghost icon-btn" title="More actions" @click="onContextMenu($event, c)"><Icon name="ellipsis" :size="14" /></button>
            </div>
          </div>
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
}
.row {
  display: grid;
  grid-template-columns: var(--columns);
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
  height: 30px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
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
.commit {
  transition: background 0.12s;
}
.commit:hover {
  background: var(--hover);
}
/* Selection uses the accent: a tint plus a bar on the left edge. */
.commit.selected {
  background: var(--selected);
  box-shadow: inset 2px 0 0 var(--accent);
}
.commit.fresh {
  animation: row-in 0.9s var(--ease-out) both;
}
@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
    background: var(--accent-soft);
  }
  25% {
    opacity: 1;
    transform: none;
    background: var(--accent-soft);
  }
  to {
    background: transparent;
  }
}
.commit.match {
  background: var(--match);
}
.commit.match-current {
  box-shadow: inset 2px 0 0 var(--tag);
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
  font-size: 13.5px;
  font-weight: 450;
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
  height: 20px;
  margin-right: 6px;
  padding: 0 8px 0 7px;
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
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
  color: var(--fg-faint);
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
/* Cells sit in a fixed place in the markup; the column order puts them where they belong. */
.c-sha {
  order: var(--o-sha);
}
.c-subject {
  order: var(--o-subject);
}
.c-changes {
  order: var(--o-changes);
}
.c-author {
  order: var(--o-author);
}
.c-date {
  order: var(--o-date);
}
.c-actions {
  order: var(--o-actions);
}
.header {
  position: relative;
  user-select: none;
}
.header [data-col] {
  cursor: grab;
}
.header.dragging,
.header.dragging [data-col] {
  cursor: grabbing;
}
.header .moving {
  opacity: 0.4;
}
.drop-marker {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--accent);
  pointer-events: none;
}
.c-actions {
  justify-content: flex-end;
  gap: 2px;
  padding-right: 8px !important;
}
.c-actions button.icon-btn {
  width: 24px;
  height: 24px;
  color: var(--fg-faint);
  opacity: 0.5;
  transition: opacity 0.12s;
}
.commit:hover .c-actions button,
.commit.selected .c-actions button {
  opacity: 1;
}
.c-actions button.icon-btn:hover:not(:disabled) {
  color: var(--fg);
}
.c-actions button:disabled {
  opacity: 0.2 !important;
}
</style>
