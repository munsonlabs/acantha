import { ref, watch, type Ref } from 'vue'

const PREFIX = 'acantha:'

/**
 * A ref backed by localStorage. Falls back to `initial` when storage is unavailable. `sync`: Acantha's other windows
 * (a popped-out Claude) change it too, so a change there is taken up here rather than written over.
 */
export function usePersisted<T>(key: string, initial: T, { sync = false } = {}): Ref<T> {
  let value = initial
  try {
    const stored = localStorage.getItem(PREFIX + key)
    if (stored != null) value = JSON.parse(stored) as T
  } catch {}

  const state = ref(value) as Ref<T>
  if (sync)
    window.addEventListener('storage', (e) => {
      if (e.key !== PREFIX + key || e.newValue == null) return
      try {
        state.value = JSON.parse(e.newValue) as T
      } catch {}
    })
  watch(
    state,
    (v) => {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(v))
      } catch {}
    },
    { deep: true },
  )
  return state
}
