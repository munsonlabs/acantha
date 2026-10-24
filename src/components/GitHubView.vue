<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { github, overall, runningRuns, type CheckState, type PullRequest, type Run } from '@/lib/github'
import { showToast } from '@/composables/useToast'
import { openMenu } from '@/composables/useContextMenu'
import { isOn } from '@/features'
import { useWorkspace } from '@/composables/workspace'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'

/**
 * GitHub for this repository, through the GitHub CLI: the checked-out branch's pull request and its checks, recent
 * Actions runs, and the open pull requests. Everything opens on GitHub. Refreshes every minute while it's showing.
 */
const props = defineProps<{ tabId: string }>()
const ws = useWorkspace()
const { repo, log } = ws.repo
/** Kept alive after its tab closes, it has to notice and stop. */
const closed = () => !ws.panel.tabs.value.some((t) => t.id === props.tabId)

const pr = shallowRef<PullRequest | null>(null)
const prs = shallowRef<PullRequest[]>([])
const runs = shallowRef<Run[]>([])
const error = ref<string | null>(null)
const loaded = ref(false)
const loading = ref(false)
const branchOnly = ref(true)
const showChecks = ref(false)

const branch = computed(() => log.value?.headBranch ?? null)

let seq = 0
async function load() {
  const root = repo.value
  if (!root) return
  const id = ++seq
  loading.value = true
  try {
    const [mine, open, recent] = await Promise.all([branch.value ? github.currentPr(root) : null, github.openPrs(root), github.runs(root)])
    if (id !== seq) return
    pr.value = mine
    prs.value = open.filter((p) => p.number !== mine?.number)
    runs.value = recent
    runningRuns.value = { ...runningRuns.value, [root]: shown.value.filter((r) => r.state === 'pending').length }
    error.value = null
  } catch (e) {
    if (id === seq) error.value = String(e)
  } finally {
    if (id === seq) {
      loading.value = false
      loaded.value = true
    }
  }
}

/**
 * The runs to list: with "this branch only", the ones on the branch or on the commit checked out, so a release started
 * by pushing a tag shows too (GitHub files those under the tag).
 */
const shown = computed(() =>
  branchOnly.value && branch.value ? runs.value.filter((r) => r.branch === branch.value || r.sha === log.value?.head) : runs.value,
)
const running = computed(() => shown.value.filter((r) => r.state === 'pending').length)

/**
 * Checks again every minute, or every 15 seconds while a run is going so its end shows soon after. It carries on while
 * another panel tab is showing (the panel keeps this tab alive), so the tab's running count stays true.
 */
let timer: ReturnType<typeof setTimeout> | undefined
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(
    async () => {
      if (closed()) return void (repo.value && (runningRuns.value = { ...runningRuns.value, [repo.value]: 0 }))
      if (document.visibilityState === 'visible') await load()
      schedule()
    },
    running.value ? 15_000 : 60_000,
  )
}
onMounted(async () => {
  await load()
  schedule()
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  if (repo.value) runningRuns.value = { ...runningRuns.value, [repo.value]: 0 }
})
// A checkout or a push changes what's relevant.
watch([branch, branchOnly, () => log.value?.head], () => void load())

/**
 * After a push GitHub takes a moment to start its runs, so look again a few seconds later, and again after that. A push
 * shows as the branch no longer being ahead of its remote, or a tag appearing.
 */
let soon: ReturnType<typeof setTimeout>[] = []
function lookSoon() {
  soon.forEach(clearTimeout)
  soon = [3000, 15000].map((ms) => setTimeout(() => void load().then(schedule), ms))
}
watch(
  () => ws.status.status.value?.ahead ?? 0,
  (now, before) => now < before && lookSoon(),
)
watch(
  () => log.value?.refs.filter((r) => r.kind === 'tag').length ?? 0,
  (now, before) => now > before && lookSoon(),
)
onBeforeUnmount(() => soon.forEach(clearTimeout))

/** A run's menu: open it, or (failed) start an agent on finding out why and fixing it. */
function runMenu(e: MouseEvent, r: Run) {
  openMenu(e, [
    { header: r.workflow, detail: r.title },
    { label: 'Open on GitHub', icon: 'external', run: () => openUrl(r.url) },
    ...(r.state === 'fail' && isOn('claude')
      ? [
          {
            label: 'Ask an Agent Why It Failed',
            icon: 'bot' as const,
            run: () =>
              ws.agents.askAgent(
                `The GitHub Actions run "${r.workflow}: ${r.title}" on ${r.branch} failed (${r.url}). \`gh run view ${r.id} --log-failed\` shows why: find the cause and fix it.`,
              ),
          },
        ]
      : []),
  ])
}

const ICON: Record<CheckState, string> = { pass: '✓', fail: '✕', pending: '●', skipped: '–' }
const REVIEW: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review needed' }

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

async function createPr() {
  try {
    await github.createPr(repo.value!)
  } catch (e) {
    showToast(String(e), 'error')
  }
}

const prState = (p: PullRequest) => overall(p.checks)
</script>

<template>
  <div class="github">
    <div class="bar">
      <span class="title">{{ branch ?? 'Detached HEAD' }}</span>
      <div class="spacer" />
      <label class="check"><input v-model="branchOnly" type="checkbox" /> this branch only</label>
      <button class="ghost icon-btn" title="Refresh" :disabled="loading" @click="load"><Icon name="refresh" :size="13" /></button>
    </div>

    <p v-if="error" class="note error">{{ error }}</p>
    <Skeleton v-else-if="!loaded" :lines="6" />
    <div v-else class="lists">
      <h3>Pull request</h3>
      <div v-if="pr" class="card" @click="openUrl(pr.url)">
        <div class="pr-line">
          <span class="state" :class="prState(pr) ?? 'none'">{{ prState(pr) ? ICON[prState(pr)!] : '○' }}</span>
          <strong>#{{ pr.number }}</strong>
          <span class="subject">{{ pr.title }}</span>
          <span v-if="pr.isDraft" class="pill">draft</span>
          <span v-if="REVIEW[pr.reviewDecision]" class="pill" :class="{ good: pr.reviewDecision === 'APPROVED' }">{{
            REVIEW[pr.reviewDecision]
          }}</span>
        </div>
        <div class="meta">
          {{ pr.headRefName }} → {{ pr.baseRefName }} ·
          <a href="#" @click.prevent.stop="showChecks = !showChecks">
            {{ pr.checks.length }} {{ pr.checks.length === 1 ? 'check' : 'checks' }} ({{
              pr.checks.filter((c) => c.state === 'pass').length
            }}
            passed{{ pr.checks.some((c) => c.state === 'fail') ? `, ${pr.checks.filter((c) => c.state === 'fail').length} failed` : '' }})
          </a>
        </div>
        <ul v-if="showChecks" class="checks">
          <li v-for="c in pr.checks" :key="c.name" @click.stop="c.url && openUrl(c.url)">
            <span class="state" :class="c.state">{{ ICON[c.state] }}</span>
            <span class="subject">{{ c.name }}</span>
          </li>
        </ul>
      </div>
      <div v-else-if="branch" class="card empty">
        No pull request for {{ branch }}.
        <button class="ghost" @click="createPr"><Icon name="external" :size="12" /> Create one on GitHub</button>
      </div>

      <h3>
        Actions<span v-if="running" class="running"> · {{ running }} running</span>
      </h3>
      <p v-if="!shown.length" class="none">No workflow runs{{ branchOnly && branch ? ` on ${branch}` : '' }}.</p>
      <ul>
        <li
          v-for="r in shown"
          :key="r.id"
          :title="`${r.workflow}: ${r.title}\n${r.event} on ${r.branch}`"
          @click="openUrl(r.url)"
          @contextmenu.prevent="runMenu($event, r)"
        >
          <span class="state" :class="r.state">{{ ICON[r.state] }}</span>
          <span class="wf">{{ r.workflow }}</span>
          <span class="subject">{{ r.title }}</span>
          <span class="meta-r">{{ branchOnly && r.branch === branch ? '' : `${r.branch} · ` }}{{ ago(r.createdAt) }}</span>
        </li>
      </ul>

      <h3>Open pull requests</h3>
      <p v-if="!prs.length" class="none">None{{ pr ? ' besides this branch’s' : '' }}.</p>
      <ul>
        <li v-for="p in prs" :key="p.number" :title="`${p.title}\n${p.headRefName} → ${p.baseRefName} by ${p.author}`" @click="openUrl(p.url)">
          <span class="state" :class="prState(p) ?? 'none'">{{ prState(p) ? ICON[prState(p)!] : '○' }}</span>
          <span class="num">#{{ p.number }}</span>
          <span class="subject">{{ p.title }}</span>
          <span v-if="p.isDraft" class="pill">draft</span>
          <span class="meta-r">{{ p.author }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.github {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.title {
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.check {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.icon-btn {
  width: 26px;
  height: 26px;
  color: var(--fg-muted);
}
.lists {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 8px 12px;
  scrollbar-width: thin;
}
h3 {
  margin: 10px 6px 4px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
}
.card {
  margin: 0 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--hover);
  font-size: 12.5px;
  cursor: default;
}
.card.empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--fg-muted);
}
.pr-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.meta {
  margin-top: 3px;
  padding-left: 20px;
  color: var(--fg-faint);
  font-size: 11.5px;
}
.meta a {
  color: inherit;
}
.checks {
  margin-top: 4px;
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
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: default;
}
li:hover {
  background: var(--hover);
}
.state {
  width: 14px;
  flex: none;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}
.state.pass {
  color: var(--add);
}
.state.fail {
  color: var(--del);
}
.state.pending {
  color: var(--modify);
  animation: pulse 1.4s ease-in-out infinite;
}
.state.skipped,
.state.none {
  color: var(--fg-faint);
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.subject {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.wf,
.num {
  flex: none;
  color: var(--fg-muted);
  font-size: 11.5px;
}
.meta-r {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-faint);
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pill {
  flex: none;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--pill);
  color: var(--fg-muted);
  font-size: 10.5px;
}
.pill.good {
  color: var(--add);
}
.running {
  color: var(--modify);
}
.none,
.note {
  margin: 4px 6px;
  color: var(--fg-faint);
  font-size: 12px;
}
.error {
  color: var(--del);
  white-space: pre-wrap;
}
</style>
