import type {
  BranchDiff,
  BranchGraph,
  BranchOverlay,
  Edge,
  GhostState,
  Node,
  OverlayEdge,
  OverlayNode,
} from '../schema/index.js'
import { QueryError } from '../schema/index.js'

export function computeOverlay(
  viewingRef: string,
  defaultBranch: BranchGraph,
  allBranches: BranchGraph[],
): BranchOverlay {
  const branches = uniqueBranches([defaultBranch, ...allBranches])
  if (!branches.some(branch => branch.ref === viewingRef)) {
    throw new QueryError(`branch '${viewingRef}' not found in loaded branches`)
  }

  const nodes = new Map<string, OverlayNode>()
  for (const id of collectNodeIds(branches)) {
    const presence = new Map<string, Node>()
    for (const branch of branches) {
      const node = branch.graph.nodesById.get(id)
      if (node) presence.set(branch.ref, node)
    }
    nodes.set(id, {
      id,
      presence,
      ghostState: classifyPresence(viewingRef, defaultBranch.ref, presence, nodesEqual),
    })
  }

  const edges = new Map<string, OverlayEdge>()
  for (const id of collectEdgeIds(branches)) {
    const presence = new Map<string, Edge>()
    for (const branch of branches) {
      const edge = findEdge(branch, id)
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

export function computeDiff(branch: BranchGraph, defaultBranch: BranchGraph): BranchDiff {
  const added: Node[] = []
  const modified: Node[] = []
  const removed: Node[] = []

  for (const [id, node] of branch.graph.nodesById) {
    const defaultNode = defaultBranch.graph.nodesById.get(id)
    if (!defaultNode) {
      added.push(node)
    } else if (!nodesEqual(node, defaultNode)) {
      modified.push(node)
    }
  }

  for (const [id, node] of defaultBranch.graph.nodesById) {
    if (!branch.graph.nodesById.has(id)) removed.push(node)
  }

  return { added, modified, removed }
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
  return JSON.stringify(a.properties) === JSON.stringify(b.properties)
    && a.state === b.state
    && a.stability === b.stability
}

function edgesEqual(a: Edge, b: Edge): boolean {
  return a.type === b.type
    && a.state === b.state
    && a.stability === b.stability
    && a.notes === b.notes
}

function uniqueBranches(branches: BranchGraph[]): BranchGraph[] {
  const byRef = new Map<string, BranchGraph>()
  for (const branch of branches) {
    if (!byRef.has(branch.ref)) byRef.set(branch.ref, branch)
  }
  return [...byRef.values()]
}

function collectNodeIds(branches: BranchGraph[]): Set<string> {
  const ids = new Set<string>()
  for (const branch of branches) {
    for (const id of branch.graph.nodesById.keys()) ids.add(id)
  }
  return ids
}

function collectEdgeIds(branches: BranchGraph[]): Set<string> {
  const ids = new Set<string>()
  for (const branch of branches) {
    for (const edgeList of branch.graph.edgesByFrom.values()) {
      for (const edge of edgeList) ids.add(edge.id)
    }
  }
  return ids
}

function findEdge(branch: BranchGraph, edgeId: string): Edge | undefined {
  for (const edgeList of branch.graph.edgesByFrom.values()) {
    const edge = edgeList.find(item => item.id === edgeId)
    if (edge) return edge
  }
  return undefined
}
