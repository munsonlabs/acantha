import { computed, ref, shallowRef, watch } from 'vue'
import { filterPathspecs, parseFileFilter } from '@/lib/fileFilter'
import { git, type SearchResults } from '@/lib/git'
import { prefs } from './prefs'
import type { Repo } from './repo'
import { confirmAction } from './useDialog'
import { showToast } from './useToast'

export type PreviewView = 'preview' | 'blame' | 'history' | 'edit'

/** A file in the open-files list: a path, in the working tree (rev null) or at a commit. */
export interface OpenFile {
  path: string
  rev: string | null
}

/** The file browser: the repository's files at a commit (or in the working tree), and the file being previewed. */
export function createFiles({ repo }: Repo) {
  /** null is the working tree. */
  const rev = ref<string | null>(null)
  const list = shallowRef<string[]>([])
  /** Folders git can't list through their files (new or empty), for the working tree. */
  const folders = shallowRef<string[]>([])
  const loading = ref(false)
  const filter = ref('')
  const expanded = ref(new Set<string>())
  /** Folders made from the browser: git doesn't list folders with nothing in them, so these show until they fill. */
  const newFolders = ref(new Set<string>())
  /** Bumped when files in the working tree change outside the app, so an open file can catch up. */
  const diskChanged = ref(0)
  /** line: a line to scroll to and mark, from a search result. */
  const preview = shallowRef<{ path: string; rev: string | null; view: PreviewView; line?: number } | null>(null)
  /** Whether the file in the editor has unsaved changes. */
  const dirty = ref(false)

  const sameFile = (a: OpenFile, b: OpenFile) => a.path === b.path && a.rev === b.rev

  /**
   * The open tabs, in the order you opened them: kept until you close them. Just glancing at a file — clicking it in
   * the sidebar, a search result, a diff, a definition — doesn't add one of these; it shows in `previewFile` instead,
   * one at a time, replaced by the next glance. A file becomes a tab of its own once you edit it, or deliberately keep
   * it open (double-click, or its "Keep Open"): the same split a real editor's "preview tab" makes, so a quick look
   * through ten files doesn't leave ten tabs behind.
   */
  const openFiles = ref<OpenFile[]>([])
  /** The one file being glanced at, if any: shown like a tab, but not yet one of them. */
  const previewFile = ref<OpenFile | null>(null)
  const isPinned = (file: OpenFile) => openFiles.value.some((f) => sameFile(f, file))

  /** Makes a file one of the open tabs, staying there until it's closed. */
  function pin(file: OpenFile) {
    if (!isPinned(file)) openFiles.value = [...openFiles.value, file].slice(-40)
    if (previewFile.value && sameFile(previewFile.value, file)) previewFile.value = null
  }

  /** The tabs as shown: the open ones, then the glanced-at file, if there is one and it isn't one of them already. */
  function tabsList(): OpenFile[] {
    return previewFile.value && !isPinned(previewFile.value) ? [...openFiles.value, previewFile.value] : openFiles.value
  }
  const tabs = computed(tabsList)

  /**
   * Unsaved edits per working-tree file: the editor's text, and the file as it was when the editing started. They're
   * kept while you switch between files and come back with them; saving or discarding clears them. Editing a file
   * that's only being glanced at pins it — you're clearly not just passing through.
   */
  const drafts = shallowRef(new Map<string, { text: string; base: string }>())
  function setDraft(path: string, draft: { text: string; base: string } | null) {
    if (!draft && !drafts.value.has(path)) return
    const next = new Map(drafts.value)
    if (draft) {
      next.set(path, draft)
      if (previewFile.value?.path === path) pin(previewFile.value)
    } else next.delete(path)
    drafts.value = next
  }
  let seq = 0

  async function load() {
    if (!repo.value) return
    const id = ++seq
    loading.value = true
    try {
      const [files, dirs] = await Promise.all([
        git.listFiles(repo.value, rev.value),
        rev.value === null ? git.listNewFolders(repo.value).catch(() => []) : [],
      ])
      if (id === seq) {
        list.value = files
        folders.value = dirs
      }
    } catch (e) {
      if (id === seq) showToast(String(e), 'error')
    } finally {
      if (id === seq) loading.value = false
    }
  }

  function browse(at: string | null) {
    rev.value = at
    expanded.value = new Set()
    filter.value = ''
    void load()
  }

  function toggle(dir: string) {
    const next = new Set(expanded.value)
    if (!next.delete(dir)) next.add(dir)
    expanded.value = next
  }

  /**
   * Asks before throwing away the unsaved edits in `paths` (all files when omitted). Resolves true when it's fine to
   * go ahead, with those drafts dropped.
   */
  async function discardDrafts(paths?: string[]) {
    const lost = [...drafts.value.keys()].filter((p) => !paths || paths.includes(p))
    if (!lost.length) return true
    const what = lost.length === 1 ? `your changes to \`${lost[0].split('/').pop()}\`` : `your changes to ${lost.length} files`
    if (!(await confirmAction('Unsaved Changes', `Discard ${what}?`, 'Discard', true))) return false
    for (const p of lost) setDraft(p, null)
    if (preview.value && lost.includes(preview.value.path)) dirty.value = false
    return true
  }

  /** How a file opens when no view is asked for: a working-tree file in the editor when that's the setting. */
  const defaultView = (at: string | null): PreviewView => (prefs.editByDefault.value && at === null ? 'edit' : 'preview')

  /**
   * Opens a file: in the working tree, or `at` a commit. By itself this is just a glance — it replaces whatever was
   * only being glanced at before, without adding a tab — unless `opts.pin` says it's deliberate (or the file is
   * already a tab, which keeps it one).
   */
  async function open(path: string, view?: PreviewView, at: string | null = rev.value, line?: number, opts?: { pin?: boolean }) {
    view ??= defaultView(at)
    const file: OpenFile = { path, rev: at }
    // Unsaved edits stay behind as a draft, so switching never asks.
    preview.value = { path, rev: at, view, line }
    if (opts?.pin) pin(file)
    else if (!isPinned(file)) previewFile.value = file
  }

  /**
   * Closes several tabs at once (the glanced-at file among them, if it's one of `files`), asking once for any of their
   * unsaved edits. Closing the one on screen shows the tab next to it, or the graph once none are left.
   */
  async function closeMany(files: OpenFile[]) {
    const dirtyPaths = files.filter((f) => f.rev === null && drafts.value.has(f.path)).map((f) => f.path)
    if (dirtyPaths.length && !(await discardDrafts(dirtyPaths))) return
    const before = tabsList()
    const p = preview.value
    const showingClosed = !!p && files.some((f) => sameFile(p, f))
    const at = showingClosed ? before.findIndex((f) => sameFile(p!, f)) : -1
    openFiles.value = openFiles.value.filter((f) => !files.some((x) => sameFile(x, f)))
    if (previewFile.value && files.some((x) => sameFile(x, previewFile.value!))) previewFile.value = null
    if (showingClosed) {
      const rest = tabsList()
      const next = rest[Math.min(Math.max(at, 0), rest.length - 1)]
      preview.value = next ? { path: next.path, rev: next.rev, view: defaultView(next.rev) } : null
    }
  }
  const closeFile = (file: OpenFile) => closeMany([file])
  /** Closes the file on screen: the tab next to it shows, or the graph when it was the last. */
  const closePreview = () => (preview.value ? closeMany([{ path: preview.value.path, rev: preview.value.rev }]) : Promise.resolve())
  /** Closes every tab but `keep`. */
  const closeOthers = (keep: OpenFile) => closeMany(tabsList().filter((f) => !sameFile(f, keep)))
  /** Closes every tab without unsaved edits. */
  const closeSaved = () => closeMany(tabsList().filter((f) => f.rev !== null || !drafts.value.has(f.path)))
  /** Closes every open tab. */
  const closeAllTabs = () => closeMany(tabsList())

  /** Keeps the list right when files are renamed, moved or trashed from the sidebar. */
  const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)
  function renameOpen(from: string, to: string) {
    const moved = (f: OpenFile): OpenFile => (f.rev === null && inside(f.path, from) ? { ...f, path: to + f.path.slice(from.length) } : f)
    openFiles.value = openFiles.value.map(moved)
    if (previewFile.value) previewFile.value = moved(previewFile.value)
    // Drafts move with their files.
    const next = new Map<string, { text: string; base: string }>()
    for (const [p, d] of drafts.value) next.set(inside(p, from) ? to + p.slice(from.length) : p, d)
    drafts.value = next
  }
  function forgetOpen(dir: string) {
    openFiles.value = openFiles.value.filter((f) => !(f.rev === null && inside(f.path, dir)))
    if (previewFile.value?.rev === null && inside(previewFile.value.path, dir)) previewFile.value = null
    drafts.value = new Map([...drafts.value].filter(([p]) => !inside(p, dir)))
  }

  /** Asked (from a diff, the editor, a tab) to show a path in the sidebar's file browser, expanded and scrolled to. */
  const revealTarget = shallowRef<{ path: string } | null>(null)
  const revealInSidebar = (path: string) => (revealTarget.value = { path })

  /** Searching the files' contents (and names), at the same commit as the browser. */
  const search = {
    query: ref(''),
    /** What to look through: names and contents, or just one of them. */
    scope: ref<'all' | 'names' | 'contents'>('all'),
    /** Which files, as typed in the "files to include" box (see `parseFileFilter`). */
    include: ref(''),
    regex: ref(false),
    caseSensitive: ref(false),
    results: shallowRef<SearchResults | null>(null),
    searching: ref(false),
    error: ref<string | null>(null),
  }
  let searchSeq = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  async function runSearch() {
    const q = search.query.value
    const id = ++searchSeq
    if (!repo.value || q.trim().length < 2 || search.scope.value === 'names') {
      search.results.value = null
      search.searching.value = false
      search.error.value = null
      return
    }
    search.searching.value = true
    try {
      const paths = filterPathspecs(parseFileFilter(search.include.value))
      const found = await git.searchFiles(repo.value, rev.value, q, search.regex.value, search.caseSensitive.value, paths)
      if (id !== searchSeq) return
      search.results.value = found
      search.error.value = null
    } catch (e) {
      if (id !== searchSeq) return
      search.results.value = null
      // git grep's complaint about a bad pattern is the useful part.
      search.error.value = String(e).replace(/^fatal: /, '')
    } finally {
      if (id === searchSeq) search.searching.value = false
    }
  }

  watch([search.query, search.scope, search.include, search.regex, search.caseSensitive, rev], () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(runSearch, 250)
  })

  watch(repo, () => {
    rev.value = null
    list.value = []
    preview.value = null
    openFiles.value = []
    previewFile.value = null
    drafts.value = new Map()
    dirty.value = false
    expanded.value = new Set()
    newFolders.value = new Set()
  })

  return {
    rev,
    list,
    folders,
    diskChanged,
    loading,
    filter,
    expanded,
    newFolders,
    preview,
    openFiles,
    previewFile,
    tabs,
    isPinned,
    pin,
    dirty,
    drafts,
    setDraft,
    search,
    load,
    browse,
    toggle,
    open,
    closePreview,
    closeFile,
    closeOthers,
    closeSaved,
    closeAllTabs,
    renameOpen,
    forgetOpen,
    discardDrafts,
    runSearch,
    revealTarget,
    revealInSidebar,
  }
}

export type Files = ReturnType<typeof createFiles>
