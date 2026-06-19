import type {
  ClusterOverlay,
  ClusterOverlayField,
  Edge,
  EdgeType,
  GhostState,
  Graph,
  MultiGraph,
  Node,
  Stability,
  State,
} from '../schema/index.js'
import { QueryError } from '../schema/index.js'

export type ListNodesFilter = {
  template?: string
  component?: string
  state?: State
  stability?: Stability
}

export type ClusterResult = {
  root: Node
  children: Node[]
  edges: Edge[]
}

export type ClusterViewResult = {
  root: Node
  descendants: Node[]
  includedNodes: Node[]
  edges: Edge[]
}

export type LinkedFieldsResult = {
  edges: Edge[]
  nodes: Node[]
}

export function listNodes(graph: Graph, filter: ListNodesFilter = {}): Node[] {
  return [...graph.nodesById.values()].filter(node => {
    if (filter.template !== undefined && node.template !== filter.template) return false
    if (filter.component !== undefined && node.component !== filter.component) return false
    if (filter.state !== undefined && node.state !== filter.state) return false
    if (filter.stability !== undefined && node.stability !== filter.stability) return false
    return true
  })
}

export function getCluster(graph: Graph, nodeId: string): ClusterResult {
  const root = graph.nodesById.get(nodeId)
  if (!root) throw new QueryError(`Node not found: ${nodeId}`)

  const prefix = `${nodeId}.`
  const children = [...graph.nodesById.values()].filter(node => node.id.startsWith(prefix))
  const clusterIds = new Set([nodeId, ...children.map(node => node.id)])
  const edges: Edge[] = []
  const seen = new Set<string>()

  for (const id of clusterIds) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      if (clusterIds.has(edge.to) && !seen.has(edge.id)) {
        edges.push(edge)
        seen.add(edge.id)
      }
    }
  }

  return { root, children, edges }
}

export function getClusterView(graph: Graph, nodeId: string, includeEdgeTypes: EdgeType[] = []): ClusterViewResult {
  const cluster = getCluster(graph, nodeId)
  if (includeEdgeTypes.length === 0) {
    return {
      root: cluster.root,
      descendants: cluster.children,
      includedNodes: [],
      edges: cluster.edges,
    }
  }

  const clusterIds = new Set([cluster.root.id, ...cluster.children.map(node => node.id)])
  const requestedTypes = new Set(includeEdgeTypes)
  const includedNodeIds = new Set<string>()
  const edges = [...cluster.edges]
  const seen = new Set(cluster.edges.map(edge => edge.id))

  for (const id of clusterIds) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      collectIncludedEdge(edge, requestedTypes, clusterIds, includedNodeIds, edges, seen, graph)
    }
    for (const edge of graph.edgesByTo.get(id) ?? []) {
      collectIncludedEdge(edge, requestedTypes, clusterIds, includedNodeIds, edges, seen, graph)
    }
  }

  return {
    root: cluster.root,
    descendants: cluster.children,
    includedNodes: [...includedNodeIds]
      .map(id => graph.nodesById.get(id))
      .filter((node): node is Node => node !== undefined),
    edges,
  }
}

export function getLinkedFields(graph: Graph, nodeId: string): LinkedFieldsResult {
  const root = graph.nodesById.get(nodeId)
  if (!root) throw new QueryError(`Node not found: ${nodeId}`)

  const prefix = `${nodeId}.`
  const ownedFieldIds = new Set(
    [...graph.nodesById.entries()]
      .filter(([id, node]) => id.startsWith(prefix) && node.template === 'Field')
      .map(([id]) => id),
  )

  const edges: Edge[] = []
  const nodeIds = new Set<string>()
  const seen = new Set<string>()

  for (const fieldId of ownedFieldIds) {
    for (const edge of graph.edgesByFrom.get(fieldId) ?? []) {
      collectMapsTo(edge, edges, nodeIds, seen)
    }
    for (const edge of graph.edgesByTo.get(fieldId) ?? []) {
      collectMapsTo(edge, edges, nodeIds, seen)
    }
  }

  return {
    edges,
    nodes: [...nodeIds]
      .map(id => graph.nodesById.get(id))
      .filter((node): node is Node => node !== undefined),
  }
}

function collectMapsTo(edge: Edge, edges: Edge[], nodeIds: Set<string>, seen: Set<string>): void {
  if (edge.type !== 'maps-to' || seen.has(edge.id)) return
  edges.push(edge)
  nodeIds.add(edge.from)
  nodeIds.add(edge.to)
  seen.add(edge.id)
}

function collectIncludedEdge(
  edge: Edge,
  requestedTypes: Set<EdgeType>,
  clusterIds: Set<string>,
  includedNodeIds: Set<string>,
  edges: Edge[],
  seen: Set<string>,
  graph: Graph,
): void {
  if (!requestedTypes.has(edge.type) || seen.has(edge.id)) return
  edges.push(edge)
  seen.add(edge.id)
  for (const endId of [edge.from, edge.to]) {
    if (clusterIds.has(endId)) continue
    includedNodeIds.add(endId)
    const prefix = `${endId}.`
    for (const id of graph.nodesById.keys()) {
      if (id.startsWith(prefix)) includedNodeIds.add(id)
    }
  }
}

const OVERLAY_EXCLUDED: ReadonlySet<GhostState> = new Set(['local', 'shared'])

export function computeClusterOverlay(
  multi: MultiGraph,
  viewingRef: string,
  overlayRefs: string[],
  clusterRootId: string,
): ClusterOverlay | null {
  const overlay = multi.overlay(viewingRef)
  const prefix = `${clusterRootId}.`

  const fields: ClusterOverlayField[] = [...overlay.nodes.values()]
    .filter(node => {
      if (OVERLAY_EXCLUDED.has(node.ghostState)) return false
      if (!node.id.startsWith(prefix)) return false
      return overlayRefs.some(ref => node.presence.has(ref))
    })
    .map(node => {
      const sourceRef = overlayRefs.find(ref => node.presence.has(ref)) ?? viewingRef
      const sourceNode = node.presence.get(sourceRef) ?? [...node.presence.values()][0]
      return { id: node.id, ghostState: node.ghostState, sourceRef, node: sourceNode }
    })

  return fields.length === 0 ? null : { viewingRef, overlayRefs, fields }
}
