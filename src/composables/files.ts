import { ref, shallowRef, watch } from 'vue'
import { filterPathspecs, parseFileFilter } from '@/lib/fileFilter'
import { git, type SearchResults } from '@/lib/git'
import { prefs } from './prefs'
import type { Repo } from './repo'
import { confirmAction } from './useDialog'
import { showToast } from './useToast'

export type PreviewView = 'preview' | 'blame' | 'history' | 'edit'

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

  /** Without a view, a working-tree file opens in the editor when that's the setting; anything else as a preview. */
  async function open(path: string, view?: PreviewView, at: string | null = rev.value, line?: number) {
    view ??= prefs.editByDefault.value && at === null ? 'edit' : 'preview'
    const p = preview.value
    // Switching between views of the same file keeps the editor's changes only while editing.
    if (p && p.view === 'edit' && !(await leaveEditor())) return
    preview.value = { path, rev: at, view, line }
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

  async function closePreview() {
    if (preview.value?.view === 'edit' && !(await leaveEditor())) return
    preview.value = null
  }

  watch(repo, () => {
    rev.value = null
    list.value = []
    preview.value = null
    dirty.value = false
    expanded.value = new Set()
    newFolders.value = new Set()
  })

  return {
    rev,
    list,
    folders,
    loading,
    filter,
    expanded,
    newFolders,
    preview,
    dirty,
    search,
    load,
    browse,
    toggle,
    open,
    closePreview,
    leaveEditor,
    runSearch,
  }
}

export type Files = ReturnType<typeof createFiles>
