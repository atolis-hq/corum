import type { Diagnostic, Edge, Graph } from '../schema/index.js'
import type { IdResolver } from './id-map.js'
import { isStructuralEdgeType } from '../graph/index.js'

function removeFromIndex(index: Map<string, Edge[]>, key: string, id: string): void {
  const next = (index.get(key) ?? []).filter(edge => edge.id !== id)
  if (next.length === 0) index.delete(key)
  else index.set(key, next)
}

function addToIndex(index: Map<string, Edge[]>, key: string, edge: Edge): void {
  index.set(key, [...(index.get(key) ?? []), edge])
}

/**
 * Retry every pending edge in the graph, whichever source owns it, against the
 * current nodes, persisted source IDs and this run's ID maps. A resolved
 * endpoint is rewritten to the real node ID (so the edge ID changes) and its
 * `pending` entry is dropped; the edge keeps its notes, provenance and owner.
 * If the resolved edge ID already exists the existing edge wins (one edge per
 * relationship) and a warning names both.
 */
export function resolvePendingEdges(
  graph: Graph,
  resolver: IdResolver,
  live: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  const all = new Map<string, Edge>()
  for (const edges of graph.edgesByFrom.values()) for (const edge of edges) all.set(edge.id, edge)

  for (const edge of [...all.values()]) {
    const before = edge.pending
    if (before === undefined || edge.generated || isStructuralEdgeType(graph, edge.type)) continue

    const settle = (side: 'from' | 'to'): string | undefined => {
      if (before[side] === undefined) return edge[side]
      const current = edge[side]
      if (live.has(current)) return current
      const res = resolver.resolve(current)
      return res.kind === 'resolved' ? res.target : undefined
    }
    const from = settle('from')
    const to = settle('to')
    const pending: NonNullable<Edge['pending']> = {}
    if (before.from !== undefined && from === undefined) pending.from = before.from
    if (before.to !== undefined && to === undefined) pending.to = before.to
    const nextFrom = from ?? edge.from
    const nextTo = to ?? edge.to
    const stillPending = pending.from !== undefined || pending.to !== undefined
    if (nextFrom === edge.from && nextTo === edge.to && pending.from === before.from && pending.to === before.to) continue

    const { pending: _old, ...rest } = edge
    const next: Edge = {
      ...rest,
      from: nextFrom,
      to: nextTo,
      id: `${nextFrom}__${edge.type}__${nextTo}`,
      ...(stillPending && { pending }),
    }
    removeFromIndex(graph.edgesByFrom, edge.from, edge.id)
    removeFromIndex(graph.edgesByTo, edge.to, edge.id)
    all.delete(edge.id)
    const existing = all.get(next.id)
    if (existing !== undefined && existing.state === 'removed' && edge.state !== 'removed') {
      // The relationship was only stored as a removed copy: the live pending edge replaces it.
      removeFromIndex(graph.edgesByFrom, existing.from, existing.id)
      removeFromIndex(graph.edgesByTo, existing.to, existing.id)
      all.delete(next.id)
    }
    if (all.has(next.id)) {
      diagnostics.push({
        severity: 'warning',
        file: edge.corum?.ownership?.source ?? '',
        message: `Pending edge ${edge.id} now resolves to ${next.id}, which already exists; keeping the existing edge and dropping the pending one`,
      })
      continue
    }
    addToIndex(graph.edgesByFrom, next.from, next)
    addToIndex(graph.edgesByTo, next.to, next)
    all.set(next.id, next)
  }
}
