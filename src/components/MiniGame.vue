<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { prefs } from '@/composables/prefs'

/**
 * Commit Snake, for where the graph was while it's collapsed: steer a branch round the space and pick up commits, each
 * one a new node on it. Arrow keys or WASD, Space to pause, Esc to stop. Loaded only when someone presses Play.
 */
const emit = defineEmits<{ close: [] }>()

const CELL = 16
type Pt = { x: number; y: number }

const box = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const score = ref(0)
const state = ref<'ready' | 'playing' | 'paused' | 'over'>('ready')

let cols = 0
let rows = 0
let snake: Pt[] = []
let dir: Pt = { x: 1, y: 0 }
/** Turns pressed since the last step, so two quick presses (up, then left) both count. */
let turns: Pt[] = []
let food: Pt = { x: 0, y: 0 }
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
  draw()
}

function placeFood() {
  const taken = new Set(snake.map((p) => `${p.x},${p.y}`))
  if (taken.size >= cols * rows) return
  do food = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }
  while (taken.has(`${food.x},${food.y}`))
}

function reset() {
  const y = Math.floor(rows / 2)
  const x = Math.floor(cols / 3)
  snake = [2, 1, 0].map((i) => ({ x: x + i, y }))
  dir = { x: 1, y: 0 }
  turns = []
  score.value = 0
  placeFood()
}

/** Starts slow and speeds up with each commit, down to a limit. */
const delay = () => Math.max(55, 130 - score.value * 3)

function step() {
  const turn = turns.shift()
  if (turn) dir = turn
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
  // The edges wrap round, so only running into the branch itself ends it.
  head.x = (head.x + cols) % cols
  head.y = (head.y + rows) % rows
  const eats = head.x === food.x && head.y === food.y
  const body = eats ? snake : snake.slice(0, -1)
  if (body.some((p) => p.x === head.x && p.y === head.y)) return over()
  snake = [head, ...body]
  if (eats) {
    score.value++
    placeFood()
  }
  draw()
  timer = setTimeout(step, delay())
}

function over() {
  state.value = 'over'
  if (score.value > prefs.gameBest.value) prefs.gameBest.value = score.value
  draw()
}

function play() {
  if (state.value === 'over' || state.value === 'ready') reset()
  state.value = 'playing'
  clearTimeout(timer)
  timer = setTimeout(step, delay())
  box.value?.focus()
}

function pause() {
  if (state.value !== 'playing') return
  state.value = 'paused'
  clearTimeout(timer)
}

function draw() {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const w = cols * CELL
  const h = rows * CELL
  ctx.clearRect(0, 0, w, h)
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

const onBlur = () => pause()

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
  observer?.disconnect()
  window.removeEventListener('blur', onBlur)
})
</script>

<template>
  <div ref="box" class="game" tabindex="0" aria-label="Commit Snake" @keydown="onKey" @mousedown="box?.focus()">
    <canvas ref="canvas" />
    <div class="hud">
      <span>{{ score }} {{ score === 1 ? 'commit' : 'commits' }}</span>
      <span class="best">best {{ Math.max(prefs.gameBest.value, score) }}</span>
      <button class="ghost" title="Stop playing (Esc)" @click="emit('close')">Done</button>
    </div>
    <div v-if="state !== 'playing'" class="message" @click="play">
      <strong>{{ state === 'over' ? `Merge conflict! ${score} commits` : state === 'paused' ? 'Paused' : 'Commit Snake' }}</strong>
      <span>{{ state === 'paused' ? 'Space to carry on' : 'Arrow keys or WASD to steer · Space to pause · Esc to stop' }}</span>
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
.hud {
  position: absolute;
  top: 10px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg-muted);
  font: 500 12px var(--font);
}
.hud .best {
  color: var(--fg-faint);
}
.hud button {
  height: 24px;
  padding: 0 10px;
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
.message button {
  margin-top: 6px;
}
</style>
