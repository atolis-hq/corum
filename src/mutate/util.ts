import type { Diagnostic, Edge, Graph } from '../schema/index.js'

/** Timestamp convention for mutated nodes (matches adapter mappers: date-only ISO). */
export function mutationTimestamp(): string {
  return new Date().toISOString().split('T')[0]
}

export function mutationDiagnostic(
  severity: Diagnostic['severity'],
  message: string,
  nodeId?: string,
): Diagnostic {
  return { severity, file: '<mutation>', ...(nodeId !== undefined && { nodeId }), message }
}

/**
 * IDs of a node's owned subtree (the node itself plus every exact-segment
 * descendant — `orders.x` never matches `orders.xy`).
 */
export function collectSubtreeIds(graph: Graph, rootId: string): string[] {
  const prefix = `${rootId}.`
  const ids: string[] = []
  for (const id of graph.nodesById.keys()) {
    if (id === rootId || id.startsWith(prefix)) ids.push(id)
  }
  return ids
}

/** Every edge touching any of the given IDs (exact endpoint match), deduplicated. */
export function collectEdgesTouching(graph: Graph, ids: Iterable<string>): Edge[] {
  const edges = new Set<Edge>()
  for (const id of ids) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) edges.add(edge)
    for (const edge of graph.edgesByTo.get(id) ?? []) edges.add(edge)
  }
  return [...edges]
}

export function removeEdgeFromIndexes(graph: Graph, edge: Edge): void {
  removeFromBucket(graph.edgesByFrom, edge.from, edge)
  removeFromBucket(graph.edgesByTo, edge.to, edge)
}

export function insertEdgeIntoIndexes(graph: Graph, edge: Edge): void {
  const from = graph.edgesByFrom.get(edge.from) ?? []
  from.push(edge)
  graph.edgesByFrom.set(edge.from, from)

  const to = graph.edgesByTo.get(edge.to) ?? []
  to.push(edge)
  graph.edgesByTo.set(edge.to, to)
}

export function findEdgeById(graph: Graph, edgeId: string): Edge | undefined {
  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) {
      if (edge.id === edgeId) return edge
    }
  }
  return undefined
}

function removeFromBucket(index: Map<string, Edge[]>, key: string, edge: Edge): void {
  const bucket = index.get(key)
  if (!bucket) return
  const remaining = bucket.filter(e => e !== edge)
  if (remaining.length === 0) index.delete(key)
  else index.set(key, remaining)
}
