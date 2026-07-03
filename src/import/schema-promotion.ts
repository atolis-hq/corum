import type { Diagnostic, Edge, Graph } from '../schema/index.js'

/**
 * ADR-009b rule 4: a mechanical prefix rewrite from a previously-inlined
 * schema subtree to the newly-promoted standalone schema subtree.
 */
export interface SchemaPromotion {
  oldPrefix: string
  newPrefix: string
}

/**
 * ADR-009b rule 1 support: index of existing standalone schemas (`{component}.Schema.{name}`)
 * and their field names, used by adapters to reuse-before-inline and to detect shape drift.
 * Schemas marked `removed` are excluded — they are no longer available for reuse.
 */
export function buildExistingSchemaIndex(graph: Graph): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const node of graph.nodesById.values()) {
    const parts = node.id.split('.')
    if (parts.length !== 3 || parts[1] !== 'Schema') continue
    if (node.state === 'removed') continue

    const fields = new Set<string>()
    const prefix = `${node.id}.fields.`
    for (const other of graph.nodesById.values()) {
      if (!other.id.startsWith(prefix)) continue
      if (other.id.slice(prefix.length).includes('.')) continue
      fields.add(other.id.slice(prefix.length))
    }
    index.set(node.id, fields)
  }
  return index
}

/**
 * ADR-009b rule 4: detect inline→standalone promotions produced by this run —
 * a newly created standalone schema (`{C}.Schema.{N}`) that did not exist before
 * this run, matched against any prior inline copy (`{rootId}.schemas.{N}`) under
 * the same component.
 */
export function detectSchemaPromotions(
  priorNodeIds: Set<string>,
  newlyCreatedSchemaIds: Set<string>,
): SchemaPromotion[] {
  const promotions: SchemaPromotion[] = []
  for (const newId of newlyCreatedSchemaIds) {
    if (priorNodeIds.has(newId)) continue
    const [component, , name] = newId.split('.')
    for (const oldId of priorNodeIds) {
      if (oldId.split('.')[0] !== component) continue
      if (oldId.endsWith(`.schemas.${name}`)) {
        promotions.push({ oldPrefix: oldId, newPrefix: newId })
      }
    }
  }
  return promotions
}

/**
 * ADR-009b rule 4: mechanically rewrite every edge endpoint that falls under a
 * promoted schema's old subtree to the new subtree — import-derived and
 * design-derived edges alike. Warns (and leaves the edge untouched) when the
 * rewritten target does not exist in the new subtree.
 */
export function rewritePromotedSchemaEdges(
  graph: Graph,
  promotions: SchemaPromotion[],
  diagnostics: Diagnostic[],
): void {
  if (promotions.length === 0) return

  const allEdges = new Map<string, Edge>()
  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) allEdges.set(edge.id, edge)
  }

  function rewriteEndpoint(id: string): { id: string; changed: boolean; unresolved: boolean } {
    for (const { oldPrefix, newPrefix } of promotions) {
      if (id !== oldPrefix && !id.startsWith(`${oldPrefix}.`)) continue
      const rewritten = newPrefix + id.slice(oldPrefix.length)
      if (!graph.nodesById.has(rewritten)) return { id, changed: false, unresolved: true }
      return { id: rewritten, changed: true, unresolved: false }
    }
    return { id, changed: false, unresolved: false }
  }

  for (const edge of allEdges.values()) {
    const from = rewriteEndpoint(edge.from)
    const to = rewriteEndpoint(edge.to)

    if (from.unresolved || to.unresolved) {
      diagnostics.push({
        severity: 'warning',
        file: '',
        message: `Cannot rewrite edge ${edge.id} for schema promotion — rewritten target does not exist (unresolvable)`,
      })
      continue
    }

    if (!from.changed && !to.changed) continue

    removeEdge(graph, edge)
    const rewritten: Edge = { ...edge, from: from.id, to: to.id, id: `${from.id}__${edge.type}__${to.id}` }
    addEdge(graph, rewritten)
  }
}

function removeEdge(graph: Graph, edge: Edge): void {
  const fromList = graph.edgesByFrom.get(edge.from)
  if (fromList) graph.edgesByFrom.set(edge.from, fromList.filter(e => e.id !== edge.id))
  const toList = graph.edgesByTo.get(edge.to)
  if (toList) graph.edgesByTo.set(edge.to, toList.filter(e => e.id !== edge.id))
}

function addEdge(graph: Graph, edge: Edge): void {
  graph.edgesByFrom.set(edge.from, [...(graph.edgesByFrom.get(edge.from) ?? []), edge])
  graph.edgesByTo.set(edge.to, [...(graph.edgesByTo.get(edge.to) ?? []), edge])
}
