import { shallowRef } from 'vue'

/** Lets anything ask the commit table to scroll a row into view. */
export function createReveal() {
  const target = shallowRef<{ row: number } | null>(null)
  const revealRow = (row: number) => {
    if (row >= 0) target.value = { row }
  }
  return { target, revealRow }
}

export type Reveal = ReturnType<typeof createReveal>
