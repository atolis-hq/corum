/* Plugin registry: pure bookkeeping of plugins and their contributions (no DOM). */

const DEFAULT_ORDER = 100

/* Lazily load a plugin's entry module and call one of its exported mount functions; returns the disposer. */
function mountExport(plugin, pageId, exportName, el, ctx) {
  let cancelled = false
  let dispose = null
  plugin.load()
    .then(mod => {
      if (cancelled) return
      const fn = mod[exportName]
      if (typeof fn !== 'function') throw new Error(`Plugin "${plugin.id}" has no export "${exportName}"`)
      const result = fn(el, ctx)
      dispose = typeof result === 'function' ? result : null
    })
    .catch(error => {
      if (typeof ctx?.onError === 'function') ctx.onError(error)
      else console.error(`Plugin "${plugin.id}" failed to mount page "${pageId}"`, error)
    })
  return () => {
    cancelled = true
    if (dispose) {
      const fn = dispose
      dispose = null
      fn()
    }
  }
}

function buildPageEntry(plugin, page) {
  return {
    pluginId: plugin.id,
    id: page.id,
    title: page.title,
    icon: page.icon ?? null,
    order: page.order ?? DEFAULT_ORDER,
    opens: page.opens ?? [],
    nav: page.nav ?? true,
    legacyPaths: page.legacyPaths ?? [],
    sidebar: page.sidebar ?? null,
    nodeSidebar: Boolean(page.sidebar && page.nodeSidebar),
    detail: Boolean(page.sidebar && page.detail),
    mount(el, ctx) {
      return mountExport(plugin, page.id, page.mount, el, ctx)
    },
    mountSidebar(el, ctx) {
      return mountExport(plugin, page.id, page.sidebar, el, ctx)
    },
  }
}

function buildActionEntry(plugin, action) {
  return {
    pluginId: plugin.id,
    id: action.id,
    label: action.label,
    appliesTo: action.appliesTo ?? [],
    page: action.page,
    icon: action.icon ?? null,
    param: action.param ?? 'id',
    menu: action.menu ?? true,
    quick: action.quick ?? [],
  }
}

export function createRegistry() {
  const entries = []

  const enabled = () => entries.filter(entry => entry.status === 'enabled')
  const pagesOf = list => list.flatMap(entry =>
    (entry.manifest?.contributes?.pages ?? []).map(page => buildPageEntry(entry, page)))
  const allPages = () => pagesOf(enabled())
  const byOrder = (a, b) => a.order - b.order || a.title.localeCompare(b.title)

  return {
    registerPlugin(entry) {
      entries.push(entry)
    },
    plugins() {
      return [...entries]
    },
    pages() {
      return allPages().sort(byOrder)
    },
    findPage(pluginId, pageId) {
      return allPages().find(page => page.pluginId === pluginId && page.id === pageId) ?? null
    },
    /* The page whose sidebar panel also accompanies the host's node page, if an enabled plugin declares one. */
    nodeSidebarPage() {
      return allPages().filter(page => page.nodeSidebar).sort(byOrder)[0] ?? null
    },
    /* The page, of any plugin whatever its status, that declares a retired host route as a legacy path:
     * { page, entry }. An enabled claimant beats a disabled one; otherwise the first registered wins. */
    findLegacyPage(pathname) {
      let fallback = null
      for (const entry of entries) {
        const page = pagesOf([entry]).find(candidate => candidate.legacyPaths.includes(pathname))
        if (!page) continue
        if (entry.status === 'enabled') return { page, entry }
        fallback ??= { page, entry }
      }
      return fallback
    },
    claimants(matchKeys) {
      const keys = new Set(matchKeys)
      return allPages().filter(page => page.opens.some(key => keys.has(key)))
    },
    nodeActionsFor(matchKeys) {
      const keys = new Set(matchKeys)
      return enabled()
        .flatMap(entry => (entry.manifest?.contributes?.nodeActions ?? []).map(action => buildActionEntry(entry, action)))
        .filter(action => action.appliesTo.some(key => key === '*' || keys.has(key)))
    },
  }
}
