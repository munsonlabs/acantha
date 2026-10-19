import { ref, watch, type Ref } from 'vue'

const PREFIX = 'acantha:'

/** A ref backed by localStorage. Falls back to `initial` when storage is unavailable. */
export function usePersisted<T>(key: string, initial: T): Ref<T> {
  let value = initial
  try {
    const stored = localStorage.getItem(PREFIX + key)
    if (stored != null) value = JSON.parse(stored) as T
  } catch {}

  const state = ref(value) as Ref<T>
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
