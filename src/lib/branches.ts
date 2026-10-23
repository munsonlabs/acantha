import type { BranchState } from './git'

/** Untouched this long, a branch is offered for cleaning up too, though not picked to start with. */
export const OLD_DAYS = 90

export type StaleKind = 'merged' | 'gone' | 'old'

/**
 * Which local branches look done with, and why: merged into the base, their remote branch gone (usually deleted once
 * their pull request was merged, squash merges included), or untouched for a long while. Each branch goes in the first
 * that fits; the rest aren't offered.
 */
export function staleBranches(branches: BranchState[], nowSeconds = Date.now() / 1000) {
  const groups: Record<StaleKind, BranchState[]> = { merged: [], gone: [], old: [] }
  for (const b of branches) {
    if (b.merged) groups.merged.push(b)
    else if (b.gone) groups.gone.push(b)
    else if (nowSeconds - b.date > OLD_DAYS * 86_400) groups.old.push(b)
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.date - b.date)
  return groups
}
