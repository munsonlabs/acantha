import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { createFiles } from './files'
import type { Repo } from './repo'

/** A bare-bones repo: just enough for files.ts's own logic, which this test never touches git through. */
function repo(path = '/r') {
  return { repo: ref<string | null>(path) } as unknown as Repo
}

describe('open files: glancing at one versus keeping it open', () => {
  it('shows a glance without adding a tab; the next glance replaces it, not adding one either', () => {
    const files = createFiles(repo())
    void files.open('a.ts')
    expect(files.preview.value).toMatchObject({ path: 'a.ts', rev: null })
    expect(files.openFiles.value).toEqual([])
    expect(files.tabs.value).toEqual([{ path: 'a.ts', rev: null }])

    void files.open('b.ts')
    expect(files.tabs.value).toEqual([{ path: 'b.ts', rev: null }])
    expect(files.isPinned({ path: 'a.ts', rev: null })).toBe(false)
  })

  it('pins a file when asked, or when it already is one, keeping it through the next glance', () => {
    const files = createFiles(repo())
    void files.open('a.ts', undefined, null, undefined, { pin: true })
    expect(files.openFiles.value).toEqual([{ path: 'a.ts', rev: null }])
    expect(files.previewFile.value).toBeNull()

    void files.open('b.ts')
    expect(files.tabs.value).toEqual([
      { path: 'a.ts', rev: null },
      { path: 'b.ts', rev: null },
    ])

    // Showing a already-pinned file again doesn't disturb the glance at b.
    void files.open('a.ts')
    expect(files.preview.value).toMatchObject({ path: 'a.ts' })
    expect(files.tabs.value).toEqual([
      { path: 'a.ts', rev: null },
      { path: 'b.ts', rev: null },
    ])
  })

  it('pins a glanced-at file once it has unsaved edits', () => {
    const files = createFiles(repo())
    void files.open('a.ts')
    files.setDraft('a.ts', { text: 'x', base: '' })
    expect(files.isPinned({ path: 'a.ts', rev: null })).toBe(true)
    expect(files.previewFile.value).toBeNull()
  })
})

describe('closing tabs', () => {
  it('shows the tab that was beside the one closed, or the graph once none are left', async () => {
    const files = createFiles(repo())
    for (const p of ['a.ts', 'b.ts', 'c.ts']) void files.open(p, undefined, null, undefined, { pin: true })
    void files.open('b.ts')
    await files.closeFile({ path: 'b.ts', rev: null })
    // b was in the middle: whatever's now in its place shows.
    expect(files.preview.value?.path).toBe('c.ts')
    expect(files.openFiles.value.map((f) => f.path)).toEqual(['a.ts', 'c.ts'])

    await files.closeFile({ path: 'c.ts', rev: null })
    expect(files.preview.value?.path).toBe('a.ts')
    await files.closeFile({ path: 'a.ts', rev: null })
    expect(files.preview.value).toBeNull()
  })

  it('closes others, saved ones, or everything, in one go', async () => {
    const files = createFiles(repo())
    for (const p of ['a.ts', 'b.ts', 'c.ts']) void files.open(p, undefined, null, undefined, { pin: true })
    files.setDraft('b.ts', { text: 'x', base: '' })

    await files.closeOthers({ path: 'b.ts', rev: null })
    expect(files.openFiles.value.map((f) => f.path)).toEqual(['b.ts'])

    void files.open('a.ts', undefined, null, undefined, { pin: true })
    await files.closeSaved()
    // a has no draft and goes; b (the dirty one) stays.
    expect(files.openFiles.value.map((f) => f.path)).toEqual(['b.ts'])

    // Its draft would otherwise ask before closing it too.
    files.setDraft('b.ts', null)
    await files.closeAllTabs()
    expect(files.tabs.value).toEqual([])
    expect(files.preview.value).toBeNull()
  })
})
