import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref, type WatchSource } from 'vue'

/**
 * One highlight that slides to the active tab, as Terax does, instead of each tab switching its own background.
 * `track` should change whenever the active tab, the tab order or a tab's label does.
 */
export function useSlidingPill(container: Ref<HTMLElement | undefined>, track: WatchSource<unknown>) {
  const style = ref<Record<string, string>>({ opacity: '0' })
  let animate = false

  async function measure() {
    await nextTick()
    const tab = container.value?.querySelector<HTMLElement>(':scope > .active')
    if (!tab) {
      style.value = { opacity: '0' }
      return
    }
    style.value = {
      width: `${tab.offsetWidth}px`,
      transform: `translateX(${tab.offsetLeft}px)`,
      opacity: '1',
      // The first placement, and any after a resize, jump straight there.
      ...(animate ? {} : { transition: 'none' }),
    }
    animate = true
  }

  const observer = new ResizeObserver(() => {
    animate = false
    void measure()
  })
  onMounted(() => {
    void measure()
    if (container.value) observer.observe(container.value)
  })
  onBeforeUnmount(() => observer.disconnect())
  watch(track, () => void measure(), { deep: true })

  return { style, measure }
}

/**
 * Drag-to-reorder for a row of tabs, using pointer events: HTML5 drag and drop is unreliable inside the Tauri webview.
 * A press that doesn't move is still an ordinary click.
 */
export function useTabDrag(container: Ref<HTMLElement | undefined>, move: (from: number, to: number) => void) {
  const dragging = ref<number | null>(null)

  function onPointerDown(e: PointerEvent, index: number) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const startX = e.clientX
    let current = index
    let moved = false

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 5) return
      moved = true
      dragging.value = current
      const tabs = [...(container.value?.querySelectorAll<HTMLElement>(':scope > .tab') ?? [])]
      // The tab under the pointer, judged by which side of its middle the pointer is on.
      const target = tabs.findIndex((tab, i) => {
        const r = tab.getBoundingClientRect()
        return i < current ? ev.clientX < r.left + r.width / 2 : i > current && ev.clientX > r.left + r.width / 2
      })
      if (target !== -1 && target !== current) {
        move(current, target)
        current = target
        dragging.value = target
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dragging.value = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return { dragging, onPointerDown }
}
