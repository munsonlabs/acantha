<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { git, UNCOMMITTED, type Commit, type FileChange } from '@/lib/git'
import { shortHash } from '@/lib/format'
import { relativeDate } from '@/composables/dates'
import { sendToAgent } from '@/composables/claude'
import { ask } from '@/composables/useDialog'
import { showToast } from '@/composables/useToast'
import { useWorkspace } from '@/composables/workspace'
import AgentMark from './AgentMark.vue'
import Icon from './Icon.vue'

/**
 * A worktree agent's work, reviewed in place of the graph: what it committed and every file it's changed since it
 * started (each opening as a diff), anything it hasn't committed, and the ways to take it into the branch checked out
 * here, both keeping history linear: squashed into one commit, or its commits rebased on and fast-forwarded. Asking
 * it for changes goes straight to it.
 */
const ws = useWorkspace()
const { review } = ws.ui
const root = computed(() => ws.repo.repo.value!)
const agent = computed(() => ws.agents.tabs.value.find((t) => t.id === review.value) ?? null)
const here = computed(() => ws.repo.log.value?.headBranch ?? null)

const commits = ref<Commit[]>([])
const files = ref<FileChange[]>([])
const uncommitted = ref(0)
const loading = ref(false)
const busy = ref(false)
const request = ref('')

async function load() {
  const a = agent.value
  if (!a?.cwd || !a.base) return
  loading.value = true
  const [compared, changed, status] = await Promise.all([
    git.compare(a.cwd, a.base, 'HEAD').catch(() => null),
    git.changes(a.cwd, a.base, UNCOMMITTED).catch(() => []),
    git.status(a.cwd).catch(() => null),
  ])
  commits.value = compared?.ahead ?? []
  files.value = changed
  uncommitted.value = status?.files.length ?? 0
  loading.value = false
}
watch(agent, load, { immediate: true })

const totals = computed(() => ({
  added: files.value.reduce((n, f) => n + (f.additions ?? 0), 0),
  removed: files.value.reduce((n, f) => n + (f.deletions ?? 0), 0),
}))
const letter = (f: FileChange) => (f.status === '?' ? 'U' : f.status.slice(0, 1))
const openFile = (f: FileChange) => agent.value?.base && void ws.diff.openDiff(f, agent.value.base, UNCOMMITTED, agent.value.cwd)

const close = () => (review.value = null)

/** Runs git steps one after another, saying how it went, and looks again after. */
async function steps(list: [string, string[]][], done: string) {
  busy.value = true
  try {
    for (const [where, args] of list) await git.action(where, args)
    showToast(done, 'ok')
    return true
  } catch (e) {
    showToast(String(e), 'error')
    return false
  } finally {
    busy.value = false
    await ws.repo.reload()
    await ws.status.refresh()
    await load()
  }
}

/** Commits what the agent left uncommitted, in its worktree. */
async function commitLeftovers() {
  const a = agent.value
  if (!a?.cwd) return
  const v = await ask({
    title: 'Commit its Changes',
    fields: [{ name: 'message', label: 'Message', value: ws.agents.titleOf(a), required: true }],
    confirm: 'Commit',
  })
  if (v)
    await steps(
      [
        [a.cwd, ['add', '-A']],
        [a.cwd, ['commit', '-m', String(v.message)]],
      ],
      'Committed in its worktree',
    )
}

/** Its work as one commit on the branch here: `merge --squash`, then a commit with a message to edit. */
async function squash() {
  const a = agent.value
  if (!a?.branch || !here.value) return
  const v = await ask({
    title: `Squash into ${here.value}`,
    message: `Everything ${a.branch} has, as one commit on ${here.value}.`,
    fields: [
      {
        name: 'message',
        label: 'Message',
        value: commits.value.length === 1 ? commits.value[0].subject : ws.agents.titleOf(a),
        required: true,
      },
    ],
    confirm: 'Squash',
  })
  if (
    v &&
    (await steps(
      [
        [root.value, ['merge', '--squash', a.branch]],
        [root.value, ['commit', '-m', String(v.message)]],
      ],
      `Squashed ${a.branch} into ${here.value}`,
    ))
  )
    void offerCleanUp()
}

/** Its commits onto the branch here: rebased in its worktree onto this branch, then this branch fast-forwarded. */
async function rebaseIn() {
  const a = agent.value
  if (!a?.branch || !a.cwd || !here.value) return
  if (
    await steps(
      [
        [a.cwd, ['rebase', here.value]],
        [root.value, ['merge', '--ff-only', a.branch]],
      ],
      `${here.value} now has ${a.branch}'s commits`,
    )
  )
    void offerCleanUp()
}

/** Taken in: its worktree can go (the branch is kept, as its commits are here now). */
async function offerCleanUp() {
  const a = agent.value
  if (!a?.cwd) return
  close()
  await ws.agents.removeWorktree(a.cwd)
}

async function askForChanges() {
  const a = agent.value
  const text = request.value.trim()
  if (!a || !text) return
  request.value = ''
  try {
    await sendToAgent({ id: a.id, root: root.value, cwd: a.cwd, kind: a.kind, text })
    showToast('Sent to the agent', 'ok')
  } catch (e) {
    showToast(String(e), 'error')
  }
}
</script>

<template>
  <section v-if="agent" class="review pane">
    <header class="pane-header">
      <span class="title"><Icon name="eye" :size="13" /> Review <AgentMark :kind="agent.kind" /> {{ ws.agents.titleOf(agent) }}</span>
      <span class="branch"><Icon name="branch" :size="11" /> {{ agent.branch }}</span>
      <div class="spacer" />
      <button class="ghost icon-btn" title="Look again" :disabled="loading" @click="load"><Icon name="refresh" /></button>
      <button class="ghost icon-btn" title="Show the agent" @click="ws.agents.activate(agent.id)"><Icon name="bot" /></button>
      <button class="ghost icon-btn" title="Close the review (Esc)" @click="close"><Icon name="x" /></button>
    </header>

    <div class="body">
      <p class="summary">
        {{ commits.length === 1 ? '1 commit' : `${commits.length} commits` }} · {{ files.length === 1 ? '1 file' : `${files.length} files` }}
        <span class="add">+{{ totals.added }}</span> <span class="del">−{{ totals.removed }}</span> since it started from
        <code>{{ shortHash(agent.base ?? '') }}</code>
      </p>

      <div v-if="uncommitted" class="leftovers">
        <Icon name="warning" :size="13" />
        <span
          >{{ uncommitted === 1 ? '1 change it hasn’t committed' : `${uncommitted} changes it hasn’t committed` }}: only committed work is taken
          in.</span
        >
        <button class="ghost" :disabled="busy" @click="commitLeftovers">Commit them…</button>
      </div>

      <h3 v-if="commits.length">Commits</h3>
      <ul class="commits">
        <li v-for="c in commits" :key="c.hash" :title="c.hash">
          <code>{{ shortHash(c.hash) }}</code>
          <span class="subject">{{ c.subject }}</span>
          <span class="when">{{ relativeDate(c.date) }}</span>
        </li>
      </ul>

      <h3>Files</h3>
      <p v-if="!files.length && !loading" class="quiet">Nothing changed since it started.</p>
      <ul class="files">
        <li v-for="f in files" :key="f.path" :title="f.path" @click="openFile(f)">
          <span class="letter" :class="letter(f)">{{ letter(f) }}</span>
          <span class="path">{{ f.path }}</span>
          <span v-if="f.additions != null" class="stat"
            ><span class="add">+{{ f.additions }}</span> <span class="del">−{{ f.deletions ?? 0 }}</span></span
          >
        </li>
      </ul>
    </div>

    <footer>
      <div class="ask">
        <input v-model="request" type="text" placeholder="Ask it for changes…" @keydown.enter="askForChanges" />
        <button class="ghost" :disabled="!request.trim()" @click="askForChanges">Send</button>
      </div>
      <div class="take">
        <span class="hint"
          >Into <strong>{{ here ?? 'this branch' }}</strong
          >:</span
        >
        <button
          :disabled="busy || !commits.length || !here"
          title="Its commits rebased onto this branch, which then fast-forwards to them"
          @click="rebaseIn"
        >
          Rebase and Fast-forward
        </button>
        <button class="primary" :disabled="busy || !commits.length || !here" title="Everything it did as one commit on this branch" @click="squash">
          Squash into {{ here ?? 'Branch' }}…
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.review {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.branch {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 10px;
  color: var(--fg-muted);
  font: 12px var(--mono);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 16px;
}
.summary {
  margin: 0 0 10px;
  color: var(--fg-muted);
  font-size: 12.5px;
}
.leftovers {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--modify) 45%, transparent);
  border-radius: 8px;
  color: var(--modify);
  font-size: 12.5px;
}
.leftovers span {
  flex: 1;
  color: var(--fg-muted);
}
h3 {
  margin: 14px 0 4px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12.5px;
}
.files li {
  cursor: pointer;
}
.files li:hover {
  background: var(--hover);
}
code {
  color: var(--fg-faint);
  font: 11.5px var(--mono);
}
.subject,
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.when,
.quiet {
  color: var(--fg-faint);
  font-size: 11.5px;
}
.letter {
  flex: none;
  width: 12px;
  color: var(--modify);
  font: 600 10.5px var(--mono);
}
.letter.A,
.letter.U {
  color: var(--add);
}
.letter.D {
  color: var(--del);
}
.stat {
  flex: none;
  font: 11px var(--mono);
}
.add {
  color: var(--add);
}
.del {
  color: var(--del);
}
footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}
.ask {
  display: flex;
  flex: 1 1 260px;
  gap: 6px;
}
.ask input {
  flex: 1;
  min-width: 0;
}
.take {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hint {
  color: var(--fg-faint);
  font-size: 12px;
}
</style>
