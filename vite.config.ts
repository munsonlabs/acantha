import { defineConfig } from 'vite-plus'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const host = process.env.TAURI_DEV_HOST
const ignorePatterns = ['**/dist/**', '**/node_modules/**', 'src-tauri/**']

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  // Tauri prints its own output and expects the dev server on a fixed port.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'safari16',
    outDir: 'dist',
    // xterm.js is most of the bundle, and it loads from disk.
    chunkSizeWarningLimit: 1500,
  },
  fmt: {
    singleQuote: true,
    semi: false,
    trailingComma: 'all',
    tabWidth: 2,
    printWidth: 150,
    ignorePatterns,
  },
  lint: {
    ignorePatterns,
    rules: {
      'no-unused-vars': ['warn'],
      'typescript/unbound-method': 'off',
      'typescript/no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
    options: { typeAware: true, typeCheck: true },
  },
  staged: {
    '*': 'vp check --fix',
  },
})
