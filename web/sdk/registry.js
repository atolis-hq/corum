/* Plugin registry: pure bookkeeping of plugins and their contributions (no DOM). */

const DEFAULT_ORDER = 100

function buildPageEntry(plugin, page) {
  return {
    pluginId: plugin.id,
    id: page.id,
    title: page.title,
    icon: page.icon ?? null,
    order: page.order ?? DEFAULT_ORDER,
    opens: page.opens ?? [],
    mount(el, ctx) {
      let cancelled = false
      let dispose = null
      plugin.load()
        .then(mod => {
          if (cancelled) return
          const fn = mod[page.mount]
          if (typeof fn !== 'function') throw new Error(`Plugin "${plugin.id}" has no export "${page.mount}"`)
          const result = fn(el, ctx)
          dispose = typeof result === 'function' ? result : null
        })
        .catch(error => {
          if (typeof ctx?.onError === 'function') ctx.onError(error)
          else console.error(`Plugin "${plugin.id}" failed to mount page "${page.id}"`, error)
        })
      return () => {
        cancelled = true
        if (dispose) {
          const fn = dispose
          dispose = null
          fn()
        }
      }
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
  }
}

export function createRegistry() {
  const entries = []

  const enabled = () => entries.filter(entry => entry.status === 'enabled')
  const allPages = () => enabled().flatMap(entry =>
    (entry.manifest?.contributes?.pages ?? []).map(page => buildPageEntry(entry, page)))

  return {
    registerPlugin(entry) {
      entries.push(entry)
    },
    plugins() {
      return [...entries]
    },
    pages() {
      return allPages().sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    },
    findPage(pluginId, pageId) {
      return allPages().find(page => page.pluginId === pluginId && page.id === pageId) ?? null
    },
    claimants(matchKeys) {
      const keys = new Set(matchKeys)
      return allPages().filter(page => page.opens.some(key => keys.has(key)))
    },
    nodeActionsFor(matchKeys) {
      const keys = new Set(matchKeys)
      return enabled()
        .flatMap(entry => (entry.manifest?.contributes?.nodeActions ?? []).map(action => buildActionEntry(entry, action)))
        .filter(action => action.appliesTo.some(key => keys.has(key)))
    },
  }
}
