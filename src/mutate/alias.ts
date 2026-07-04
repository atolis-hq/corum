import type { Graph } from '../schema/index.js'

/**
 * Alias map built from `renamed-from` trail edges: retired ID → live ID.
 * `edge.from` is the live end; `edge.to` is the retired ID (intentionally
 * dangling — see design §3/§5).
 */
export function buildAliasMap(graph: Graph): Map<string, string> {
  const aliasMap = new Map<string, string>()
  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) {
      if (edge.type === 'renamed-from') aliasMap.set(edge.to, edge.from)
    }
  }
  return aliasMap
}

/**
 * Rewrite `id` when it equals `oldPrefix` or starts with `oldPrefix.` —
 * exact-segment boundary, never plain string prefix (`orders.x` must not
 * match `orders.xy`). Returns null when the prefix does not apply.
 */
export function rewriteIdPrefix(id: string, oldPrefix: string, newPrefix: string): string | null {
  if (id === oldPrefix) return newPrefix
  if (id.startsWith(`${oldPrefix}.`)) return newPrefix + id.slice(oldPrefix.length)
  return null
}

/**
 * Resolve a (possibly retired) ID to a live ID through the alias map.
 * Live node wins outright; exact hits and longest dot-boundary prefix
 * rewrites are applied to fixpoint with a cycle guard. An unresolved ID is
 * returned unchanged — the caller decides what that means (genuinely new
 * node, unknown node, …).
 */
export function resolveAlias(graph: Graph, aliasMap: Map<string, string>, id: string): string {
  const seen = new Set<string>()
  for (;;) {
    if (graph.nodesById.has(id)) return id // live node wins outright
    if (seen.has(id)) return id // cycle guard — give up
    seen.add(id)

    const exact = aliasMap.get(id)
    if (exact !== undefined) {
      id = exact
      continue
    }

    // Longest dot-boundary prefix with a mapping.
    let prefix = id
    let rewritten: string | undefined
    for (;;) {
      const dot = prefix.lastIndexOf('.')
      if (dot === -1) break
      prefix = prefix.slice(0, dot)
      const mapped = aliasMap.get(prefix)
      if (mapped !== undefined) {
        rewritten = mapped + id.slice(prefix.length)
        break
      }
    }
    if (rewritten !== undefined) {
      id = rewritten
      continue
    }

    return id // unresolved — caller decides
  }
}
