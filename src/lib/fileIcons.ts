import { shallowRef } from 'vue'

/**
 * File and folder icons from the Catppuccin icon theme, the set Terax uses. The mapping covers what turns up in
 * munsonlabs/packages (Vite, Vue, TypeScript, npm, Docker, Markdown, shell, YAML, media…) plus common languages.
 * The icon JSON is a few hundred kB, so it loads on first use.
 */

interface IconSet {
  icons: Record<string, { body: string }>
  aliases?: Record<string, { parent: string }>
  width?: number
  height?: number
}

/** Exact file names, lowercased. */
const FILE_NAMES: Record<string, string> = {
  'package.json': 'package-json',
  'package-lock.json': 'npm-lock',
  '.npmrc': 'npm',
  '.npmignore': 'npm-ignore',
  '.nvmrc': 'package-json',
  '.node-version': 'package-json',
  'pnpm-lock.yaml': 'pnpm-lock',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'yarn-lock',
  '.yarnrc': 'yarn',
  'bun.lock': 'bun-lock',
  'bun.lockb': 'bun-lock',
  dockerfile: 'docker',
  containerfile: 'docker',
  '.dockerignore': 'docker-ignore',
  '.gitignore': 'git',
  '.gitkeep': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  'pre-commit': 'pre-commit',
  '.editorconfig': 'editorconfig',
  '.stackblitzrc': 'stackblitz',
  '.prettierrc': 'prettier',
  '.prettierignore': 'prettier-ignore',
  '.eslintignore': 'eslint-ignore',
  'cargo.toml': 'cargo',
  'cargo.lock': 'cargo-lock',
  'tauri.conf.json': 'tauri',
  'rustfmt.toml': 'rust-config',
  'build.rs': 'rust',
  makefile: 'makefile',
  '.envrc': 'envrc',
  'todo.md': 'todo',
}

/** Names matched by pattern: config files with variable extensions and families like README.*. */
const FILE_PATTERNS: [RegExp, string][] = [
  [/^vite\.config\.[cm]?[jt]s$/, 'vite'],
  [/^vitest\.(config|workspace)\.[cm]?[jt]s$/, 'vitest'],
  [/^playwright\.config\.[cm]?[jt]s$/, 'playwright'],
  [/^nuxt\.config\.[cm]?[jt]s$/, 'nuxt'],
  [/^tailwind\.config\.[cm]?[jt]s$/, 'tailwind'],
  [/^postcss\.config\.[cm]?[jt]s$/, 'postcss'],
  [/^(\.)?eslint(rc|\.config)/, 'eslint'],
  [/^(\.)?prettier(rc|\.config)/, 'prettier'],
  [/^\.npmrc\./, 'npm'],
  [/^tsconfig.*\.json$/, 'typescript-config'],
  [/^jsconfig.*\.json$/, 'javascript-config'],
  [/^\.env(\..+)?$/, 'env'],
  [/^(docker-)?compose.*\.ya?ml$/, 'docker-compose'],
  // BuildKit's per-Dockerfile ignore files, like Dockerfile.dockerignore, before the Dockerfile.* rule.
  [/\.dockerignore$/, 'docker-ignore'],
  [/^dockerfile\./, 'docker'],
  [/^readme(\..+)?$/, 'readme'],
  [/^(license|licence|copying)(\..+)?$/, 'license'],
  [/^changelog(\..+)?$/, 'changelog'],
  [/^contributing(\..+)?$/, 'contributing'],
  [/^code_of_conduct(\..+)?$/, 'code-of-conduct'],
  [/^security(\..+)?$/, 'security'],
]

/** Extensions without the dot. Compound ones like `d.ts` are tried before the last part. */
const EXTENSIONS: Record<string, string> = {
  'd.ts': 'typescript-def',
  'd.mts': 'typescript-def',
  'd.cts': 'typescript-def',
  'test.ts': 'typescript-test',
  'spec.ts': 'typescript-test',
  'test.js': 'javascript-test',
  'spec.js': 'javascript-test',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript-react',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript-react',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown-mdx',
  txt: 'text',
  log: 'log',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  less: 'less',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'favicon',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4s: 'video',
  m3u8: 'video',
  vtt: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  lock: 'lock',
  rs: 'rust',
  py: 'python',
  go: 'go',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  lua: 'lua',
  sql: 'database',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'proto',
}

/** Folder names, lowercased. Each has a matching `-open` icon. */
const FOLDER_NAMES: Record<string, string> = {
  src: 'folder-src',
  lib: 'folder-lib',
  components: 'folder-components',
  composables: 'folder-composables',
  hooks: 'folder-hooks',
  '.vite-hooks': 'folder-hooks',
  '.husky': 'folder-husky',
  utils: 'folder-utils',
  helpers: 'folder-utils',
  types: 'folder-types',
  styles: 'folder-styles',
  css: 'folder-styles',
  assets: 'folder-assets',
  public: 'folder-public',
  static: 'folder-public',
  images: 'folder-images',
  img: 'folder-images',
  icons: 'folder-svg',
  fonts: 'folder-fonts',
  media: 'folder-video',
  video: 'folder-video',
  audio: 'folder-audio',
  docs: 'folder-docs',
  doc: 'folder-docs',
  test: 'folder-tests',
  tests: 'folder-tests',
  __tests__: 'folder-tests',
  scripts: 'folder-scripts',
  config: 'folder-config',
  buildtools: 'folder-config',
  dist: 'folder-dist',
  build: 'folder-dist',
  out: 'folder-dist',
  node_modules: 'folder-node',
  packages: 'folder-packages',
  apps: 'folder-packages',
  app: 'folder-app',
  examples: 'folder-examples',
  demos: 'folder-examples',
  api: 'folder-api',
  server: 'folder-server',
  client: 'folder-client',
  routes: 'folder-routes',
  views: 'folder-views',
  layouts: 'folder-layouts',
  plugins: 'folder-plugins',
  middleware: 'folder-middleware',
  locales: 'folder-locales',
  containers: 'folder-docker',
  docker: 'folder-docker',
  '.git': 'folder-git',
  '.github': 'folder-github',
  workflows: 'folder-workflows',
  '.vscode': 'folder-vscode',
  'src-tauri': 'folder-tauri',
  temp: 'folder-temp',
  tmp: 'folder-temp',
}

const set = shallowRef<IconSet | null>(null)
let loading: Promise<void> | null = null
const cache = new Map<string, string>()

/** Starts loading the icon set. Icons render as an empty slot of the same size until it arrives. */
export function loadFileIcons() {
  loading ??= import('@iconify-json/catppuccin/icons.json').then(
    (mod) => {
      set.value = (mod.default ?? mod) as IconSet
    },
    () => {
      loading = null
    },
  )
}

function url(name: string): string {
  const s = set.value
  if (!s) return ''
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const body = s.icons[name]?.body ?? s.icons[s.aliases?.[name]?.parent ?? '']?.body
  const result = body
    ? `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width ?? 16} ${s.height ?? 16}">${body}</svg>`)}`
    : ''
  cache.set(name, result)
  return result
}

/** The icon name for a file, given which icons exist. Exact names win, then patterns, then the longest known extension. */
export function fileIconName(path: string, exists: (icon: string) => boolean): string {
  const name = path.split('/').pop()!.toLowerCase()
  const byName = FILE_NAMES[name] ?? FILE_PATTERNS.find(([re]) => re.test(name))?.[1]
  if (byName && exists(byName)) return byName
  // Try the longest extension first, so `foo.d.ts` finds `d.ts` before `ts`.
  let ext = name.includes('.', 1) ? name.slice(name.indexOf('.', 1) + 1) : ''
  while (ext) {
    const icon = EXTENSIONS[ext]
    if (icon && exists(icon)) return icon
    const dot = ext.indexOf('.')
    if (dot === -1) break
    ext = ext.slice(dot + 1)
  }
  return 'file'
}

export function folderIconName(path: string, open: boolean, exists: (icon: string) => boolean): string {
  const icon = FOLDER_NAMES[path.split('/').pop()!.toLowerCase()] ?? 'folder'
  const wanted = open ? `${icon}-open` : icon
  return exists(wanted) ? wanted : open ? 'folder-open' : 'folder'
}

const exists = (icon: string) => !!url(icon)

/** Icon for a file, from its name (a path works too). Empty until the set has loaded. */
export const fileIconUrl = (path: string) => (set.value ? url(fileIconName(path, exists)) : '')

export const folderIconUrl = (path: string, open: boolean) => (set.value ? url(folderIconName(path, open, exists)) : '')

/** For the self-check in the tests: every icon name the maps refer to. */
export const mappedIconNames = () => [
  ...new Set([
    ...Object.values(FILE_NAMES),
    ...FILE_PATTERNS.map(([, icon]) => icon),
    ...Object.values(EXTENSIONS),
    ...Object.values(FOLDER_NAMES).flatMap((f) => [f, `${f}-open`]),
  ]),
]
