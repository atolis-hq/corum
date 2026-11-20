/* Node link resolution: which page should open a node (pure, no DOM). */

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
function buildHref(pathname, id, branch) {
  const query = `?${new URLSearchParams({ id })}`
  return branch ? `#/${encodeURIComponent(branch)}${pathname}${query}` : `#${pathname}${query}`
}

export function hrefForNode(registry, nodeId, matchKeys, { branch, via, page } = {}) {
  const target = resolveNodeTarget(registry, matchKeys, { via, page })
  const pathname = target.kind === 'page' ? `/p/${target.pluginId}/${target.pageId}` : '/node'
  return buildHref(pathname, nodeId, branch)
}
