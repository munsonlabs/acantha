import { ref, shallowRef } from 'vue'
import type { StatusFile } from '@/lib/git'
import type { SlackLink } from '@/lib/slack'

/** Which panels and modals a workspace has open. */
export function createUi() {
  return {
    sidebarTab: ref<'files' | 'search' | 'scm'>('scm'),
    /** Bumped to put the cursor in the file search box. */
    focusFileSearch: ref(0),
    /** A Slack message or canvas open over the graph, from its link. */
    slack: shallowRef<{ url: string; link: SlackLink } | null>(null),
    /** The Slack message or canvas is shown in place of the graph rather than under the terminal. */
    slackExpanded: ref(false),
    /** Interactive rebase of the commits after `base` (null: from the root). */
    rebase: shallowRef<{ base: string | null; label: string } | null>(null),
    conflict: shallowRef<StatusFile | null>(null),
  }
}

export type Ui = ReturnType<typeof createUi>
