export interface Token {
  content: string
  style?: Record<string, string>
}

/** Above this, files render as plain text: highlighting would take longer than it is worth. */
const MAX_HIGHLIGHT = 300_000

const FILENAMES: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile', 'cargo.lock': 'toml', '.gitignore': 'text' }

let shiki: Promise<typeof import('shiki')> | null = null

export async function languageFor(path: string) {
  const { bundledLanguages } = await (shiki ??= import('shiki'))
  const name = path.split('/').pop()!.toLowerCase()
  if (FILENAMES[name]) return FILENAMES[name]
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return ext in bundledLanguages ? ext : 'text'
}

/** Splits source into lines of coloured tokens, with both light and dark theme colours as CSS variables. */
export async function tokenize(code: string, path: string): Promise<Token[][]> {
  const lang = await languageFor(path)
  if (lang === 'text' || code.length > MAX_HIGHLIGHT) return code.split('\n').map((content) => [{ content }])
  const { codeToTokens } = await (shiki ??= import('shiki'))
  const { tokens } = await codeToTokens(code, { lang: lang as never, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false })
  return tokens.map((line) => line.map((t) => ({ content: t.content, style: t.htmlStyle })))
}
