import type { Edge, Graph, Node, Stability, State } from '../schema/index.js'
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
