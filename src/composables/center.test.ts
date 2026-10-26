import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { graphShowing, overGraph, pushFront, toggleGraph } from './center'
import { prefs } from './prefs'
import type { Workspace } from './workspace'

/** Just what deciding the graph's place looks at. A file isn't here: it has its own place now, never swapping with it. */
function workspace() {
  return {
    ui: { review: ref<string | null>(null), stack: ref<('review' | 'agents' | 'panel' | 'graph')[]>([]) },
    agents: { expanded: ref(false), tabs: ref<{ id: string }[]>([]) },
    panel: { expanded: ref(false), tabs: ref<object[]>([]) },
  }
}

describe('the graph and what goes over it', () => {
  it('brings the graph in front of the panel, then collapses it, the panel staying open behind', () => {
    prefs.graphCollapsed.value = false
    const w = workspace()
    const ws = w as unknown as Workspace
    w.panel.expanded.value = true
    w.panel.tabs.value = [{}]
    w.ui.stack.value = ['panel']
    expect(overGraph(ws)).toBe('panel')
    expect(graphShowing(ws)).toBe(false)

    toggleGraph(ws)
    expect(overGraph(ws)).toBeNull()
    expect(graphShowing(ws)).toBe(true)
    expect(w.panel.expanded.value).toBe(true)

    // Collapsed: the panel it was brought over shows again.
    toggleGraph(ws)
    expect(prefs.graphCollapsed.value).toBe(true)
    expect(overGraph(ws)).toBe('panel')
    // Shown again: back to the front.
    toggleGraph(ws)
    expect(graphShowing(ws)).toBe(true)
    // The panel closed and the graph collapsed: nothing's open, so the stamp.
    w.panel.expanded.value = false
    toggleGraph(ws)
    expect(overGraph(ws)).toBeNull()
    expect(graphShowing(ws)).toBe(false)
  })

  it('shows what was brought last, and what is still open behind when it closes', () => {
    const w = workspace()
    const ws = w as unknown as Workspace
    w.ui.review.value = 'r1'
    w.agents.tabs.value = [{ id: 'r1' }]
    w.panel.expanded.value = true
    w.panel.tabs.value = [{}]
    w.ui.stack.value = ['review', 'panel']
    expect(overGraph(ws)).toBe('panel')
    w.panel.expanded.value = false
    expect(overGraph(ws)).toBe('review')
  })
})

describe('pushFront', () => {
  it('brings an already-open thing back in front, even though its own state never changed', () => {
    const w = workspace()
    const ws = w as unknown as Workspace
    w.agents.expanded.value = true
    w.agents.tabs.value = [{ id: 'a1' }]
    w.ui.stack.value = ['agents']
    expect(overGraph(ws)).toBe('agents')

    // The panel opens over it: agents are still expanded (nothing about them changed), but the panel's now in front.
    w.panel.expanded.value = true
    w.panel.tabs.value = [{}]
    w.ui.stack.value = ['agents', 'panel']
    expect(overGraph(ws)).toBe('panel')

    // Asking for the agents again (as showing one now does) brings them forward, with no change to `expanded` at all.
    pushFront(w.ui.stack, 'agents')
    expect(overGraph(ws)).toBe('agents')
    expect(w.agents.expanded.value).toBe(true)
  })
})
