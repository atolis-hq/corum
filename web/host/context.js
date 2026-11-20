/* Plugin context: the `ctx` object handed to a page's mount(el, ctx), kept live by the host. */

function toSearchParams(params) {
  if (params instanceof URLSearchParams) return new URLSearchParams(params)
  if (Array.isArray(params)) return new URLSearchParams(params)
  return new URLSearchParams(Object.entries(params ?? {}).filter(([, value]) => value != null))
}

/*
 * env:   { registry, owningRoot, hrefForNode, matchKeysFor, navigate, buildRoute, fetchImpl?, pluginId, pageId }
 * state: { route, viewingRef, templates, nodes, templatesByName }  (nodes/templatesByName stay host-side)
 * Returns { ctx, update(nextState) }. ctx fields are getters over the latest state, so the same object
 * stays valid for the life of a mount; subscribe() reports changes to route, viewingRef and templates.
 */
export function createPluginContext(env, initialState, onError) {
  let state = initialState
  let nodesById = new Map()
  let nodesSource = null
  const listeners = new Set()
  const fetchImpl = env.fetchImpl ?? ((...args) => fetch(...args))

  function lookupNodes() {
    if (state.nodes !== nodesSource) {
      nodesSource = state.nodes
      nodesById = new Map((state.nodes ?? []).map(node => [node.id, node]))
    }
    return nodesById
  }

  async function get(path, params) {
    const url = path.startsWith('/') ? path : `/api/${path}`
    const query = toSearchParams(params)
    if (state.viewingRef && !query.has('ref')) query.append('ref', state.viewingRef)
    const qs = query.toString()
    const response = await fetchImpl(qs ? `${url}?${qs}` : url)
    if (!response.ok) {
      const error = new Error(`GET ${url} failed (${response.status})`)
      error.status = response.status
      throw error
    }
    return response.json()
  }

  function hrefForNode(id, opts = {}) {
    const root = env.owningRoot(id, lookupNodes())
    const keys = root ? env.matchKeysFor(root.template, state.templatesByName ?? new Map()) : []
    return env.hrefForNode(env.registry, id, keys, { branch: state.viewingRef, via: opts.via, page: opts.page })
  }

  const ctx = {
    get route() { return state.route },
    get params() { return state.route.params },
    get branch() { return state.route.branch },
    get viewingRef() { return state.viewingRef },
    get templates() { return state.templates },
    api: { get },
    navigate: hash => env.navigate(hash),
    hrefForNode,
    openNode: (id, opts) => env.navigate(hrefForNode(id, opts)),
    hrefForPage: (params, opts = {}) => env.buildRoute({
      pathname: `/p/${env.pluginId}/${opts.page ?? env.pageId}`,
      params: Object.fromEntries(toSearchParams(params)),
      branch: state.viewingRef,
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    onError,
  }

  function update(next) {
    const changed = next.route !== state.route || next.viewingRef !== state.viewingRef || next.templates !== state.templates
    state = next
    if (!changed) return
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.error(`Plugin "${env.pluginId}" subscriber failed`, error)
      }
    }
  }

  return { ctx, update }
}
