import { ref, shallowRef, watch } from 'vue'
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
  /** Set while the editor has unsaved changes, so nothing navigates away from them silently. */
  const dirty = ref(false)
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

  /** Asks before throwing away unsaved edits. Resolves true when it is fine to move on. */
  async function leaveEditor() {
    if (!dirty.value) return true
    const name = preview.value?.path.split('/').pop()
    if (!(await confirmAction('Unsaved Changes', `Discard your changes to \`${name}\`?`, 'Discard', true))) return false
    dirty.value = false
    return true
  }

  /** How a file opens when no view is asked for: a working-tree file in the editor when that's the setting. */
  const defaultView = (at: string | null): PreviewView => (prefs.editByDefault.value && at === null ? 'edit' : 'preview')

  /**
   * The files open in this repository, in the order they were opened (⌘E lists them). Opening a file adds it;
   * closing it (its ✕ there, or closing the preview) takes it out. The editor holds one at a time.
   */
  const openFiles = ref<OpenFile[]>([])
  const sameFile = (a: OpenFile, b: OpenFile) => a.path === b.path && a.rev === b.rev

  async function open(path: string, view?: PreviewView, at: string | null = rev.value, line?: number) {
    view ??= defaultView(at)
    const p = preview.value
    // Switching between views of the same file keeps the editor's changes only while editing.
    if (p && p.view === 'edit' && !(await leaveEditor())) return
    preview.value = { path, rev: at, view, line }
    if (!openFiles.value.some((f) => sameFile(f, { path, rev: at }))) openFiles.value = [...openFiles.value, { path, rev: at }].slice(-40)
  }

  /** Closes one open file. Closing the one on screen shows the one next to it, or the graph when it was the last. */
  async function closeFile(file: OpenFile) {
    const p = preview.value
    const i = openFiles.value.findIndex((f) => sameFile(f, file))
    const rest = openFiles.value.filter((f) => !sameFile(f, file))
    if (p && sameFile(p, file)) {
      if (p.view === 'edit' && !(await leaveEditor())) return
      const next = rest[Math.min(Math.max(i, 0), rest.length - 1)]
      preview.value = next ? { path: next.path, rev: next.rev, view: defaultView(next.rev) } : null
    }
    openFiles.value = rest
  }

  /** Keeps the list right when files are renamed, moved or trashed from the sidebar. */
  const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)
  function renameOpen(from: string, to: string) {
    openFiles.value = openFiles.value.map((f) => (f.rev === null && inside(f.path, from) ? { ...f, path: to + f.path.slice(from.length) } : f))
  }
  function forgetOpen(dir: string) {
    openFiles.value = openFiles.value.filter((f) => !(f.rev === null && inside(f.path, dir)))
  }

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

  /** Closes the file on screen (and takes it off the open files), back to the graph. */
  async function closePreview() {
    const p = preview.value
    if (p?.view === 'edit' && !(await leaveEditor())) return
    if (p) openFiles.value = openFiles.value.filter((f) => !sameFile(f, p))
    preview.value = null
  }

  watch(repo, () => {
    rev.value = null
    list.value = []
    preview.value = null
    openFiles.value = []
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
    dirty,
    search,
    load,
    browse,
    toggle,
    open,
    closePreview,
    closeFile,
    renameOpen,
    forgetOpen,
    leaveEditor,
    runSearch,
  }
}

export type Files = ReturnType<typeof createFiles>
