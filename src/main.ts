import { createApp } from 'vue'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import { replaceNativeMenu } from './composables/useContextMenu'
import './styles/main.css'

replaceNativeMenu()
// The same page serves Acantha's main window and its Claude windows; each loads only its own code.
const claude = new URLSearchParams(location.search).get('window') === 'claude'
void (claude ? import('./claude/ClaudeApp.vue') : import('./App.vue')).then(({ default: Root }) => createApp(Root).mount('#app'))
