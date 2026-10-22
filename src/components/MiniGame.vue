<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { prefs } from '@/composables/prefs'
import Icon from './Icon.vue'

/**
 * Commit Snake, for where the graph was while it's collapsed: steer a branch round the space and pick up commits, each
 * one a new node on it. Arrow keys or WASD, Space to pause, Esc to stop, Shift to boost (twice as fast, double points).
 * The edges wrap round, or in classic mode they're walls; with conflicts on, blocks appear as you go. Now and then a
 * gold hotfix commit shows up for a few seconds, worth five. Loaded only when someone presses Play.
 */
const emit = defineEmits<{ close: [] }>()

const CELL = 16
type Pt = { x: number; y: number }

const box = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const score = ref(0)
const state = ref<'ready' | 'playing' | 'paused' | 'over'>('ready')
/** Classic: the edges are walls. Otherwise they wrap round, and only running into the branch ends it. */
const classic = prefs.gameClassic
/** Merge conflicts: a block appears every few commits, and hitting one ends the game. */
const obstacles = prefs.gameObstacles
/** Each setup keeps its own best, since their scores don't compare. */
const setup = computed(() => `${classic.value ? 'classic' : 'wrap'}${obstacles.value ? '+conflicts' : ''}`)
const setupName = computed(() => `${classic.value ? 'classic' : 'wrap'}${obstacles.value ? ' + conflicts' : ''}`)
const best = computed({
  get: () =>
    prefs.gameBests.value[setup.value] ??
    (setup.value === 'wrap' ? prefs.gameBest.value : setup.value === 'classic' ? prefs.gameBestClassic.value : 0),
  set: (n: number) => void (prefs.gameBests.value = { ...prefs.gameBests.value, [setup.value]: n }),
})
/** What ended the last game, for the message. */
const crash = ref<'self' | 'wall' | 'conflict'>('self')

/** Changes a setting between games, starting afresh. */
function setOption(change: () => void) {
  if (state.value === 'playing') return
  change()
  state.value = 'ready'
  reset()
  draw()
  box.value?.focus()
}
const setMode = (on: boolean) => setOption(() => (classic.value = on))
const setObstacles = (on: boolean) => setOption(() => (obstacles.value = on))

let cols = 0
let rows = 0
let snake: Pt[] = []
let dir: Pt = { x: 1, y: 0 }
/** Turns pressed since the last step, so two quick presses (up, then left) both count. */
let turns: Pt[] = []
let food: Pt = { x: 0, y: 0 }
/** Merge conflicts on the board. */
let blocks: Pt[] = []
/** A gold hotfix commit, worth five, until `goldUntil`. */
let gold: Pt | null = null
let goldUntil = 0
const GOLD_MS = 5000
/** Commits picked up this game, which is what brings more conflicts (the score counts boosts and gold too). */
let eaten = 0
/** Shift held: twice as fast, and twice the points. */
const boosting = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | null = null

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function size() {
  const el = box.value
  const c = canvas.value
  if (!el || !c) return
  const dpr = window.devicePixelRatio || 1
  cols = Math.max(8, Math.floor(el.clientWidth / CELL))
  rows = Math.max(6, Math.floor(el.clientHeight / CELL))
  c.width = cols * CELL * dpr
  c.height = rows * CELL * dpr
  c.style.width = `${cols * CELL}px`
  c.style.height = `${rows * CELL}px`
  c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
  // Anything now outside the board comes back in.
  snake = snake.map((p) => ({ x: Math.min(p.x, cols - 1), y: Math.min(p.y, rows - 1) }))
  if (food.x >= cols || food.y >= rows) placeFood()
  blocks = blocks.filter((b) => b.x < cols && b.y < rows)
  if (gold && (gold.x >= cols || gold.y >= rows)) gold = null
  draw()
}

const at = (list: Pt[], p: Pt) => list.some((q) => q.x === p.x && q.y === p.y)

/** A free square: not the branch, a conflict, or a commit; and at least `clear` squares from the head. */
function freeSpot(clear = 0): Pt | null {
  const head = snake[0]
  for (let tries = 0; tries < 500; tries++) {
    const p = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }
    if (at(snake, p) || at(blocks, p) || (food && at([food], p)) || (gold && at([gold], p))) continue
    if (head && Math.abs(p.x - head.x) + Math.abs(p.y - head.y) < clear) continue
    return p
  }
  return null
}

function placeFood() {
  food = freeSpot() ?? food
}

function reset() {
  const y = Math.floor(rows / 2)
  const x = Math.floor(cols / 3)
  snake = [2, 1, 0].map((i) => ({ x: x + i, y }))
  dir = { x: 1, y: 0 }
  turns = []
  score.value = 0
  eaten = 0
  blocks = []
  gold = null
  placeFood()
}

/** Starts slow and speeds up with each commit, down to a limit. */
const SPEEDS = { slow: { start: 180, fastest: 70 }, normal: { start: 130, fastest: 55 }, fast: { start: 90, fastest: 45 } } as const
const speed = prefs.gameSpeed
const delay = () => {
  const d = Math.max(SPEEDS[speed.value].fastest, SPEEDS[speed.value].start - eaten * 3)
  return boosting.value ? Math.max(25, Math.round(d / 2)) : d
}

function setSpeed(s: keyof typeof SPEEDS) {
  speed.value = s
  box.value?.focus()
}

function step() {
  const turn = turns.shift()
  if (turn) dir = turn
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
  if (classic.value) {
    if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) return over('wall')
  } else {
    head.x = (head.x + cols) % cols
    head.y = (head.y + rows) % rows
  }
  if (at(blocks, head)) return over('conflict')
  if (gold && Date.now() > goldUntil) gold = null
  const eats = head.x === food.x && head.y === food.y
  const golden = !!gold && head.x === gold.x && head.y === gold.y
  const body = eats || golden ? snake : snake.slice(0, -1)
  if (at(body, head)) return over('self')
  snake = [head, ...body]
  const points = (n: number) => n * (boosting.value ? 2 : 1)
  if (golden) {
    score.value += points(5)
    gold = null
  }
  if (eats) {
    score.value += points(1)
    eaten++
    placeFood()
    // Every five commits, another conflict; now and then, a hotfix to chase.
    if (obstacles.value && eaten % 5 === 0) {
      const b = freeSpot(5)
      if (b) blocks = [...blocks, b]
    }
    if (!gold && Math.random() < 0.18) {
      gold = freeSpot(4)
      goldUntil = Date.now() + GOLD_MS
    }
  }
  draw()
  timer = setTimeout(step, delay())
}

function over(why: 'self' | 'wall' | 'conflict') {
  state.value = 'over'
  crash.value = why
  if (score.value > best.value) best.value = score.value
  draw()
}

/** The gold hotfix's time left while paused, so a pause doesn't let it run out. */
let goldLeft = 0

function play() {
  if (state.value === 'over' || state.value === 'ready') reset()
  else if (gold) goldUntil = Date.now() + goldLeft
  state.value = 'playing'
  clearTimeout(timer)
  timer = setTimeout(step, delay())
  box.value?.focus()
}

function pause() {
  if (state.value !== 'playing') return
  state.value = 'paused'
  clearTimeout(timer)
  goldLeft = Math.max(0, goldUntil - Date.now())
}

function draw() {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const w = cols * CELL
  const h = rows * CELL
  ctx.clearRect(0, 0, w, h)
  // In classic mode the edges are walls, so they're drawn.
  if (classic.value) {
    ctx.strokeStyle = css('--border-strong')
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, w - 2, h - 2)
  }
  // A faint dot grid, like graph paper.
  ctx.fillStyle = css('--border')
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) ctx.fillRect(x * CELL + CELL / 2 - 0.5, y * CELL + CELL / 2 - 0.5, 1, 1)

  const mid = (p: Pt) => [p.x * CELL + CELL / 2, p.y * CELL + CELL / 2] as const
  const accent = css('--accent')
  // The branch: a line through the segments, broken where it wraps round an edge.
  ctx.strokeStyle = accent
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  snake.forEach((p, i) => {
    const [x, y] = mid(p)
    const prev = snake[i - 1]
    if (i === 0 || Math.abs(prev.x - p.x) + Math.abs(prev.y - p.y) > 1) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  // A commit node every other segment, and the head as the tip.
  snake.forEach((p, i) => {
    if (i % 2 && i !== snake.length - 1) return
    const [x, y] = mid(p)
    ctx.beginPath()
    ctx.arc(x, y, i === 0 ? 5.5 : 4, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? accent : css('--bg')
    ctx.fill()
    ctx.lineWidth = 2
    ctx.stroke()
  })
  // The commit to pick up: a tag-coloured ring.
  const [fx, fy] = mid(food)
  ctx.beginPath()
  ctx.arc(fx, fy, 5, 0, Math.PI * 2)
  ctx.strokeStyle = css('--tag')
  ctx.lineWidth = 2.5
  ctx.stroke()
  // Merge conflicts: red crosses in a square.
  const red = css('--del')
  for (const b of blocks) {
    const x = b.x * CELL
    const y = b.y * CELL
    ctx.globalAlpha = 0.22
    ctx.fillStyle = red
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2)
    ctx.globalAlpha = 1
    ctx.strokeStyle = red
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x + 4, y + 4)
    ctx.lineTo(x + CELL - 4, y + CELL - 4)
    ctx.moveTo(x + CELL - 4, y + 4)
    ctx.lineTo(x + 4, y + CELL - 4)
    ctx.stroke()
  }
  // The gold hotfix: a filled commit with a ring that runs down as its time does.
  if (gold) {
    const [gx, gy] = mid(gold)
    const left = Math.max(0, (goldUntil - Date.now()) / GOLD_MS)
    ctx.fillStyle = css('--tag')
    ctx.beginPath()
    ctx.arc(gx, gy, 5.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = css('--tag')
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(gx, gy, 8.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left)
    ctx.stroke()
  }
}

const KEYS: Record<string, Pt> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
}

function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Shift') return void (boosting.value = true)
  const turn = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
  if (turn) {
    if (state.value !== 'playing') play()
    // Never straight back on itself, measured from the last turn queued.
    const last = turns.at(-1) ?? dir
    if (turn.x !== -last.x || turn.y !== -last.y) {
      if (turn.x !== last.x || turn.y !== last.y) turns = [...turns, turn].slice(-2)
    }
  } else if (e.key === ' ' || e.key === 'Enter') {
    if (state.value === 'playing') pause()
    else play()
  } else if (e.key === 'Escape') {
    emit('close')
  } else {
    return
  }
  e.preventDefault()
  e.stopPropagation()
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Shift') boosting.value = false
}

const onBlur = () => {
  boosting.value = false
  pause()
}

/**
 * The score card fades away while you play, since it can sit over the board, and comes back when you pause, when the
 * game ends, or for a couple of seconds after the mouse moves.
 */
const stirred = ref(false)
let stirTimer: ReturnType<typeof setTimeout> | undefined
function stir() {
  stirred.value = true
  clearTimeout(stirTimer)
  stirTimer = setTimeout(() => (stirred.value = false), 2000)
}
const hudShown = computed(() => state.value !== 'playing' || stirred.value)

onMounted(() => {
  size()
  reset()
  draw()
  observer = new ResizeObserver(size)
  observer.observe(box.value!)
  window.addEventListener('blur', onBlur)
  box.value?.focus()
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(stirTimer)
  observer?.disconnect()
  window.removeEventListener('blur', onBlur)
})
</script>

<template>
  <div ref="box" class="game" tabindex="0" aria-label="Commit Snake" @keydown="onKey" @keyup="onKeyUp" @mousedown="box?.focus()" @mousemove="stir">
    <canvas ref="canvas" />
    <div class="hud" :class="{ hidden: !hudShown }">
      <div class="stat">
        <strong>{{ score }}</strong>
        <span>{{ boosting && state === 'playing' ? 'boost ×2' : score === 1 ? 'point' : 'points' }}</span>
      </div>
      <div class="divider" />
      <div class="stat" :title="`Best with ${setupName}`">
        <strong :class="{ record: score > 0 && score >= best }">{{ Math.max(best, score) }}</strong>
        <span>best · {{ setupName }}</span>
      </div>
      <button class="close" title="Stop playing (Esc)" @click="emit('close')"><Icon name="x" :size="12" /></button>
    </div>
    <div v-if="state !== 'playing'" class="message" @click="play">
      <strong>{{
        state === 'over'
          ? `${crash === 'wall' ? 'Hit the wall!' : crash === 'conflict' ? 'Merge conflict!' : 'Tangled in your own branch!'} ${score} points`
          : state === 'paused'
            ? 'Paused'
            : 'Commit Snake'
      }}</strong>
      <span>{{ state === 'paused' ? 'Space to carry on' : 'Arrows or WASD to steer · hold Shift to boost (double points) · Space to pause' }}</span>
      <div v-if="state !== 'paused'" class="modes" @click.stop>
        <button :class="{ on: !classic }" title="Go off one edge, come back at the other" @click="setMode(false)">Wrap edges</button>
        <button :class="{ on: classic }" title="The edges are walls" @click="setMode(true)">Classic</button>
      </div>
      <div v-if="state !== 'paused'" class="modes" @click.stop>
        <button :class="{ on: !obstacles }" @click="setObstacles(false)">No conflicts</button>
        <button :class="{ on: obstacles }" title="A block appears every five commits; hit one and it's over" @click="setObstacles(true)">
          Conflicts
        </button>
      </div>
      <div v-if="state !== 'paused'" class="modes" @click.stop>
        <button v-for="s in ['slow', 'normal', 'fast'] as const" :key="s" :class="{ on: speed === s }" @click="setSpeed(s)">
          {{ s[0].toUpperCase() + s.slice(1) }}
        </button>
      </div>
      <button class="primary">{{ state === 'over' ? 'Again' : state === 'paused' ? 'Carry on' : 'Play' }}</button>
    </div>
  </div>
</template>

<style scoped>
.game {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  outline: none;
}
canvas {
  display: block;
}
/* The score card in the corner: the count, the best for this mode, and a close button. */
.hud {
  transition: opacity 0.3s;
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--popover) 85%, transparent);
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.1;
}
.stat strong {
  color: var(--fg);
  font: 600 16px var(--mono);
  font-variant-numeric: tabular-nums;
}
.stat strong.record {
  color: var(--accent);
}
.stat span {
  color: var(--fg-faint);
  font-size: 10.5px;
}
.divider {
  align-self: stretch;
  width: 1px;
  background: var(--border);
}
.close {
  display: grid;
  width: 26px;
  height: 26px;
  margin-left: 2px;
  padding: 0;
  place-items: center;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--fg-faint);
}
.close:hover {
  background: var(--hover);
  color: var(--fg);
}
.message {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 22px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--popover);
  box-shadow: var(--shadow);
  text-align: center;
  cursor: default;
}
.message strong {
  font-size: 14px;
}
.message span {
  color: var(--fg-muted);
  font-size: 12px;
}
.message > button {
  margin-top: 6px;
}
.modes {
  display: flex;
  margin-top: 4px;
  padding: 2px;
  border-radius: 8px;
  background: var(--pill);
}
.modes button {
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.modes button.on {
  background: var(--popover);
  color: var(--fg);
  box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
}
.hud.hidden {
  opacity: 0;
  pointer-events: none;
}
</style>
