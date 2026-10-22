import { defineAsyncComponent, type Component } from 'vue'
import type { PanelTab } from '@/composables/panel'
import type { IconName } from '@/lib/icons'
import { isOn, type FeatureId } from '.'

type Kind = PanelTab['kind']
type TabOf<K extends Kind> = Extract<PanelTab, { kind: K }>

interface PanelTabKind<K extends Kind> {
  feature: FeatureId
  icon: IconName
  /** Loaded the first time a tab of this kind shows, so a feature you don't use costs nothing at startup. */
  component: Component
  props: (tab: TabOf<K>, docked: boolean) => Record<string, unknown>
}

const lazy = (load: () => Promise<{ default: Component }>) => defineAsyncComponent(load)

/** Every kind of panel tab: the feature it belongs to, its icon, and the view that shows it. */
export const PANEL_TABS: { [K in Kind]: PanelTabKind<K> } = {
  slack: {
    feature: 'slack',
    icon: 'message',
    component: lazy(() => import('@/components/SlackView.vue')),
    props: (t, docked) => ({ tabId: t.id, url: t.url, docked }),
  },
  todos: {
    feature: 'todos',
    icon: 'check',
    component: lazy(() => import('@/components/TodoList.vue')),
    props: (t) => ({ tabId: t.id, items: t.items }),
  },
  notes: {
    feature: 'notes',
    icon: 'pencil',
    component: lazy(() => import('@/components/NotesView.vue')),
    props: (t) => ({ tabId: t.id, text: t.text }),
  },
  scripts: { feature: 'scripts', icon: 'play', component: lazy(() => import('@/components/ScriptsView.vue')), props: () => ({}) },
  compare: {
    feature: 'compare',
    icon: 'merge',
    component: lazy(() => import('@/components/CompareView.vue')),
    props: (t) => ({ tabId: t.id, base: t.base, head: t.head, uncommitted: t.uncommitted }),
  },
  github: { feature: 'github', icon: 'cloud', component: lazy(() => import('@/components/GitHubView.vue')), props: (t) => ({ tabId: t.id }) },
  markdown: { feature: 'markdown', icon: 'eye', component: lazy(() => import('@/components/MarkdownPanel.vue')), props: (t) => ({ path: t.path }) },
  readme: { feature: 'readme', icon: 'archive', component: lazy(() => import('@/components/MarkdownPanel.vue')), props: (t) => ({ pkg: t.pkg }) },
}

/** A tab shows while its feature is on; switched off, it's kept, and comes back when the feature does. */
export const tabShown = (t: PanelTab) => isOn(PANEL_TABS[t.kind].feature)

export function tabView(t: PanelTab, docked: boolean) {
  const kind = PANEL_TABS[t.kind] as unknown as PanelTabKind<Kind>
  return { component: kind.component, props: kind.props(t as never, docked), icon: kind.icon }
}
