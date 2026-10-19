import { describe, expect, it } from 'vite-plus/test'
import icons from '@iconify-json/catppuccin/icons.json'
import { fileIconName, folderIconName, mappedIconNames } from './fileIcons'

const has = (name: string) => name in icons.icons || name in (icons.aliases ?? {})

describe('file icons', () => {
  it('only maps to icons that exist in the Catppuccin set', () => {
    expect(mappedIconNames().filter((name) => !has(name))).toEqual([])
  })

  // The file types found in munsonlabs/packages.
  it.each([
    ['vite.config.ts', 'vite'],
    ['vitest.config.ts', 'vitest'],
    ['package.json', 'package-json'],
    ['package-lock.json', 'npm-lock'],
    ['.npmrc', 'npm'],
    ['buildtools/.npmrc.local', 'npm'],
    ['.node-version', 'package-json'],
    ['buildtools/containers/Dockerfile', 'docker'],
    ['docker-compose.yml', 'docker-compose'],
    ['Dockerfile.dockerignore', 'docker-ignore'],
    ['README.md', 'readme'],
    ['AGENTS.md', 'markdown'],
    ['CHANGELOG.md', 'changelog'],
    ['dev.sh', 'bash'],
    ['src/env.d.ts', 'typescript-def'],
    ['player.spec.ts', 'typescript-test'],
    ['App.vue', 'vue'],
    ['tsconfig.json', 'typescript-config'],
    ['.env', 'env'],
    ['LICENSE', 'license'],
    ['.vite-hooks/pre-commit', 'pre-commit'],
    ['captions/bbb-en.vtt', 'video'],
    ['icon.svg', 'svg'],
    ['.github/workflows/ci.yml', 'yaml'],
    ['.stackblitzrc', 'stackblitz'],
    ['prune-previews.mjs', 'javascript'],
    ['notes.unknown', 'file'],
  ])('%s → %s', (path, icon) => {
    expect(fileIconName(path, has)).toBe(icon)
  })

  it('uses named folder icons, with open variants', () => {
    expect(folderIconName('src-tauri', false, has)).toBe('folder-tauri')
    expect(folderIconName('.github', true, has)).toBe('folder-github-open')
    expect(folderIconName('anything-else', true, has)).toBe('folder-open')
  })
})
