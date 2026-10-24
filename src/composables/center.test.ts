import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { graphShowing, overGraph, toggleGraph } from './center'
import { prefs } from './prefs'
import type { Workspace } from './workspace'

/** Just what deciding the graph's place looks at. */
function workspace() {
  return {
    files: { preview: ref<object | null>(null) },
    ui: { review: ref<string | null>(null), stack: ref<('file' | 'review' | 'agents' | 'panel' | 'graph')[]>([]) },
    agents: { expanded: ref(false), tabs: ref<{ id: string }[]>([]) },
    panel: { expanded: ref(false), tabs: ref<object[]>([]) },
  }
}

describe('the graph and what goes over it', () => {
  it('brings the graph in front of an open file, then collapses it, the file staying open behind', () => {
    prefs.graphCollapsed.value = false
    const w = workspace()
    const ws = w as unknown as Workspace
    w.files.preview.value = { path: 'a.ts' }
    w.ui.stack.value = ['file']
    expect(overGraph(ws)).toBe('file')
    expect(graphShowing(ws)).toBe(false)

    toggleGraph(ws)
    expect(overGraph(ws)).toBeNull()
    expect(graphShowing(ws)).toBe(true)
    expect(w.files.preview.value).not.toBeNull()

    // Collapsed: the file it was brought over shows again.
    toggleGraph(ws)
    expect(prefs.graphCollapsed.value).toBe(true)
    expect(overGraph(ws)).toBe('file')
    // Shown again: back to the front.
    toggleGraph(ws)
    expect(graphShowing(ws)).toBe(true)
    // The file closed and the graph collapsed: nothing's open, so the stamp.
    w.files.preview.value = null
    toggleGraph(ws)
    expect(overGraph(ws)).toBeNull()
    expect(graphShowing(ws)).toBe(false)
  })

  it('shows what was brought last, and what is still open behind when it closes', () => {
    const w = workspace()
    const ws = w as unknown as Workspace
    w.files.preview.value = { path: 'a.ts' }
    w.panel.expanded.value = true
    w.panel.tabs.value = [{}]
    w.ui.stack.value = ['file', 'panel']
    expect(overGraph(ws)).toBe('panel')
    w.panel.expanded.value = false
    expect(overGraph(ws)).toBe('file')
  })
})
