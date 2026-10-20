import { createApp } from 'vue'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import App from './App.vue'
import { replaceNativeMenu } from './composables/useContextMenu'
import './styles/main.css'

replaceNativeMenu()
createApp(App).mount('#app')
