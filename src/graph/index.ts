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

export const STRUCTURAL_EDGE_TYPES = new Set<EdgeType>(['has-field', 'has-value', 'renamed-from'])
export const STRUCTURAL_NODE_TEMPLATES = new Set(['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping'])
export const SEMANTIC_EDGE_TYPES = new Set<EdgeType>([
  'triggers',
  'produces',
  'reads',
  'calls',
  'implements',
  'maps-to',
  'derived-from',
])

export type ListNodesFilter = {
  templates?: string[]
  excludeTemplates?: string[]
  component?: string
  state?: State | State[]
  stability?: Stability | Stability[]
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

export type GraphSummary = {
  nodeCount: number
  componentCount: number
  orphanNodeCount: number
  orphansByTemplate: Record<string, number>
  edgesByType: Record<string, number>
  diagnosticCount: number
}

export type SearchResult = {
  node: Node
  score: number
}

export type SearchNodesOptions = {
  templates?: string[]
  excludeTemplates?: string[]
  limit?: number
  offset?: number
  searchProperties?: boolean
}

export type LineageDirection = 'downstream' | 'upstream' | 'both'

export type LineageNodeAnnotation = {
  origin_id: string
  depth: number
  via_edge_type: string
  via_node_id: string
  origins?: string[]
  direction?: 'upstream' | 'downstream'
}

export type LineageResult = {
  nodes: Array<Node & LineageNodeAnnotation>
  edges: Edge[]
  dangling_edges?: Edge[]
}

export type GetLineageOptions = {
  depth?: number
  direction?: LineageDirection
  edgeTypes?: EdgeType[]
  excludeNodeTypes?: string[]
  nodeTypes?: string[]
  includeDanglingEdges?: boolean
  readsOutboundOnly?: boolean
}

export function listNodes(graph: Graph, filter: ListNodesFilter = {}): Node[] {
  return [...graph.nodesById.values()].filter(node => {
    if (filter.templates?.length && !filter.templates.includes(node.template)) return false
    if (filter.excludeTemplates?.length && filter.excludeTemplates.includes(node.template)) return false
    if (filter.component !== undefined && node.component !== filter.component) return false
    if (filter.state !== undefined) {
      const states = Array.isArray(filter.state) ? filter.state : [filter.state]
      if (!states.includes(node.state)) return false
    }
    if (filter.stability !== undefined) {
      const stabilities = Array.isArray(filter.stability) ? filter.stability : [filter.stability]
      if (!stabilities.includes(node.stability)) return false
    }
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
  // reads edges are directional (consumer → type); only follow outbound so viewing a shared
  // Schema doesn't pull in every endpoint that references it
  const inboundTypes = new Set([...requestedTypes].filter(t => t !== 'reads') as EdgeType[])
  const includedNodeIds = new Set<string>()
  const edges = [...cluster.edges]
  const seen = new Set(cluster.edges.map(edge => edge.id))

  for (const id of clusterIds) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      collectIncludedEdge(edge, requestedTypes, clusterIds, includedNodeIds, edges, seen, graph)
    }
    for (const edge of graph.edgesByTo.get(id) ?? []) {
      collectIncludedEdge(edge, inboundTypes, clusterIds, includedNodeIds, edges, seen, graph)
    }
  }

  // BFS over included nodes (outbound only) to transitively pull in referenced schemas
  const processedOutbound = new Set<string>(clusterIds)
  let prevSize = 0
  while (includedNodeIds.size > prevSize) {
    prevSize = includedNodeIds.size
    for (const id of includedNodeIds) {
      if (processedOutbound.has(id)) continue
      processedOutbound.add(id)
      for (const edge of graph.edgesByFrom.get(id) ?? []) {
        collectIncludedEdge(edge, requestedTypes, clusterIds, includedNodeIds, edges, seen, graph)
      }
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

function findParent(graph: Graph, nodeId: string): string | undefined {
  const parts = nodeId.split('.')
  let endIdx = parts.length - 2
  while (endIdx >= 1) {
    const candidateId = parts.slice(0, endIdx).join('.')
    if (graph.nodesById.has(candidateId)) return candidateId
    endIdx -= 2
  }
  return undefined
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

export function getGraphSummary(graph: Graph): GraphSummary {
  const components = new Set<string>()
  for (const node of graph.nodesById.values()) {
    if (node.component) components.add(node.component)
  }

  const nodesWithEdges = new Set<string>()
  const edgesByType: Record<string, number> = {}
  for (const edgeList of graph.edgesByFrom.values()) {
    for (const edge of edgeList) {
      if (!SEMANTIC_EDGE_TYPES.has(edge.type)) continue
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1
      nodesWithEdges.add(edge.from)
      nodesWithEdges.add(edge.to)
    }
  }

  const orphansByTemplate: Record<string, number> = {}
  for (const node of graph.nodesById.values()) {
    if (nodesWithEdges.has(node.id)) continue
    if (findParent(graph, node.id) !== undefined) continue
    orphansByTemplate[node.template] = (orphansByTemplate[node.template] ?? 0) + 1
  }

  return {
    nodeCount: graph.nodesById.size,
    componentCount: components.size,
    orphanNodeCount: Object.values(orphansByTemplate).reduce((sum, count) => sum + count, 0),
    orphansByTemplate,
    edgesByType,
    diagnosticCount: graph.diagnostics.length,
  }
}

function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const s = target.toLowerCase()
  let qi = 0
  let run = 0
  let maxRun = 0
  for (let i = 0; i < s.length; i++) {
    if (qi >= q.length) break
    if (s[i] === q[qi]) {
      qi++
      run++
      if (run > maxRun) maxRun = run
    } else {
      run = 0
    }
  }
  return qi === q.length ? maxRun : null
}

export function searchNodes(graph: Graph, queries: string[], options: SearchNodesOptions = {}): SearchResult[] {
  const { templates, excludeTemplates, limit = 10, offset = 0, searchProperties = false } = options
  const terms = queries.map(query => query.trim()).filter(Boolean)
  if (terms.length === 0) return []

  const results: SearchResult[] = []
  for (const node of graph.nodesById.values()) {
    if (findParent(graph, node.id) !== undefined) continue
    if (templates?.length && !templates.includes(node.template)) continue
    if (excludeTemplates?.length && excludeTemplates.includes(node.template)) continue

    let bestScore = 0
    for (const term of terms) {
      const score = fuzzyScore(term, node.id)
      if (score !== null && score > bestScore) bestScore = score
      if (searchProperties) {
        const propertyText = [node.properties.name, node.properties.description, node.properties['x-aka']]
          .filter((value): value is string => typeof value === 'string')
          .join(' ')
        if (propertyText) {
          const propertyScore = fuzzyScore(term, propertyText)
          if (propertyScore !== null && propertyScore > bestScore) bestScore = propertyScore
        }
      }
    }

    if (bestScore > 0) results.push({ node, score: bestScore })
  }

  results.sort((a, b) => b.score - a.score || a.node.id.length - b.node.id.length)
  return results.slice(offset, offset + limit)
}

export function getLineage(graph: Graph, startNodeIds: string[], options: GetLineageOptions = {}): LineageResult {
  const {
    depth = 2,
    direction = 'downstream',
    readsOutboundOnly = true,
    includeDanglingEdges = false,
  } = options

  const defaultEdgeTypes = new Set<EdgeType>()
  for (const edgeList of graph.edgesByFrom.values()) {
    for (const edge of edgeList) {
      if (!STRUCTURAL_EDGE_TYPES.has(edge.type)) defaultEdgeTypes.add(edge.type)
    }
  }
  const edgeTypeSet = options.edgeTypes ? new Set(options.edgeTypes) : defaultEdgeTypes
  const inboundTypeSet = new Set([...edgeTypeSet].filter(type => !(readsOutboundOnly && type === 'reads')))

  const useAllowlist = (options.nodeTypes?.length ?? 0) > 0
  const allowedTemplates = useAllowlist ? new Set(options.nodeTypes) : null
  const excludedTemplates = useAllowlist
    ? null
    : options.excludeNodeTypes?.length
      ? new Set(options.excludeNodeTypes)
      : STRUCTURAL_NODE_TEMPLATES

  function isIncluded(node: Node): boolean {
    if (allowedTemplates) return allowedTemplates.has(node.template)
    if (excludedTemplates) return !excludedTemplates.has(node.template)
    return true
  }

  type Annotation = {
    originId: string
    depth: number
    viaEdgeType: string
    viaNodeId: string
    dir: 'upstream' | 'downstream'
  }

  const annotations = new Map<string, Annotation>()
  const originSets = new Map<string, Set<string>>()

  function tryRecord(
    nodeId: string,
    originId: string,
    resultDepth: number,
    viaEdgeType: string,
    viaNodeId: string,
    dir: 'upstream' | 'downstream',
  ): boolean {
    const previous = annotations.get(nodeId)
    if (previous && previous.depth <= resultDepth) {
      originSets.get(nodeId)?.add(originId)
      return previous.depth < resultDepth
    }

    annotations.set(nodeId, { originId, depth: resultDepth, viaEdgeType, viaNodeId, dir })
    if (!originSets.has(nodeId)) originSets.set(nodeId, new Set())
    originSets.get(nodeId)?.add(originId)
    return true
  }

  const validStartIds = startNodeIds.filter(id => graph.nodesById.has(id))
  const startSet = new Set(validStartIds)

  function runDownstream(): void {
    const visited = new Set<string>(startSet)
    const queue = validStartIds.map(id => ({ id, originId: id, distance: 0 }))

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      if (current.distance >= depth) continue

      for (const edge of graph.edgesByFrom.get(current.id) ?? []) {
        if (!edgeTypeSet.has(edge.type)) continue
        const node = graph.nodesById.get(edge.to)
        if (!node || !isIncluded(node)) continue
        if (visited.has(edge.to)) {
          originSets.get(edge.to)?.add(current.originId)
          continue
        }
        visited.add(edge.to)
        tryRecord(edge.to, current.originId, current.distance + 1, edge.type, current.id, 'downstream')
        queue.push({ id: edge.to, originId: current.originId, distance: current.distance + 1 })
      }
    }
  }

  function runUpstream(): void {
    const visited = new Set<string>(startSet)
    const queue = validStartIds.map(id => ({ id, originId: id, distance: 0 }))

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      if (current.distance >= depth) continue

      for (const edge of graph.edgesByTo.get(current.id) ?? []) {
        if (!inboundTypeSet.has(edge.type)) continue
        const node = graph.nodesById.get(edge.from)
        if (!node || !isIncluded(node)) continue
        if (visited.has(edge.from)) {
          originSets.get(edge.from)?.add(current.originId)
          continue
        }
        visited.add(edge.from)
        tryRecord(edge.from, current.originId, current.distance + 1, edge.type, current.id, 'upstream')
        queue.push({ id: edge.from, originId: current.originId, distance: current.distance + 1 })
      }

      const parentId = findParent(graph, current.id)
      if (parentId) {
        const parentNode = graph.nodesById.get(parentId)
        if (!parentNode || !isIncluded(parentNode)) continue
        if (visited.has(parentId)) {
          originSets.get(parentId)?.add(current.originId)
          continue
        }
        visited.add(parentId)
        tryRecord(parentId, current.originId, current.distance + 1, 'parent', current.id, 'upstream')
        queue.push({ id: parentId, originId: current.originId, distance: current.distance + 1 })
      }
    }
  }

  if (direction === 'downstream' || direction === 'both') runDownstream()
  if (direction === 'upstream' || direction === 'both') runUpstream()

  const resultNodeIds = new Set(annotations.keys())
  const combinedSet = new Set([...startSet, ...resultNodeIds])
  const edges: Edge[] = []
  const seenEdgeIds = new Set<string>()
  for (const id of combinedSet) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      if (seenEdgeIds.has(edge.id) || !edgeTypeSet.has(edge.type)) continue
      if (combinedSet.has(edge.from) && combinedSet.has(edge.to)) {
        edges.push(edge)
        seenEdgeIds.add(edge.id)
      }
    }
  }

  const nodesWithEdges = new Set<string>()
  for (const edge of edges) {
    nodesWithEdges.add(edge.from)
    nodesWithEdges.add(edge.to)
  }
  const prunedIds = new Set([...resultNodeIds].filter(id => nodesWithEdges.has(id)))

  let danglingEdges: Edge[] | undefined
  if (includeDanglingEdges) {
    danglingEdges = []
    const danglingSeenIds = new Set<string>()
    for (const id of prunedIds) {
      for (const edge of [...(graph.edgesByFrom.get(id) ?? []), ...(graph.edgesByTo.get(id) ?? [])]) {
        if (danglingSeenIds.has(edge.id) || seenEdgeIds.has(edge.id)) continue
        if (!edgeTypeSet.has(edge.type)) continue
        const otherId = edge.from === id ? edge.to : edge.from
        if (!combinedSet.has(otherId)) {
          danglingEdges.push(edge)
          danglingSeenIds.add(edge.id)
        }
      }
    }
  }

  const nodes = [...prunedIds].map(id => {
    const node = graph.nodesById.get(id) as Node
    const annotation = annotations.get(id) as Annotation
    const origins = [...(originSets.get(id) ?? [])]
    const result: Node & LineageNodeAnnotation = {
      ...node,
      origin_id: annotation.originId,
      depth: annotation.depth,
      via_edge_type: annotation.viaEdgeType,
      via_node_id: annotation.viaNodeId,
    }
    if (origins.length > 1) result.origins = origins
    if (direction === 'both') result.direction = annotation.dir
    return result
  })

  const result: LineageResult = { nodes, edges }
  if (danglingEdges !== undefined) result.dangling_edges = danglingEdges
  return result
}
