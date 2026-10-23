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

/**
 * A worktree's name: its folder's, or, for one inside the main working tree, its path from there, so a tool's
 * `tests/.build/baseline/src` isn't just `src`.
 */
export function worktreeName(path: string, main: string | undefined) {
  if (main && path.startsWith(`${main}/`)) return path.slice(main.length + 1)
  return path.split('/').pop() || path
}
