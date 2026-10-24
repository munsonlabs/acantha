import { ref, shallowRef } from 'vue'
import type { StatusFile } from '@/lib/git'

/** Which panels and modals a workspace has open. */
export function createUi() {
  return {
    sidebarTab: ref<'files' | 'search' | 'scm' | 'agents'>('scm'),
    /** Bumped to put the cursor in the file search box. */
    focusFileSearch: ref(0),
    /** Interactive rebase of the commits after `base` (null: from the root). */
    rebase: shallowRef<{ base: string | null; label: string } | null>(null),
    conflict: shallowRef<StatusFile | null>(null),
    /** The Clean Up Branches window. */
    branchCleanup: ref(false),
    /** A worktree agent's work under review, in place of the graph: by its id. */
    review: ref<string | null>(null),
    /** What was last brought over the graph, so it's what shows there while it's open (see GraphPane). */
    front: ref<'file' | 'review' | 'agents' | 'panel' | null>(null),
  }
}

export type Ui = ReturnType<typeof createUi>
