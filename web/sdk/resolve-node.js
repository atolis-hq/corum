/* Node link resolution: which page should open a node (pure, no DOM). */

/**
 * The cluster root that owns a node, as { id, template }. Uses server-supplied
 * rootId/rootTemplate when present (survives nodes hidden from the list, e.g. core
 * templates), otherwise walks parentId over the known nodes. Null if unknown.
 */
export function owningRoot(id, nodesById) {
  const start = nodesById.get(id)
  if (!start) return null
  if (start.rootId && start.rootTemplate) return { id: start.rootId, template: start.rootTemplate }
  let node = start
  const seen = new Set()
  while (node?.parentId && !seen.has(node.id)) {
    seen.add(node.id)
    const parent = nodesById.get(node.parentId)
    if (!parent) break
    node = parent
  }
  return { id: node.id, template: node.template }
}

export function resolveNodeTarget(registry, matchKeys, opts = {}) {
  if (opts.via) {
    // Direct link (ADR-010 5a): skips resolution, so the page need not claim the node.
    const chosen = opts.page
      ? registry.findPage(opts.via, opts.page)
      : registry.pages().find(page => page.pluginId === opts.via)
    return chosen ? { kind: 'page', pluginId: chosen.pluginId, pageId: chosen.id } : { kind: 'generic' }
  }
  const claimants = registry.claimants(matchKeys)
  if (claimants.length === 0) return { kind: 'generic' }
  if (claimants.length === 1) {
    return { kind: 'page', pluginId: claimants[0].pluginId, pageId: claimants[0].id }
  }
  return { kind: 'chooser', claimants }
}

// Mirrors buildRoute() in web/router.js (a classic script, so not importable here).
function buildHref(pathname, id, branch, param = 'id') {
  const query = `?${new URLSearchParams({ [param]: id })}`
  return branch ? `#/${encodeURIComponent(branch)}${pathname}${query}` : `#${pathname}${query}`
}

export function hrefForNode(registry, nodeId, matchKeys, { branch, via, page } = {}) {
  const target = resolveNodeTarget(registry, matchKeys, { via, page })
  const pathname = target.kind === 'page' ? `/p/${target.pluginId}/${target.pageId}` : '/node'
  return buildHref(pathname, nodeId, branch)
}

/** Link for a node action (registry.nodeActionsFor entry) applied to a node: `#/<branch?>/p/<plugin>/<page>?<param>=<id>`. */
export function hrefForAction(action, nodeId, { branch } = {}) {
  return buildHref(`/p/${action.pluginId}/${action.page}`, nodeId, branch, action.param ?? 'id')
}

/** Link to the host's built-in node page (the Explorer view); `view=explorer` stops it redirecting to a claimant plugin page. */
export function hrefForExplorerView(nodeId, { branch } = {}) {
  const query = `?${new URLSearchParams({ id: nodeId, view: 'explorer' })}`
  return branch ? `#/${encodeURIComponent(branch)}/node${query}` : `#/node${query}`
}

/** True when the page exists in an enabled plugin (host chrome should not link to pages that are not there). */
export function isPageAvailable(registry, pluginId, pageId) {
  return registry.findPage(pluginId, pageId) !== null
}
