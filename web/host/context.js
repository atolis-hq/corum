/* Plugin context: the `ctx` object handed to a page's mount(el, ctx), kept live by the host. */

function toSearchParams(params) {
  if (params instanceof URLSearchParams) return new URLSearchParams(params)
  if (Array.isArray(params)) return new URLSearchParams(params)
  return new URLSearchParams(Object.entries(params ?? {}).filter(([, value]) => value != null))
}

/*
 * env:   { registry, owningRoot, hrefForNode, hrefForAction, matchKeysFor, navigate, buildRoute, fetchImpl?, pluginId, pageId }
 * state: { route, viewingRef, templates, revision, nodes, templatesByName }  (nodes/templatesByName stay host-side;
 *        revision is the host's data revision, bumped on every graph reload)
 * Returns { ctx, update(nextState) }. ctx fields are getters over the latest state, so the same object
 * stays valid for the life of a mount; subscribe() reports changes to route, viewingRef, templates and revision.
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

  const linkOf = (key, entry, href, icon) => ({ key, pluginId: entry.pluginId, id: entry.id, label: entry.label ?? entry.title, icon, href })

  /* Quick-link and "Open in" menu entries for a node; a child node resolves through its owning root. */
  function nodeLinks(id) {
    const root = env.owningRoot(id, lookupNodes())
    const keys = root ? env.matchKeysFor(root.template, state.templatesByName ?? new Map()) : []
    const branch = state.viewingRef
    const claimants = env.registry.claimants(keys)
    const actions = env.registry.nodeActionsFor(keys)
    const actionLink = action => linkOf(`${action.pluginId}/${action.id}`, action, env.hrefForAction(action, id, { branch }), action.icon ?? null)
    return {
      quick: {
        header: actions.filter(action => action.quick.includes('header')).map(actionLink),
        relations: actions.filter(action => action.quick.includes('relations')).map(actionLink),
      },
      menu: {
        defaultHref: claimants.length > 0 ? env.buildRoute({ pathname: '/node', params: { id }, branch }) : null,
        destinations: claimants.map(claim => linkOf(
          `${claim.pluginId}/${claim.id}`,
          claim,
          env.hrefForNode(env.registry, id, keys, { branch, via: claim.pluginId, page: claim.id }),
          claim.icon ?? null,
        )),
        actions: actions.filter(action => action.menu).map(actionLink),
      },
    }
  }

  const ctx = {
    get route() { return state.route },
    get params() { return state.route.params },
    get branch() { return state.route.branch },
    get viewingRef() { return state.viewingRef },
    get templates() { return state.templates },
    get revision() { return state.revision ?? 0 },
    api: { get },
    navigate: hash => env.navigate(hash),
    hrefForNode,
    nodeLinks,
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
    const changed = next.route !== state.route || next.viewingRef !== state.viewingRef || next.templates !== state.templates || (next.revision ?? 0) !== (state.revision ?? 0)
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
