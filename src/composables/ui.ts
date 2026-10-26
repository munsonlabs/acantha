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
    /** What's been brought to the graph's place, in order, the latest last (see composables/center.ts). */
    stack: ref<('review' | 'agents' | 'panel' | 'graph')[]>([]),
  }
}

export type Ui = ReturnType<typeof createUi>
