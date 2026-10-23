<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { git, type BranchCleanup, type BranchState } from '@/lib/git'
import { OLD_DAYS, staleBranches, type StaleKind } from '@/lib/branches'
import { relativeDate } from '@/composables/dates'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'

/**
 * Clean Up Branches: the local branches that look done with, grouped by why (merged, gone from the remote, long
 * untouched), to delete in one go. Only local branches go, and Undo brings them back. One checked out in another
 * worktree can't be deleted, so it's shown but can't be picked.
 */
const ws = useWorkspace()
const { branchCleanup: open } = ws.ui
const { repo, log, run } = ws.repo

const found = ref<BranchCleanup | null>(null)
const loading = ref(false)
const picked = ref(new Set<string>())

const groups = computed(() => (found.value ? staleBranches(found.value.branches) : null))
const base = computed(() => found.value?.base ?? 'the main branch')
/** Branches checked out in other worktrees, by name: git won't delete those. */
const elsewhere = computed(() => new Map((log.value?.worktrees ?? []).filter((w) => w.branch && !w.current).map((w) => [w.branch!, w.path])))

const SECTIONS = computed<{ kind: StaleKind; title: string; about: string }[]>(() => [
  { kind: 'merged', title: `Merged into ${base.value}`, about: `Everything on them is in ${base.value}.` },
  {
    kind: 'gone',
    title: 'Gone from the remote',
    about: 'Their remote branch was deleted, usually once its pull request was merged (squash merges too). Commits never pushed are only here.',
  },
  { kind: 'old', title: `Untouched for ${OLD_DAYS / 30} months`, about: 'Not merged, and no commits in a while. Not picked to start with.' },
])

watch(
  open,
  async (shown) => {
    found.value = null
    picked.value = new Set()
    if (!shown || !repo.value) return
    loading.value = true
    try {
      found.value = await git.branchCleanup(repo.value)
      // Merged and gone ones are picked to start with; old ones are for you to pick.
      const g = staleBranches(found.value.branches)
      picked.value = new Set([...g.merged, ...g.gone].filter((b) => !elsewhere.value.has(b.name)).map((b) => b.name))
    } catch (e) {
      showToast(String(e), 'error')
      open.value = false
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function toggle(name: string) {
  const next = new Set(picked.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  picked.value = next
}

/** Picks or unpicks a whole group. */
function toggleAll(list: BranchState[]) {
  const names = list.filter((b) => !elsewhere.value.has(b.name)).map((b) => b.name)
  const all = names.every((n) => picked.value.has(n))
  const next = new Set(picked.value)
  for (const n of names) {
    if (all) next.delete(n)
    else next.add(n)
  }
  picked.value = next
}
const allPicked = (list: BranchState[]) => {
  const names = list.filter((b) => !elsewhere.value.has(b.name)).map((b) => b.name)
  return names.length > 0 && names.every((n) => picked.value.has(n))
}

const empty = computed(() => !!groups.value && Object.values(groups.value).every((g) => !g.length))

async function remove() {
  const chosen = (found.value?.branches ?? []).filter((b) => picked.value.has(b.name))
  if (!chosen.length || !repo.value) return
  const root = repo.value
  open.value = false
  // -D: whether each is merged was settled against the base, which needn't be the branch checked out here.
  await run(['branch', '-D', ...chosen.map((b) => b.name)], {
    busy: 'Deleting…',
    done: chosen.length === 1 ? `Deleted ${chosen[0].name}` : `Deleted ${chosen.length} branches`,
    undo: {
      label: chosen.length === 1 ? `deleting ${chosen[0].name}` : `deleting ${chosen.length} branches`,
      run: async () => {
        for (const b of chosen) {
          await git.action(root, ['branch', b.name, b.hash])
          // Its upstream again, where that's still there.
          if (b.upstream && !b.gone) await git.action(root, ['branch', '--set-upstream-to', b.upstream, b.name]).catch(() => {})
        }
      },
    },
  })
}
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="overlay" @mousedown.self="open = false">
      <div class="modal cleanup" role="dialog" aria-modal="true" aria-label="Clean Up Branches">
        <header>
          <h2><Icon name="trash" :size="14" /> Clean Up Branches</h2>
          <span v-if="found" class="muted"
            >compared with <code>{{ base }}</code></span
          >
          <div class="spacer" />
          <button class="ghost icon-btn" title="Close (Esc)" @click="open = false"><Icon name="x" /></button>
        </header>

        <div class="body">
          <p v-if="loading" class="note">Looking through the branches…</p>
          <p v-else-if="empty" class="note">Nothing to clean up: every local branch is still in use.</p>
          <template v-else-if="groups">
            <section v-for="s in SECTIONS" v-show="groups[s.kind].length" :key="s.kind">
              <label class="group">
                <input type="checkbox" :checked="allPicked(groups[s.kind])" @change="toggleAll(groups[s.kind])" />
                <span class="title">{{ s.title }}</span>
                <span class="count">{{ groups[s.kind].length }}</span>
              </label>
              <p class="about">{{ s.about }}</p>
              <ul>
                <li v-for="b in groups[s.kind]" :key="b.name" :class="{ locked: elsewhere.has(b.name) }">
                  <label :title="elsewhere.has(b.name) ? `Checked out in ${elsewhere.get(b.name)}` : b.subject">
                    <input type="checkbox" :checked="picked.has(b.name)" :disabled="elsewhere.has(b.name)" @change="toggle(b.name)" />
                    <span class="name">{{ b.name }}</span>
                    <span class="subject">{{ b.subject }}</span>
                    <span v-if="elsewhere.has(b.name)" class="flag">in a worktree</span>
                    <span v-else-if="b.ahead && !b.merged" class="flag warn" :title="`${b.ahead} commits not in ${base}`">+{{ b.ahead }}</span>
                    <span class="when">{{ relativeDate(b.date) }}</span>
                  </label>
                </li>
              </ul>
            </section>
          </template>
        </div>

        <footer>
          <span class="muted">Only local branches: copies on the remote stay. Undo brings them back.</span>
          <div class="spacer" />
          <button @click="open = false">Cancel</button>
          <button class="danger" :disabled="!picked.size" @click="remove">
            Delete {{ picked.size === 1 ? '1 Branch' : `${picked.size} Branches` }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.cleanup {
  display: flex;
  flex-direction: column;
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
}
header,
footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
header {
  border-bottom: 1px solid var(--border);
}
footer {
  border-top: 1px solid var(--border);
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.muted {
  color: var(--fg-faint);
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 14px 12px;
}
.note {
  margin: 16px 0;
  color: var(--fg-muted);
}
section + section {
  margin-top: 10px;
}
.group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-weight: 600;
  cursor: pointer;
}
.count {
  padding: 0 6px;
  border-radius: 8px;
  background: var(--pill);
  color: var(--fg-muted);
  font: 500 10.5px var(--font);
}
.about {
  margin: 2px 0 6px 24px;
  color: var(--fg-faint);
  font-size: 12px;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li label {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 6px;
  border-radius: 7px;
  font-size: 12.5px;
  cursor: pointer;
}
li label:hover {
  background: var(--hover);
}
li.locked label {
  color: var(--fg-faint);
  cursor: default;
}
.name {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  font-family: var(--mono);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.flag {
  flex: none;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-faint);
  font-size: 10.5px;
}
.flag.warn {
  color: var(--modify);
}
.when {
  flex: none;
  color: var(--fg-faint);
  font-size: 11px;
}
</style>
