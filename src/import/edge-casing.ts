import type { Diagnostic, Edge, Graph } from '../schema/index.js'

/**
 * Import-time fix for cross-source field-casing drift: when dedup drops a
 * secondary adapter's node in favour of an exact-ID match from the primary
 * adapter (e.g. both define `orders.Schema.Money`), any nested children that
 * differ only in casing between the two sources (`fields.Amount` vs
 * `fields.amount`) are *not* considered a collision by dedup — the secondary's
 * child nodes are simply dropped, leaving the secondary's own edges pointing
 * at a field id that no longer exists.
 *
 * This resolves those edges against the final merged node set: an endpoint
 * that fails an exact match is retried case-insensitively, and rewritten to
 * the exact surviving casing when the match is unambiguous. Ambiguous or
 * still-unresolved endpoints are left untouched — they fall through to the
 * existing "edge to/from unresolved node" diagnostic at load time, unchanged
 * from today's behaviour.
 */
export function resolveEdgeCasing(graph: Graph, edges: Edge[], diagnostics: Diagnostic[]): Edge[] {
  const lowerIndex = new Map<string, string[]>()
  for (const id of graph.nodesById.keys()) {
    const lower = id.toLowerCase()
    const list = lowerIndex.get(lower)
    if (list) list.push(id)
    else lowerIndex.set(lower, [id])
  }

  function resolve(endpoint: string): { id: string; changed: boolean } {
    if (graph.nodesById.has(endpoint)) return { id: endpoint, changed: false }
    const candidates = lowerIndex.get(endpoint.toLowerCase())
    if (candidates && candidates.length === 1) return { id: candidates[0], changed: true }
    return { id: endpoint, changed: false }
  }

  return edges.map((edge) => {
    const from = resolve(edge.from)
    const to = resolve(edge.to)
    if (!from.changed && !to.changed) return edge

    diagnostics.push({
      severity: 'warning',
      file: '',
      message: `[INFO] Resolved edge casing mismatch: ${edge.from} -> ${from.id}, ${edge.to} -> ${to.id}`,
    })

    return { ...edge, from: from.id, to: to.id, id: `${from.id}__${edge.type}__${to.id}` }
  })
}
