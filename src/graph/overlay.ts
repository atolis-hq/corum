import type {
  BranchDiff,
  BranchDiffWarning,
  BranchGraph,
  BranchOverlay,
  Edge,
  GhostState,
  Graph,
  Node,
  OverlayEdge,
  OverlayNode,
} from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { createAliasResolver, getEdgeTypeDef } from './index.js'

export function computeOverlay(
  viewingRef: string,
  defaultBranch: BranchGraph,
  allBranches: BranchGraph[],
): BranchOverlay {
  const branches = uniqueBranches([defaultBranch, ...allBranches])
  const viewingBranch = branches.find(branch => branch.ref === viewingRef)
  if (!viewingBranch) {
    throw new QueryError(`branch '${viewingRef}' not found in loaded branches`)
  }

  // Foreign IDs resolve through the viewing branch's alias map (design §5/§14b)
  // so a branch still holding a retired ID overlays onto the renamed node.
  const resolve = createAliasResolver(viewingBranch.graph)

  // Per-branch node index keyed by canonical (viewing-resolved) ID.
  const nodeIndexes = new Map<string, Map<string, Node>>()
  const canonicalNodeIds = new Set<string>()
  for (const branch of branches) {
    const index = new Map<string, Node>()
    for (const [id, node] of branch.graph.nodesById) {
      const canonicalId = branch.ref === viewingRef ? id : resolve(id)
      // On collision (branch holds both a retired and its live ID), the node
      // whose literal ID matches the canonical ID wins.
      const existing = index.get(canonicalId)
      if (existing === undefined || node.id === canonicalId) index.set(canonicalId, node)
      canonicalNodeIds.add(canonicalId)
    }
    nodeIndexes.set(branch.ref, index)
  }

  const nodes = new Map<string, OverlayNode>()
  for (const id of canonicalNodeIds) {
    const presence = new Map<string, Node>()
    for (const branch of branches) {
      const node = nodeIndexes.get(branch.ref)?.get(id)
      if (node) presence.set(branch.ref, node)
    }
    nodes.set(id, {
      id,
      presence,
      ghostState: classifyPresence(viewingRef, defaultBranch.ref, presence, nodesEqual),
    })
  }

  // Per-branch edge index keyed by canonical edge ID: endpoints are resolved
  // through the viewing branch's alias map and the composite ID recomputed, so
  // a foreign edge whose endpoints are retired IDs matches the viewing
  // branch's rewritten edge. Hidden edge types (renamed-from bookkeeping) keep
  // their literal IDs — their `to` is a retired ID by design.
  const edgeIndexes = new Map<string, Map<string, Edge>>()
  const canonicalEdgeIds = new Set<string>()
  for (const branch of branches) {
    const index = new Map<string, Edge>()
    for (const edgeList of branch.graph.edgesByFrom.values()) {
      for (const edge of edgeList) {
        const canonicalId = branch.ref === viewingRef
          ? edge.id
          : canonicalEdgeId(viewingBranch.graph, edge, resolve)
        const existing = index.get(canonicalId)
        if (existing === undefined || edge.id === canonicalId) index.set(canonicalId, edge)
        canonicalEdgeIds.add(canonicalId)
      }
    }
    edgeIndexes.set(branch.ref, index)
  }

  const edges = new Map<string, OverlayEdge>()
  for (const id of canonicalEdgeIds) {
    const presence = new Map<string, Edge>()
    for (const branch of branches) {
      const edge = edgeIndexes.get(branch.ref)?.get(id)
      if (edge) presence.set(branch.ref, edge)
    }
    edges.set(id, {
      id,
      presence,
      ghostState: classifyPresence(viewingRef, defaultBranch.ref, presence, edgesEqual),
    })
  }

  return { viewingRef, nodes, edges }
}

function canonicalEdgeId(viewingGraph: Graph, edge: Edge, resolve: (id: string) => string): string {
  if (getEdgeTypeDef(viewingGraph, edge.type)?.hidden === true) return edge.id
  const from = resolve(edge.from)
  const to = resolve(edge.to)
  if (from === edge.from && to === edge.to) return edge.id
  return `${from}__${edge.type}__${to}`
}

export function computeDiff(branch: BranchGraph, defaultBranch: BranchGraph): BranchDiff {
  const added: Node[] = []
  const modified: Node[] = []
  const removed: Node[] = []
  const warnings: BranchDiffWarning[] = []

  // Branch IDs resolve through the viewing (default) graph's alias map
  // (design §5/§14b): a branch still holding a retired ID diffs against the
  // renamed node instead of appearing as unrelated add+remove.
  const resolve = createAliasResolver(defaultBranch.graph)
  const matchedDefaultIds = new Set<string>()

  for (const [id, node] of branch.graph.nodesById) {
    const resolvedId = resolve(id)
    const defaultNode = defaultBranch.graph.nodesById.get(resolvedId)
    if (!defaultNode) {
      added.push(node)
      continue
    }
    matchedDefaultIds.add(resolvedId)
    const equal = nodesEqual(node, defaultNode)
    if (!equal) {
      modified.push(node)
      if (resolvedId !== id) {
        warnings.push({
          kind: 'retired-name-edit',
          branchId: id,
          resolvedId,
          message: `branch edits retired name '${id}' (renamed to '${resolvedId}' on the default branch) — rebase or apply the rename`,
        })
      }
    }
  }

  for (const [id, node] of defaultBranch.graph.nodesById) {
    if (!branch.graph.nodesById.has(id) && !matchedDefaultIds.has(id)) removed.push(node)
  }

  const diff: BranchDiff = { added, modified, removed }
  if (warnings.length > 0) diff.warnings = warnings
  return diff
}

function classifyPresence<T>(
  viewingRef: string,
  defaultRef: string,
  presence: Map<string, T>,
  equal: (a: T, b: T) => boolean,
): GhostState {
  const viewingItem = presence.get(viewingRef)
  if (viewingItem) {
    const others = [...presence.entries()].filter(([ref]) => ref !== viewingRef)
    if (others.length === 0) return 'local'
    return others.every(([, item]) => equal(viewingItem, item)) ? 'shared' : 'local-modified'
  }

  const defaultItem = presence.get(defaultRef)
  const nonDefault = [...presence.entries()].filter(([ref]) => ref !== defaultRef && ref !== viewingRef)

  if (defaultItem && nonDefault.length === 0) return 'default-only'
  if (!defaultItem && nonDefault.length === 1) return 'ghost-single'

  const otherItems = [...presence.values()]
  const first = otherItems[0]
  return first && otherItems.every(item => equal(first, item)) ? 'ghost-consensus' : 'ghost-conflict'
}

function nodesEqual(a: Node, b: Node): boolean {
  return deepEqual(comparableProperties(a), comparableProperties(b))
    && a.state === b.state
    && a.stability === b.stability
}

/**
 * `previousNames` is system-owned rename bookkeeping (design §3): a branch
 * predating a rename lacks it, and that alone must not read as a content
 * difference — an untouched carry-over stays equal to the renamed node.
 */
function comparableProperties(node: Node): Record<string, unknown> {
  if (!('previousNames' in node.properties)) return node.properties
  const { previousNames: _previousNames, ...rest } = node.properties
  return rest
}

function edgesEqual(a: Edge, b: Edge): boolean {
  return a.type === b.type
    && a.state === b.state
    && a.stability === b.stability
    && a.notes === b.notes
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }

  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  if (aKeys.length !== bKeys.length) return false

  return aKeys.every(key => Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]))
}

function uniqueBranches(branches: BranchGraph[]): BranchGraph[] {
  const byRef = new Map<string, BranchGraph>()
  for (const branch of branches) {
    if (!byRef.has(branch.ref)) byRef.set(branch.ref, branch)
  }
  return [...byRef.values()]
}
