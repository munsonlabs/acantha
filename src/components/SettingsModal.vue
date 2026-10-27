<script lang="ts">
import { ref } from 'vue'

type Tab = 'appearance' | 'features' | 'git' | 'graph' | 'editor' | 'terminal' | 'claude' | 'slack'
/** The page last open, so Settings opens where you left it. */
const lastTab = ref<Tab>('appearance')
</script>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { allPast, deleteAllPast, deleteConversation } from '@/composables/claude'
import { bytesText } from '@/lib/memory'
import { showToast } from '@/composables/useToast'
import { when } from '@/lib/claudeView'
import { overlays, ZOOM_MAX, ZOOM_MIN } from '@/composables/commands'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import { FEATURES, isOn, setFeature } from '@/features'
import Icon from './Icon.vue'

const { active } = useWorkspaces()
const open = overlays.settings

const EDITORS = ['', 'Visual Studio Code', 'Cursor', 'Zed', 'Sublime Text', 'TextEdit']

// Remote branches change what the log contains, so the graph reloads.
/** Slack channel IDs, edited as one comma-separated line. */
const slackChannels = computed({
  get: () => prefs.slackChannels.value.join(', '),
  set: (v: string) => (prefs.slackChannels.value = v.split(/[\s,]+/).filter((id) => /^[A-Z0-9]+$/.test(id))),
})

/** Past Claude conversations kept to pick up again, newest first. */
const past = computed(allPast)

/** What Claude Code and OpenCode keep on disk, looked at when the Agents page opens. */
interface Kept {
  bytes: number
  sessions: number
  cleanupDays: number | null
  present: boolean
}
const storage = ref<{ claude: Kept; opencode: Kept } | null>(null)
const lookAtStorage = async () => (storage.value = await invoke<{ claude: Kept; opencode: Kept }>('agent_storage').catch(() => null))
watch(
  () => open.value && tab.value === 'claude',
  (showing) => showing && void lookAtStorage(),
  { immediate: true },
)
/** Claude Code's own period, set in its settings (only this value changes there). */
async function setClaudeCleanup(days: number) {
  try {
    await invoke('claude_set_cleanup_days', { days })
    showToast(`Claude Code keeps transcripts ${days} days`)
  } catch (e) {
    showToast(String(e), 'error')
  }
  void lookAtStorage()
}
const pruning = ref(false)
async function pruneOpenCode() {
  const days = prefs.opencodePruneDays.value || 30
  pruning.value = true
  const gone = await invoke<number>('opencode_prune', { days }).catch(() => 0)
  pruning.value = false
  showToast(
    gone ? `Deleted ${gone} OpenCode session${gone === 1 ? '' : 's'} older than ${days} days` : `No OpenCode sessions older than ${days} days`,
  )
  void lookAtStorage()
}
const repoName = (path: string) => path.split('/').pop() ?? path

/** Settings by topic, one page each; Slack's and Claude's only while they're switched on. */
const TABS = computed(() =>
  (
    [
      { id: 'appearance', label: 'Appearance', icon: 'moon' },
      { id: 'features', label: 'Features', icon: 'app' },
      { id: 'git', label: 'Git', icon: 'scm' },
      { id: 'graph', label: 'Graph', icon: 'history' },
      { id: 'editor', label: 'Editor', icon: 'pencil' },
      { id: 'terminal', label: 'Terminal', icon: 'terminal' },
      { id: 'claude', label: 'Agents', icon: 'bot' },
      { id: 'slack', label: 'Slack', icon: 'message' },
    ] as const
  ).filter((t) => (t.id !== 'slack' || isOn('slack')) && (t.id !== 'claude' || isOn('claude'))),
)
const tab = computed({
  get: () => (TABS.value.some((t) => t.id === lastTab.value) ? lastTab.value : 'appearance'),
  set: (t: Tab) => (lastTab.value = t),
})

const setRemotes = (on: boolean) => (active.value ? active.value.repo.setShowRemotes(on) : (prefs.showRemotes.value = on))
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="overlay" @mousedown.self="open = false">
      <div class="modal settings" role="dialog" aria-modal="true" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <button class="ghost icon-btn" title="Close (Esc)" @click="open = false"><Icon name="x" /></button>
        </header>
        <div class="main">
          <nav class="tabs-nav" aria-label="Settings pages">
            <button v-for="t in TABS" :key="t.id" class="ghost" :class="{ on: tab === t.id }" @click="tab = t.id">
              <Icon :name="t.icon" :size="13" /> {{ t.label }}
            </button>
          </nav>
          <div class="body">
            <section v-show="tab === 'appearance'">
              <h3>Appearance</h3>
              <div class="row">
                <div>
                  <span class="label">Interface size</span>
                  <span class="hint">Scales all text and controls. ⌘+ and ⌘− work too.</span>
                </div>
                <span class="number">
                  <input v-model.number="prefs.uiZoom.value" type="range" :min="ZOOM_MIN" :max="ZOOM_MAX" step="0.05" />
                  <span class="value">{{ Math.round(prefs.uiZoom.value * 100) }}%</span>
                  <button class="ghost reset" :disabled="prefs.uiZoom.value === 1" title="Actual size (⌘0)" @click="prefs.uiZoom.value = 1">
                    Reset
                  </button>
                </span>
              </div>
              <label v-if="isOn('tabSleep')" class="row">
                <div>
                  <span class="label">Sleep unused tabs</span>
                  <span class="hint"
                    >Lets go of a tab's graph, editor and terminals; it opens again when clicked. Tabs with something running in a terminal stay
                    awake.</span
                  >
                </div>
                <select v-model.number="prefs.autoSleepMinutes.value">
                  <option :value="0">Never</option>
                  <option :value="15">After 15 minutes</option>
                  <option :value="30">After 30 minutes</option>
                  <option :value="60">After an hour</option>
                </select>
              </label>
              <div class="row">
                <div>
                  <span class="label">Dates</span>
                  <span class="hint">Recent commits as “2h ago”, or always the full date.</span>
                </div>
                <div class="segmented">
                  <button :class="{ on: prefs.dateStyle.value === 'relative' }" @click="prefs.dateStyle.value = 'relative'">Relative</button>
                  <button :class="{ on: prefs.dateStyle.value === 'absolute' }" @click="prefs.dateStyle.value = 'absolute'">Absolute</button>
                </div>
              </div>
              <label class="row">
                <div>
                  <span class="label">Author pictures</span>
                  <span class="hint">From GitHub, or Gravatar (sent a hash of the email, not the address).</span>
                </div>
                <input v-model="prefs.avatars.value" type="checkbox" class="switch" />
              </label>
            </section>

            <section v-show="tab === 'features'">
              <h3>Features</h3>
              <p class="hint">
                Everything beyond the graph, Git panel, files, search, editor and terminals. A feature switched off isn't loaded and leaves the menus;
                its panel tabs are kept for when it's back on.
              </p>
              <!-- Every AI feature at once: off, none of it shows or runs, for working the old way. -->
              <label class="row ai">
                <div>
                  <span class="label">AI features</span>
                  <span class="hint">
                    Claude Code and OpenCode agents, Ask an Agent, reviewing an agent’s work and repository tours. Off, none of it shows, and anything
                    running stops; your agents and their conversations are kept for when it’s back on.
                  </span>
                </div>
                <input
                  type="checkbox"
                  class="switch"
                  :checked="isOn('claude')"
                  @change="setFeature('claude', ($event.target as HTMLInputElement).checked)"
                />
              </label>
              <label v-for="f in FEATURES.filter((f) => f.id !== 'claude')" :key="f.id" class="row">
                <div>
                  <span class="label">{{ f.name }}</span>
                  <span class="hint">{{ f.description }}</span>
                </div>
                <input type="checkbox" class="switch" :checked="isOn(f.id)" @change="setFeature(f.id, ($event.target as HTMLInputElement).checked)" />
              </label>
            </section>

            <section v-show="tab === 'git'">
              <h3>Git</h3>
              <label class="row">
                <div>
                  <span class="label">Fetch automatically</span>
                  <span class="hint">Keeps remote branches and the “behind” badges up to date.</span>
                </div>
                <input v-model="prefs.autoFetch.value" type="checkbox" class="switch" />
              </label>
              <label class="row" :class="{ off: !prefs.autoFetch.value }">
                <span class="label">Every</span>
                <select v-model.number="prefs.autoFetchMinutes.value" :disabled="!prefs.autoFetch.value">
                  <option v-for="m in [2, 5, 10, 15, 30]" :key="m" :value="m">{{ m }} minutes</option>
                </select>
              </label>
            </section>

            <section v-show="tab === 'graph'">
              <h3>Graph</h3>
              <label class="row">
                <span class="label">Show remote branches</span>
                <input
                  type="checkbox"
                  class="switch"
                  :checked="prefs.showRemotes.value"
                  @change="setRemotes(($event.target as HTMLInputElement).checked)"
                />
              </label>
              <label class="row">
                <span class="label">Show stashes</span>
                <input v-model="prefs.showStashes.value" type="checkbox" class="switch" />
              </label>
            </section>

            <section v-show="tab === 'editor'">
              <h3>Editor</h3>
              <label class="row">
                <div>
                  <span class="label">Open files for editing</span>
                  <span class="hint"
                    >Opening a file from the working tree goes straight to the editor. Images, other binary files and past commits still
                    preview.</span
                  >
                </div>
                <input v-model="prefs.editByDefault.value" type="checkbox" class="switch" />
              </label>
              <label class="row">
                <span class="label">Open files with</span>
                <select v-model="prefs.externalEditor.value">
                  <option v-for="app in EDITORS" :key="app" :value="app">{{ app || 'Default app' }}</option>
                </select>
              </label>
            </section>

            <section v-if="isOn('claude')" v-show="tab === 'claude'">
              <h3>Agents</h3>
              <label class="row">
                <div>
                  <span class="label">Keep on top</span>
                  <span class="hint">A popped-out Claude floats above other apps, full-screen ones included.</span>
                </div>
                <input v-model="prefs.claudeOnTop.value" type="checkbox" class="switch" />
              </label>
              <label class="row">
                <div>
                  <span class="label">One floating agent at a time</span>
                  <span class="hint"
                    >Popping out another agent swaps it in where the first was, and the first goes back to the panel. Each floating window takes a
                    hundred-odd MB.</span
                  >
                </div>
                <input v-model="prefs.agentOneWindow.value" type="checkbox" class="switch" />
              </label>
              <label class="row">
                <div>
                  <span class="label">Tours planned with</span>
                  <span class="hint"
                    >The model that reads the code to plan a repository tour. Haiku plans a good one in about half a minute, lightly on your plan’s
                    usage.</span
                  >
                </div>
                <select v-model="prefs.tourModel.value">
                  <option value="haiku">Haiku</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                  <option value="">Claude Code’s default</option>
                </select>
              </label>
              <label class="row">
                <div>
                  <span class="label">Editor ⌘I asks</span>
                  <span class="hint">The model that changes the selected code, or answers about it, when you press ⌘I in the editor.</span>
                </div>
                <select v-model="prefs.editAskModel.value">
                  <option value="haiku">Haiku</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                  <option value="">Claude Code’s default</option>
                </select>
              </label>
              <label class="row">
                <div>
                  <span class="label">Dim the screen</span>
                  <span class="hint"
                    >While you're in a popped-out Claude, the screen behind it dims so it's easier to read. Click the dimming to collapse
                    Claude.</span
                  >
                </div>
                <span class="number">
                  <input v-model.number="prefs.claudeDim.value" type="range" min="0" max="0.8" step="0.05" />
                  <span>{{ prefs.claudeDim.value ? `${Math.round(prefs.claudeDim.value * 100)}%` : 'Off' }}</span>
                </span>
              </label>

              <h4>Past conversations</h4>
              <p class="hint">
                A closed Claude tab's conversation is kept here, to pick up again from a new tab. Taking one off the list leaves the session with
                Claude Code (<code>claude --resume</code>); deleting it deletes that too.
              </p>
              <label class="row">
                <span class="label">Keep for</span>
                <select v-model.number="prefs.claudeKeepDays.value">
                  <option :value="7">A week</option>
                  <option :value="30">A month</option>
                  <option :value="90">Three months</option>
                  <option :value="0">Until deleted</option>
                </select>
              </label>
              <label class="row">
                <span class="label">At most, per repository</span>
                <select v-model.number="prefs.claudeKeepPerRepo.value">
                  <option :value="5">5</option>
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                  <option :value="0">Any number</option>
                </select>
              </label>
              <label class="row">
                <div>
                  <span class="label">Forget a repository's when its tab closes</span>
                  <span class="hint">Its Claude tabs and past conversations, so the list holds only what's open.</span>
                </div>
                <input v-model="prefs.claudeForgetOnClose.value" type="checkbox" class="switch" />
              </label>
              <ul v-if="past.length" class="past">
                <li v-for="c in past" :key="c.id">
                  <span class="repo">{{ repoName(c.repo) }}</span>
                  <span class="what" :title="c.title">{{ c.title || 'Untitled' }}</span>
                  <span class="when">{{ when(c.updated) }}</span>
                  <button class="ghost icon-btn" title="Delete this conversation" @click="deleteConversation(c.id)">
                    <Icon name="trash" :size="12" />
                  </button>
                </li>
              </ul>
              <p v-else class="hint">None yet.</p>
              <div v-if="past.length" class="row">
                <span class="hint">{{ past.length === 1 ? '1 conversation' : `${past.length} conversations` }}</span>
                <button class="ghost danger" @click="deleteAllPast()">Delete all</button>
              </div>
              <label class="row">
                <div>
                  <span class="label">Delete their sessions too</span>
                  <span class="hint"
                    >When Acantha lets a past conversation go by itself (too old, or too many), its session is deleted from disk as well.</span
                  >
                </div>
                <input v-model="prefs.agentsTrimSessions.value" type="checkbox" class="switch" />
              </label>

              <h4>Sessions on disk</h4>
              <p class="hint">
                Claude Code and OpenCode keep every conversation’s session, Acantha’s agents’ and their own. Claude Code trims its own; OpenCode keeps
                them all unless told otherwise.
              </p>
              <label v-if="storage?.claude.present" class="row">
                <div>
                  <span class="label">Claude Code · {{ bytesText(storage.claude.bytes) }}</span>
                  <span class="hint">
                    {{ storage.claude.sessions }} transcripts. It deletes one unused for this long as it starts (its own setting,
                    <code>cleanupPeriodDays</code>).
                  </span>
                </div>
                <select :value="storage.claude.cleanupDays ?? 30" @change="setClaudeCleanup(Number(($event.target as HTMLSelectElement).value))">
                  <option :value="7">A week</option>
                  <option :value="14">Two weeks</option>
                  <option :value="30">A month{{ storage.claude.cleanupDays == null ? ' (its default)' : '' }}</option>
                  <option :value="90">Three months</option>
                  <option :value="365">A year</option>
                </select>
              </label>
              <label v-if="storage?.opencode.present" class="row">
                <div>
                  <span class="label">OpenCode · {{ bytesText(storage.opencode.bytes) }}</span>
                  <span class="hint">{{ storage.opencode.sessions }} sessions. Acantha deletes ones unused for this long as it starts.</span>
                </div>
                <select v-model.number="prefs.opencodePruneDays.value">
                  <option :value="0">Keep them all</option>
                  <option :value="7">After a week</option>
                  <option :value="30">After a month</option>
                  <option :value="90">After three months</option>
                </select>
              </label>
              <div v-if="storage?.opencode.present" class="row">
                <span class="hint">Delete OpenCode’s sessions unused for {{ prefs.opencodePruneDays.value || 30 }} days now.</span>
                <button class="ghost danger" :disabled="pruning" @click="pruneOpenCode">{{ pruning ? 'Deleting…' : 'Delete them' }}</button>
              </div>
            </section>

            <section v-if="isOn('slack')" v-show="tab === 'slack'">
              <h3>Slack</h3>
              <label class="row">
                <div>
                  <span class="label">Allowed channels</span>
                  <span class="hint">Channel IDs (the C… part of a message link). Leave empty to allow any channel you're in.</span>
                </div>
                <input v-model.lazy="slackChannels" type="text" placeholder="C0123ABCD" spellcheck="false" autocomplete="off" />
              </label>
              <p class="hint">
                Open a message or canvas by pasting its link anywhere (⇧⌘L to type one). Your token is read from the macOS Keychain
                (<code>com.munsonlabs.acantha.slack</code>) and never stored by the app.
              </p>
            </section>

            <section v-show="tab === 'terminal'">
              <h3>Terminal</h3>
              <label class="row">
                <span class="label">Font size</span>
                <span class="number">
                  <input v-model.number="prefs.terminalFontSize.value" type="range" min="10" max="20" step="0.5" />
                  <span>{{ prefs.terminalFontSize.value }}px</span>
                </span>
              </label>
              <label class="row">
                <div>
                  <span class="label">Scrollback</span>
                  <span class="hint">Lines each terminal keeps to scroll back through. More uses more memory per terminal.</span>
                </div>
                <select v-model.number="prefs.terminalScrollback.value">
                  <option :value="1000">1,000 lines</option>
                  <option :value="2000">2,000 lines</option>
                  <option :value="5000">5,000 lines</option>
                  <option :value="10000">10,000 lines</option>
                  <option :value="50000">50,000 lines</option>
                </select>
              </label>
              <label class="row">
                <div>
                  <span class="label">Reopen terminals</span>
                  <span class="hint">Opening a repository brings back its terminal tabs: fresh shells in the same folders, names and splits.</span>
                </div>
                <input v-model="prefs.restoreTerminals.value" type="checkbox" class="switch" />
              </label>
              <label class="row">
                <div>
                  <span class="label">Shell</span>
                  <span class="hint">For new terminals. Leave empty for your login shell.</span>
                </div>
                <input v-model.trim="prefs.shell.value" type="text" placeholder="$SHELL" spellcheck="false" autocomplete="off" />
              </label>
            </section>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  width: min(740px, calc(100vw - 48px));
  /* A fixed height, so switching pages doesn't make the window jump. */
  height: min(580px, calc(100vh - 80px));
}
.main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.tabs-nav {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  width: 170px;
  padding: 10px 8px;
  border-right: 1px solid var(--border);
}
.tabs-nav button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  color: var(--fg-muted);
  font-size: 12.5px;
  text-align: left;
}
.tabs-nav button.on {
  background: var(--selected);
  color: var(--fg);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 12px 20px;
  border-bottom: 1px solid var(--border);
}
h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.body {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 6px 20px 20px;
}
.row.ai {
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--hover);
}
.past {
  max-height: 200px;
  margin: 8px 0;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  list-style: none;
}
.past li {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 4px 0 10px;
  font-size: 12.5px;
}
.past li + li {
  border-top: 1px solid var(--border);
}
.past .repo {
  flex: none;
  color: var(--fg-muted);
  font-weight: 600;
}
.past .what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.past .when {
  flex: none;
  color: var(--fg-faint);
  font-size: 11px;
}
.past .icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--fg-faint);
}
.past .icon-btn:hover,
.danger {
  color: var(--del);
}
section + section {
  margin-top: 6px;
}
/* Each page's title. */
h3 {
  margin: 12px 0 6px;
  color: var(--fg);
  font-size: 14px;
  font-weight: 600;
}
h4 {
  margin: 22px 0 4px;
  color: var(--fg);
  font-size: 12.5px;
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.row > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.label {
  font-size: 12.5px;
}
.row.off .label {
  color: var(--fg-faint);
}
.hint {
  color: var(--fg-faint);
  font-size: 11.5px;
}
.row select,
.row input[type='text'] {
  width: 200px;
}
.number {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg-muted);
  font: 11.5px var(--mono);
}
.number input {
  width: 140px;
  accent-color: var(--accent);
}
.value {
  min-width: 38px;
  text-align: right;
}
.reset {
  height: 24px;
  padding: 0 8px;
  font-size: 11.5px;
}
.segmented {
  display: flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--input-bg);
}
.segmented button {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
}
.segmented button.on {
  background: var(--pill);
  box-shadow: inset 0 0 0 1px var(--hover);
  color: var(--fg);
}
/* A plain checkbox drawn as a switch. */
.switch {
  position: relative;
  flex: none;
  width: 30px;
  height: 18px;
  margin: 0;
  border-radius: 9px;
  background: var(--pill);
  box-shadow: inset 0 0 0 1px var(--border-strong);
  appearance: none;
  transition: background 0.15s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--fg-muted);
  transition:
    transform 0.15s,
    background 0.15s;
}
.switch:checked {
  background: var(--accent);
}
.switch:checked::after {
  background: var(--accent-fg);
  transform: translateX(12px);
}
</style>
