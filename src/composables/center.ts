import type { Ref } from 'vue'
import { isOn } from '@/features'
import { prefs } from './prefs'
import type { Workspace } from './workspace'

/**
 * What shows in the graph's place, as a stack: a worktree agent's work under review, the agents expanded, the panel
 * expanded, or the graph itself. Each is put on top when it's brought there; what shows is the topmost one that's
 * still open, so closing one (or collapsing the graph) shows the one beneath. With none open, the graph's place is
 * empty: the stamp. A file no longer takes a turn here - it has its own place below the graph, always there, the two
 * never swapping.
 */
export type Over = 'review' | 'agents' | 'panel'
export type Place = Over | 'graph'
/** The stack itself (`ui.stack`): what's been brought to the graph's place, latest last. */
export type Stack = Ref<Place[]>

/** What could be over the graph now. */
export function whatsOpen(ws: Workspace): Record<Over, boolean> {
  return {
    review: !!ws.ui.review.value && ws.agents.tabs.value.some((t) => t.id === ws.ui.review.value),
    agents: isOn('claude') && prefs.agentsOpen.value && ws.agents.expanded.value && ws.agents.tabs.value.length > 0,
    panel: ws.panel.expanded.value && ws.panel.tabs.value.length > 0,
  }
}

/**
 * Puts something on top of the stack: a stack ref directly (for a composable, like agents.ts, that doesn't have the
 * whole workspace to hand), or a workspace, for everywhere else.
 */
export function pushFront(stack: Stack, what: Place) {
  if (stack.value.at(-1) !== what) stack.value = [...stack.value.filter((s) => s !== what), what]
}
export const bringToFront = (ws: Workspace, what: Place) => pushFront(ws.ui.stack, what)

/** What's over the graph, in front: null when the graph is (or nothing's open and it's collapsed). */
export function overGraph(ws: Workspace): Over | null {
  const open = whatsOpen(ws)
  const isOpen = (p: Place) => (p === 'graph' ? !prefs.graphCollapsed.value : open[p])
  for (const p of [...ws.ui.stack.value].reverse()) if (isOpen(p)) return p === 'graph' ? null : p
  // Open without having been brought (as it was when Acantha started): in a fixed order.
  return (['review', 'agents', 'panel'] as const).find((k) => open[k]) ?? null
}

/** The graph's what you're looking at: shown, and nothing in front of it. */
export const graphShowing = (ws: Workspace) => !prefs.graphCollapsed.value && overGraph(ws) === null

/** Brings the graph to the front, out of its collapse; what was over it stays open, beneath. */
export function showGraph(ws: Workspace) {
  prefs.graphCollapsed.value = false
  bringToFront(ws, 'graph')
}

/** The Graph button: brings the graph to the front, or, when it already is, collapses it, showing what's beneath. */
export function toggleGraph(ws: Workspace) {
  if (graphShowing(ws)) prefs.graphCollapsed.value = true
  else showGraph(ws)
}

/** Puts away what's in front over the graph: a review, the agents or the panel. True when something was. */
export function putAwayFront(ws: Workspace): boolean {
  const front = overGraph(ws)
  if (front === 'agents') ws.agents.expanded.value = false
  else if (front === 'panel') ws.panel.expanded.value = false
  else if (front === 'review') ws.ui.review.value = null
  else return false
  return true
}
