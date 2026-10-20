/**
 * Where a name typed in the file browser points, from the folder it's typed in: `x.ts`, `utils/x.ts`, `../x.ts`, or
 * `/x.ts` from the top of the repository. Empty when it doesn't name anything. (The backend still checks it stays
 * inside the repository.)
 */
export function resolveName(dir: string, typed: string) {
  const parts = typed.startsWith('/') ? [] : dir.split('/').filter(Boolean)
  for (const seg of typed.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
