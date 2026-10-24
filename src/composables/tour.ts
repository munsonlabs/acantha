import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parseTour, type Stop } from '@/lib/tour'
import type { Files } from './files'
import { prefs } from './prefs'
import type { Repo } from './repo'
import { showToast } from './useToast'
import { usePersisted } from './usePersisted'

interface Tour {
  stops: Stop[]
  at: number
  focus?: string
}

/** Each repository's last tour, and where in it you were, to carry on with. */
const tours = usePersisted<Record<string, Tour>>('tours', {})

/**
 * A guided tour of the repository: Claude Code plans the stops (see src-tauri/src/tour.rs), then the editor walks
 * through them, one at a time, each showing its file at its lines, with what to know about them.
 */
export function createTour({ repo }: Repo, files: Files) {
  const planning = ref(false)
  /** Showing now: the tour's card is up. */
  const showing = ref(false)

  const current = () => (repo.value ? tours.value[repo.value] : undefined)
  const save = (t: Tour | null) => {
    const path = repo.value
    if (!path) return
    const rest = { ...tours.value }
    if (t) rest[path] = t
    else delete rest[path]
    tours.value = rest
  }

  /** Shows a stop: its file, at its first line. */
  function go(at: number) {
    const t = current()
    if (!t?.stops.length) return
    const i = Math.min(Math.max(at, 0), t.stops.length - 1)
    save({ ...t, at: i })
    showing.value = true
    const stop = t.stops[i]
    void files.open(stop.file, undefined, null, stop.start)
  }

  /** Plans a new tour (optionally about `focus`), then starts it. Takes half a minute or so. */
  async function start(focus?: string) {
    const path = repo.value
    if (!path || planning.value) return
    planning.value = true
    showing.value = true
    try {
      if (!files.list.value.length) await files.load()
      const answer = await invoke<string>('tour_plan', { repo: path, focus: focus || null, model: prefs.tourModel.value || null })
      const known = new Set(files.list.value)
      const stops = parseTour(answer, (p) => known.has(p))
      if (!stops.length) throw new Error('Claude Code’s tour didn’t name any files in this repository')
      if (repo.value !== path) return
      save({ stops, at: 0, focus })
      go(0)
    } catch (e) {
      showing.value = false
      showToast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      planning.value = false
    }
  }

  /** Puts the tour away; it's kept, to carry on with later. */
  const hide = () => (showing.value = false)
  /** Carries on with the last tour, where you were. */
  const resume = () => go(current()?.at ?? 0)
  /** Done with: forgets it. */
  function end() {
    save(null)
    showing.value = false
  }

  return { planning, showing, current, go, start, hide, resume, end }
}

export type TourState = ReturnType<typeof createTour>
