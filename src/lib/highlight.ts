export interface Token {
  content: string
  style?: Record<string, string>
}

/** Above this, files render as plain text: highlighting would take longer than it is worth. */
const MAX_HIGHLIGHT = 300_000

const FILENAMES: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile', 'cargo.lock': 'toml', '.gitignore': 'text' }

/**
 * Shiki's core with its JavaScript regex engine, rather than the full bundle: that one brings the Oniguruma WebAssembly
 * engine, megabytes held for as long as the app runs. Languages load the first time a file needs them.
 */
let highlighter: Promise<import('shiki/core').HighlighterCore> | null = null
let langs: Promise<typeof import('shiki/langs')> | null = null

const loadHighlighter = () =>
  (highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import('shiki/core'), import('shiki/engine/javascript')])
    return createHighlighterCore({
      // Forgiving: a pattern the engine can't handle is skipped rather than failing the whole file.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [],
    })
  })())

export async function languageFor(path: string) {
  const { bundledLanguages } = await (langs ??= import('shiki/langs'))
  const name = path.split('/').pop()!.toLowerCase()
  if (FILENAMES[name]) return FILENAMES[name]
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return ext in bundledLanguages ? ext : 'text'
}

/** Splits source into lines of coloured tokens, with both light and dark theme colours as CSS variables. */
export async function tokenize(code: string, path: string): Promise<Token[][]> {
  const lang = await languageFor(path)
  if (lang === 'text' || code.length > MAX_HIGHLIGHT) return code.split('\n').map((content) => [{ content }])
  const [h, { bundledLanguages }] = await Promise.all([loadHighlighter(), (langs ??= import('shiki/langs'))])
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages])
  const tokens = h.codeToTokens(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false }).tokens
  return tokens.map((line) => line.map((t) => ({ content: t.content, style: t.htmlStyle })))
}
