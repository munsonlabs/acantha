<script setup lang="ts">
import { overlays, ZOOM_MAX, ZOOM_MIN } from '@/composables/commands'
import { prefs } from '@/composables/prefs'
import { useWorkspaces } from '@/composables/workspace'
import Icon from './Icon.vue'

const { active } = useWorkspaces()
const open = overlays.settings

const EDITORS = ['', 'Visual Studio Code', 'Cursor', 'Zed', 'Sublime Text', 'TextEdit']

// Remote branches change what the log contains, so the graph reloads.
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
        <div class="body">
          <section>
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

          <section>
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

          <section>
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

          <section>
            <h3>Editor</h3>
            <label class="row">
              <span class="label">Vim key bindings</span>
              <input v-model="prefs.editorVim.value" type="checkbox" class="switch" />
            </label>
            <label class="row">
              <span class="label">Open files with</span>
              <select v-model="prefs.externalEditor.value">
                <option v-for="app in EDITORS" :key="app" :value="app">{{ app || 'Default app' }}</option>
              </select>
            </label>
          </section>

          <section>
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
                <span class="label">Shell</span>
                <span class="hint">For new terminals. Leave empty for your login shell.</span>
              </div>
              <input v-model.trim="prefs.shell.value" type="text" placeholder="$SHELL" spellcheck="false" autocomplete="off" />
            </label>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
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
  overflow: auto;
  padding: 6px 20px 20px;
}
section + section {
  margin-top: 6px;
}
h3 {
  margin: 16px 0 4px;
  color: var(--fg-faint);
  font-size: 11.5px;
  font-weight: 550;
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
