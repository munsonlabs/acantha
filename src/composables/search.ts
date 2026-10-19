import { computed, ref, watch } from 'vue'
import type { Repo } from './repo'
import type { Reveal } from './reveal'

export function createSearch({ rows, refsByHash }: Repo, { revealRow }: Reveal) {
  const query = ref('')
  const index = ref(0)

  const matches = computed(() => {
    const q = query.value.trim().toLowerCase()
    if (!q) return []
    const found: number[] = []
    rows.value.forEach((c, i) => {
      const refs = refsByHash.value.get(c.hash)
      const names = refs ? [...refs.branches.map((b) => b.name), ...refs.remotes.map((r) => `${r.remote}/${r.name}`), ...refs.tags] : []
      const haystack = [c.subject, c.hash, c.author, c.email, ...names].join('\n').toLowerCase()
      if (haystack.includes(q)) found.push(i)
    })
    return found
  })

  const matchSet = computed(() => new Set(matches.value))
  const current = computed(() => matches.value[index.value] ?? -1)

  watch(query, () => {
    index.value = 0
    revealRow(current.value)
  })

  function step(delta: number) {
    const n = matches.value.length
    if (!n) return
    index.value = (index.value + delta + n) % n
    revealRow(current.value)
  }

  return { query, index, matches, matchSet, current, step }
}
