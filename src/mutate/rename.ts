import type { Diagnostic, Edge, Graph } from '../schema/index.js'
import { validateSegment } from '../loader/id-grammar.js'
import { buildAliasMap } from './alias.js'
import { MutationError } from './errors.js'
import {
  collectEdgesTouching,
  insertEdgeIntoIndexes,
  mutationDiagnostic,
  mutationTimestamp,
  removeEdgeFromIndexes,
} from './util.js'

export type RenameResult = {
  newId: string
  warnings: Diagnostic[]
}

/**
 * Trail threshold (design §4/§14c): a rename or delete records a trail iff
 * the node's ID exists in the default branch's committed graph. The explicit
 * `record_trail` override always wins. `defaultBranchIds` is captured once at
 * session start by the caller.
 */
export function shouldRecordTrail(
  defaultBranchIds: Set<string>,
  nodeId: string,
  override?: boolean,
): boolean {
  if (override !== undefined) return override
  return defaultBranchIds.has(nodeId)
}

/** Replace the last dot-separated segment of an ID. */
export function replaceLastSegment(id: string, newName: string): string {
  const dot = id.lastIndexOf('.')
  return dot === -1 ? newName : id.slice(0, dot + 1) + newName
}

/**
 * First-class rename (design §3, §14a). Rewrites the node ID, every
 * descendant ID (exact-segment prefix), parentId fields, and every edge
 * endpoint referencing an affected ID; optionally records the trail
 * (`corum.identity.previousIds` + `renamed-from` edge). Validates everything before the
 * first write — a thrown MutationError leaves the graph untouched.
 */
export function renameNode(
  graph: Graph,
  oldId: string,
  newName: string,
  recordTrail: boolean,
): RenameResult {
  const warnings: Diagnostic[] = []

  // -- Step 1: validate (pure reads only) ----------------------------------
  const errors: Diagnostic[] = []

  const node = graph.nodesById.get(oldId)
  if (!node) {
    throw new MutationError([mutationDiagnostic('error', `cannot rename: node not found: ${oldId}`, oldId)])
  }

  const segmentError = validateSegment(newName)
  if (segmentError) {
    errors.push(mutationDiagnostic('error', `cannot rename ${oldId}: ${segmentError}`, oldId))
    throw new MutationError(errors)
  }

  const newId = replaceLastSegment(oldId, newName)
  if (newId === oldId) {
    throw new MutationError([mutationDiagnostic('error', `cannot rename ${oldId}: new name equals current name`, oldId)])
  }

  const newPrefix = `${newId}.`
  for (const id of graph.nodesById.keys()) {
    if (id === newId || id.startsWith(newPrefix)) {
      errors.push(mutationDiagnostic('error', `cannot rename ${oldId} to ${newId}: node ${id} already exists`, oldId))
    }
  }
  if (errors.length > 0) throw new MutationError(errors)

  const aliasMap = buildAliasMap(graph)
  if (aliasMap.has(newId)) {
    warnings.push(mutationDiagnostic(
      'warning',
      `new id ${newId} is a retired id (previously renamed to ${aliasMap.get(newId)}); the live node wins for resolution`,
      newId,
    ))
  }

  // -- Step 2: build the id map (node + exact-segment descendants) ---------
  const oldPrefix = `${oldId}.`
  const idMap = new Map<string, string>()
  idMap.set(oldId, newId)
  for (const id of graph.nodesById.keys()) {
    if (id.startsWith(oldPrefix)) idMap.set(id, newId + id.slice(oldId.length))
  }

  // -- Step 3: collect affected edges (exact endpoint match) ---------------
  const affectedEdges = collectEdgesTouching(graph, idMap.keys())

  // -- Step 4: apply --------------------------------------------------------
  // 4a. Remove affected edges from BOTH indexes before any rewrite — an edge
  //     with only its `to` rewritten still moves bucket in edgesByTo.
  for (const edge of affectedEdges) removeEdgeFromIndexes(graph, edge)

  // 4b. Rewrite node IDs and parentIds.
  const timestamp = mutationTimestamp()
  for (const [from, to] of idMap) {
    const moved = graph.nodesById.get(from)!
    graph.nodesById.delete(from)
    moved.id = to
    if (moved.parentId !== undefined) {
      const rewrittenParent = idMap.get(moved.parentId)
      if (rewrittenParent !== undefined) moved.parentId = rewrittenParent
    }
    moved.lastModifiedAt = timestamp
    graph.nodesById.set(to, moved)
  }

  // 4c. Rewrite edge endpoints, recompute IDs, reinsert. Explicit edges keep
  //     their properties, state, and stability; structural edges are
  //     endpoint-rewritten too (equivalent to regeneration from ownership).
  for (const edge of affectedEdges) {
    edge.from = idMap.get(edge.from) ?? edge.from
    edge.to = idMap.get(edge.to) ?? edge.to
    edge.id = `${edge.from}__${edge.type}__${edge.to}`
    insertEdgeIntoIndexes(graph, edge)
  }

  // -- Step 5: trail (after step 4 so the new edge is not itself rewritten) -
  if (recordTrail) {
    const previous = Array.isArray(node.corum?.identity?.previousIds)
      ? [...node.corum.identity.previousIds]
      : []
    previous.push(oldId)
    node.corum = { ...(node.corum ?? {}), identity: { ...(node.corum?.identity ?? {}), previousIds: previous } }

    const trailEdge: Edge = {
      id: `${newId}__renamed-from__${oldId}`,
      from: newId,
      to: oldId,
      type: 'renamed-from',
      state: 'proposed',
      stability: 'unstable',
    }
    insertEdgeIntoIndexes(graph, trailEdge)
  }

  // -- Step 6: rename-back pruning ------------------------------------------
  // Invariants: previousIds never contains the current ID; no renamed-from
  // edge is a self-loop (step 4c may have produced one by rewriting the old
  // trail edge whose `from` was the restored identity).
  if (Array.isArray(node.corum?.identity?.previousIds)) {
    const pruned = node.corum.identity.previousIds.filter(name => name !== newId)
    if (pruned.length === 0) {
      if (node.corum?.identity) delete node.corum.identity.previousIds
      if (node.corum?.identity && Object.keys(node.corum.identity).length === 0) delete node.corum.identity
      if (node.corum && Object.keys(node.corum).length === 0) delete node.corum
    } else {
      node.corum = { ...(node.corum ?? {}), identity: { ...(node.corum?.identity ?? {}), previousIds: pruned } }
    }
  }
  for (const edge of [...(graph.edgesByFrom.get(newId) ?? [])]) {
    if (edge.type === 'renamed-from' && edge.to === newId) removeEdgeFromIndexes(graph, edge)
  }

  return { newId, warnings }
}
