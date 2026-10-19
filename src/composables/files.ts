import { ref, shallowRef, watch } from 'vue'
import { git } from '@/lib/git'
import type { Repo } from './repo'
import { confirmAction } from './useDialog'
import { showToast } from './useToast'

export type PreviewView = 'preview' | 'blame' | 'history' | 'edit'

/** The file browser: the repository's files at a commit (or in the working tree), and the file being previewed. */
export function createFiles({ repo }: Repo) {
  /** null is the working tree. */
  const rev = ref<string | null>(null)
  const list = shallowRef<string[]>([])
  const loading = ref(false)
  const filter = ref('')
  const expanded = ref(new Set<string>())
  const preview = shallowRef<{ path: string; rev: string | null; view: PreviewView } | null>(null)
  /** Set while the editor has unsaved changes, so nothing navigates away from them silently. */
  const dirty = ref(false)
  let seq = 0

  async function load() {
    if (!repo.value) return
    const id = ++seq
    loading.value = true
    try {
      const files = await git.listFiles(repo.value, rev.value)
      if (id === seq) list.value = files
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

  async function open(path: string, view: PreviewView = 'preview', at: string | null = rev.value) {
    const p = preview.value
    // Switching between views of the same file keeps the editor's changes only while editing.
    if (p && p.view === 'edit' && !(await leaveEditor())) return
    preview.value = { path, rev: at, view }
  }

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
  })

  return { rev, list, loading, filter, expanded, preview, dirty, load, browse, toggle, open, closePreview, leaveEditor }
}

export type Files = ReturnType<typeof createFiles>
