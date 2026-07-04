import type { Edge, Graph } from '../schema/index.js'
import { MutationError } from './errors.js'
import { shouldRecordTrail } from './rename.js'
import {
  collectEdgesTouching,
  collectSubtreeIds,
  findEdgeById,
  mutationDiagnostic,
  mutationTimestamp,
  removeEdgeFromIndexes,
} from './util.js'

export type DeleteNodeOptions = {
  /** Force hard delete regardless of the trail threshold. */
  purge?: boolean
  /** Trail override (§6): true forces soft delete, false forces purge. */
  recordTrail?: boolean
}

export type DeleteNodeResult = {
  /** 'soft' set state removed on the subtree; 'hard' removed nodes and edges. */
  tier: 'soft' | 'hard'
  /** IDs of every node in the affected subtree (the node itself first). */
  affectedIds: string[]
}

/**
 * Delete a node and its owned subtree (design §6).
 *
 * Tier resolution: `purge: true` → hard. Otherwise `recordTrail` override
 * wins (true → soft, false → hard); with no override, soft iff the node's ID
 * is in `defaultBranchIds` (the trail threshold, §4), else hard — pure design
 * work leaves no tombstones.
 */
export function deleteNode(
  graph: Graph,
  nodeId: string,
  opts: DeleteNodeOptions = {},
  defaultBranchIds?: Set<string>,
): DeleteNodeResult {
  const node = graph.nodesById.get(nodeId)
  if (!node) {
    throw new MutationError([mutationDiagnostic('error', `cannot delete: node not found: ${nodeId}`, nodeId)])
  }

  const soft = opts.purge === true
    ? false
    : shouldRecordTrail(defaultBranchIds ?? new Set(), nodeId, opts.recordTrail)

  const subtreeIds = collectSubtreeIds(graph, nodeId)
  const timestamp = mutationTimestamp()

  if (soft) {
    for (const id of subtreeIds) {
      const subtreeNode = graph.nodesById.get(id)!
      subtreeNode.state = 'removed'
      subtreeNode.lastModifiedAt = timestamp
    }
    return { tier: 'soft', affectedIds: subtreeIds }
  }

  // Hard delete: remove subtree nodes and every edge touching any removed ID
  // from both indexes — no orphan edges survive.
  for (const edge of collectEdgesTouching(graph, subtreeIds)) {
    removeEdgeFromIndexes(graph, edge)
  }
  for (const id of subtreeIds) graph.nodesById.delete(id)

  return { tier: 'hard', affectedIds: subtreeIds }
}

/** Delete an edge. Always hard — edges carry no subtree (design §6). */
export function deleteEdge(graph: Graph, edgeId: string): Edge {
  const edge = findEdgeById(graph, edgeId)
  if (!edge) {
    throw new MutationError([mutationDiagnostic('error', `cannot delete: edge not found: ${edgeId}`)])
  }
  removeEdgeFromIndexes(graph, edge)
  return edge
}
