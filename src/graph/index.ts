import type {
  ClusterOverlay,
  ClusterOverlayField,
  Edge,
  EdgeType,
  EdgeTypeDef,
  GhostState,
  Graph,
  MultiGraph,
  Namespace,
  Node,
  Stability,
  State,
} from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { CORE_EDGE_TYPE_MAP } from '../loader/constants.js'
import { buildAliasMap, resolveAlias } from '../mutate/alias.js'
import { getDataTemplates, getStructuralTemplates, templateHasRole } from './roles.js'

/**
 * Lazily-built alias resolver over a graph's `renamed-from` trail edges
 * (design §5): retired IDs resolve to their live node. Live IDs
 * short-circuit without building the map; the map is built at most once per
 * resolver — create one per query call, never per edge.
 */
export function createAliasResolver(graph: Graph): (id: string) => string {
  let aliasMap: Map<string, string> | undefined
  return (id: string) => {
    if (graph.nodesById.has(id)) return id
    aliasMap ??= buildAliasMap(graph)
    return resolveAlias(graph, aliasMap, id)
  }
}

/** Templates whose nodes are structural children, derived from declared template roles. */
export function getStructuralNodeTemplates(graph: Graph): Set<string> {
  return getStructuralTemplates(graph.templates)
}

export function getEdgeTypeDef(graph: Graph, type: string): EdgeTypeDef | undefined {
  return (graph.edgeTypes ?? CORE_EDGE_TYPE_MAP).get(type)
}

/** Structural edges encode containment (has-field, has-value, pack-declared structural types). */
export function isStructuralEdgeType(graph: Graph, type: string): boolean {
  return getEdgeTypeDef(graph, type)?.category === 'structural'
}

/**
 * Visible edges appear in summaries, lineage defaults, and collapsed cluster
 * views: everything that is neither structural containment nor hidden
 * bookkeeping (e.g. renamed-from).
 */
export function isVisibleEdgeType(graph: Graph, type: string): boolean {
  const def = getEdgeTypeDef(graph, type)
  if (!def) return true
  return def.category !== 'structural' && def.hidden !== true
}

/** True when the edge type declares `traversal: outbound-only` (not followed from its target). */
export function isOutboundOnly(graph: Graph, type: string): boolean {
  return getEdgeTypeDef(graph, type)?.traversal === 'outbound-only'
}

/** Soft-removed edges (state 'removed') are kept for history but not followed by default traversals. */
export function isLiveEdge(edge: Edge): boolean {
  return edge.state !== 'removed'
}

export function getVisibleEdgeTypes(graph: Graph): EdgeType[] {
  return [...(graph.edgeTypes ?? CORE_EDGE_TYPE_MAP).values()]
    .filter(def => def.category !== 'structural' && def.hidden !== true)
    .map(def => def.name)
}

export type ListNodesFilter = {
  templates?: string[]
  excludeTemplates?: string[]
  namespace?: string
  kind?: string
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
  namespaceCount: number
  namespacesByKind: Record<string, number>
  nodesByNamespace: Record<string, number>
  nodesByTemplate: Record<string, number>
  nodesByState: Record<string, number>
  nodesByStability: Record<string, number>
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
  /** When true (default), excludes both `reads` and `uses-type` from inbound traversal. */
  readsOutboundOnly?: boolean
}

export function listNodes(graph: Graph, filter: ListNodesFilter = {}): Node[] {
  const namespaces = filter.kind !== undefined ? getNamespaces(graph) : undefined
  return [...graph.nodesById.values()].filter(node => {
    if (filter.templates?.length && !filter.templates.includes(node.template)) return false
    if (filter.excludeTemplates?.length && filter.excludeTemplates.includes(node.template)) return false
    if (filter.namespace !== undefined && node.namespace !== filter.namespace) return false
    if (namespaces !== undefined && namespaces.get(node.namespace)?.kind !== filter.kind) return false
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

/** Whether a node belongs to an owner's transitive materialized parent chain. */
export function isOwnedDescendant(graph: Pick<Graph, 'nodesById'>, nodeId: string, ownerId: string): boolean {
  const seen = new Set<string>([nodeId])
  let parentId = graph.nodesById.get(nodeId)?.parentId
  while (parentId !== undefined && !seen.has(parentId)) {
    if (parentId === ownerId) return true
    seen.add(parentId)
    parentId = graph.nodesById.get(parentId)?.parentId
  }
  return false
}

export function getCluster(graph: Graph, nodeId: string): ClusterResult {
  const root = graph.nodesById.get(nodeId)
  if (!root) throw new QueryError(`Node not found: ${nodeId}`)

  const children = [...graph.nodesById.values()].filter(node => isOwnedDescendant(graph, node.id, nodeId))
  const clusterIds = new Set([nodeId, ...children.map(node => node.id)])
  const edges: Edge[] = []
  const seen = new Set<string>()

  for (const id of clusterIds) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      if (clusterIds.has(edge.to) && isLiveEdge(edge) && !seen.has(edge.id)) {
        edges.push(edge)
        seen.add(edge.id)
      }
    }
  }

  return { root, children, edges }
}

// Shared data-type templates (role type-container/enum-container) whose structural children
// (fields, values) and referenced types are included when expanding external node references
// into a cluster view. Operational templates (DomainEvent, Command, APIEndpoint, etc.) are
// excluded — callers get only their root metadata, not their internal schema trees.
function isDataNodeTemplate(graph: Graph, templateName: string): boolean {
  return getDataTemplates(graph.templates).has(templateName)
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
  // outbound-only edge types (e.g. reads, uses-type: consumer → type) are not followed inbound so
  // viewing a shared Schema doesn't pull in every endpoint that references it
  const inboundTypes = new Set([...requestedTypes].filter(t => !isOutboundOnly(graph, t)) as EdgeType[])
  const edges = [...cluster.edges]
  const seen = new Set(cluster.edges.map(edge => edge.id))

  for (const id of clusterIds) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      if (!requestedTypes.has(edge.type) || !isLiveEdge(edge) || seen.has(edge.id)) continue
      edges.push(edge)
      seen.add(edge.id)
    }
    for (const edge of graph.edgesByTo.get(id) ?? []) {
      if (!inboundTypes.has(edge.type) || !isLiveEdge(edge) || seen.has(edge.id)) continue
      edges.push(edge)
      seen.add(edge.id)
    }
  }

  return {
    root: cluster.root,
    descendants: cluster.children,
    // includedNodes is intentionally empty — callers compose this from the dangling edges
    // using expandExternalNodes so each layer can apply its own inclusion policy.
    includedNodes: [],
    edges,
  }
}

/**
 * Expands a set of external node IDs (typically from dangling semantic edges) into a flat
 * list of nodes suitable for use as `includedNodes` in a cluster view response.
 *
 * Each ID is first resolved to its cluster root so that structural child IDs from
 * edges like `maps-to` (which point to e.g. `Schema.X.fields.Y`) are collapsed to
 * the owning cluster root (`Schema.X`) before processing.
 *
 * Policy:
 *   - Schema and EnumDefinition nodes: include structural children (fields/values) and
 *     follow their outbound `uses-type` edges one hop to collect referenced data types.
 *   - All other templates: include only the root node (metadata for connectivity panels).
 */
export function expandExternalNodes(graph: Graph, externalIds: Iterable<string>): Node[] {
  const result = new Set<string>()
  const dataQueue: string[] = []

  for (const rawId of externalIds) {
    const immediateParent = findParent(graph, rawId)

    if (immediateParent !== undefined) {
      // rawId is a structural child (field/value targeted by maps-to).
      // Include just this specific node — don't walk up and expand the entire parent tree.
      if (!graph.nodesById.has(rawId) || result.has(rawId)) continue
      result.add(rawId)
      continue
    }

    // rawId has no structural parent — it's a root or standalone node (reads/calls/etc. target).
    if (!graph.nodesById.has(rawId) || result.has(rawId)) continue
    result.add(rawId)
    const node = graph.nodesById.get(rawId)!
    if (isDataNodeTemplate(graph, node.template)) dataQueue.push(rawId)
  }

  for (const id of dataQueue) {
    // Include structural children (fields, values, mappings)
    for (const childId of graph.nodesById.keys()) {
      if (isOwnedDescendant(graph, childId, id)) result.add(childId)
    }
    // Follow outbound uses-type one hop to collect referenced enum/schema types
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      if (edge.type !== 'uses-type' || !isLiveEdge(edge) || result.has(edge.to)) continue
      const target = graph.nodesById.get(edge.to)
      if (!target) continue
      result.add(edge.to)
      if (isDataNodeTemplate(graph, target.template)) {
        for (const childId of graph.nodesById.keys()) {
          if (isOwnedDescendant(graph, childId, edge.to)) result.add(childId)
        }
      }
    }
  }

  return [...result]
    .map(id => graph.nodesById.get(id))
    .filter((node): node is Node => node !== undefined)
}

export function getLinkedFields(graph: Graph, nodeId: string): LinkedFieldsResult {
  const resolveLive = createAliasResolver(graph)
  const rootId = resolveLive(nodeId)
  const root = graph.nodesById.get(rootId)
  if (!root) throw new QueryError(`Node not found: ${nodeId}`)

  const ownedFieldIds = new Set(
    [...graph.nodesById.entries()]
      .filter(([id, node]) => isOwnedDescendant(graph, id, rootId) && templateHasRole(graph.templates, node.template, 'field'))
      .map(([id]) => id),
  )

  const edges: Edge[] = []
  const nodeIds = new Set<string>()
  const seen = new Set<string>()

  // Scan maps-to edges with alias-resolved endpoints (design §5): an edge
  // still referencing a retired field ID links to the live field rather than
  // dangling. Edges are returned as authored; node IDs are the live ones.
  for (const edgeList of graph.edgesByFrom.values()) {
    for (const edge of edgeList) {
      if (edge.type !== 'maps-to' || !isLiveEdge(edge) || seen.has(edge.id)) continue
      const from = resolveLive(edge.from)
      const to = resolveLive(edge.to)
      if (!ownedFieldIds.has(from) && !ownedFieldIds.has(to)) continue
      edges.push(edge)
      seen.add(edge.id)
      nodeIds.add(from)
      nodeIds.add(to)
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
  const node = graph.nodesById.get(nodeId)
  if (node) return node.parentId !== undefined && graph.nodesById.has(node.parentId) ? node.parentId : undefined

  // Fallback only for absent IDs (e.g. retired field IDs): walk the hierarchy in
  // 2-segment strides. Existing nodes use only materialized ownership.
  const parts = nodeId.split('.')
  let endIdx = parts.length - 2
  while (endIdx >= 1) {
    const candidateId = parts.slice(0, endIdx).join('.')
    if (graph.nodesById.has(candidateId)) return candidateId
    endIdx -= 2
  }
  return undefined
}


const OVERLAY_EXCLUDED: ReadonlySet<GhostState> = new Set(['local', 'shared'])

export function computeClusterOverlay(
  multi: MultiGraph,
  viewingRef: string,
  overlayRefs: string[],
  clusterRootId: string,
): ClusterOverlay | null {
  const overlay = multi.overlay(viewingRef)
  const graphsByRef = new Map([multi.default, ...multi.branches].map(branch => [branch.ref, branch.graph]))

  const fields: ClusterOverlayField[] = [...overlay.nodes.values()]
    .filter(node => {
      if (OVERLAY_EXCLUDED.has(node.ghostState)) return false
      return overlayRefs.some(ref => {
        const graph = graphsByRef.get(ref)
        return node.presence.has(ref) && graph !== undefined && isOwnedDescendant(graph, node.id, clusterRootId)
      })
    })
    .map(node => {
      const sourceRef = overlayRefs.find(ref => {
        const graph = graphsByRef.get(ref)
        return node.presence.has(ref) && graph !== undefined && isOwnedDescendant(graph, node.id, clusterRootId)
      }) ?? viewingRef
      const sourceNode = node.presence.get(sourceRef) ?? [...node.presence.values()][0]
      return { id: node.id, ghostState: node.ghostState, sourceRef, node: sourceNode }
    })

  return fields.length === 0 ? null : { viewingRef, overlayRefs, fields }
}

export function getGraphSummary(graph: Graph): GraphSummary {
  const nodesByNamespace: Record<string, number> = {}
  const nodesByTemplate: Record<string, number> = {}
  const nodesByState: Record<string, number> = {}
  const nodesByStability: Record<string, number> = {}
  for (const node of graph.nodesById.values()) {
    if (node.namespace) {
      nodesByNamespace[node.namespace] = (nodesByNamespace[node.namespace] ?? 0) + 1
    }
    nodesByTemplate[node.template] = (nodesByTemplate[node.template] ?? 0) + 1
    nodesByState[node.state] = (nodesByState[node.state] ?? 0) + 1
    nodesByStability[node.stability] = (nodesByStability[node.stability] ?? 0) + 1
  }

  const namespaces = getNamespaces(graph)
  const namespacesByKind: Record<string, number> = {}
  for (const ns of namespaces.values()) {
    namespacesByKind[ns.kind] = (namespacesByKind[ns.kind] ?? 0) + 1
  }

  const nodesWithEdges = new Set<string>()
  const edgesByType: Record<string, number> = {}
  for (const edgeList of graph.edgesByFrom.values()) {
    for (const edge of edgeList) {
      if (!isLiveEdge(edge) || !isVisibleEdgeType(graph, edge.type)) continue
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
    namespaceCount: namespaces.size,
    namespacesByKind,
    nodesByNamespace,
    nodesByTemplate,
    nodesByState,
    nodesByStability,
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

/** Overall cap on ranked search results (web UI search). */
export const RANKED_SEARCH_MAX_RESULTS = 50
/** Per-template cap on ranked search results, so numerous types (fields, enum values) cannot flood the list. */
export const RANKED_SEARCH_MAX_PER_TEMPLATE = 8

export type RankedSearchMatch = 'exact' | 'prefix' | 'substring' | 'id'

export type RankedSearchResult = {
  node: Node
  match: RankedSearchMatch
  /** Owning cluster root; absent for root nodes. */
  owner?: { id: string; template: string }
}

const MATCH_RANK: Record<RankedSearchMatch, number> = { exact: 0, prefix: 1, substring: 2, id: 3 }

function displayNameOf(id: string): string {
  return id.slice(id.lastIndexOf('.') + 1)
}

function rankMatch(query: string, node: Node): RankedSearchMatch | null {
  const q = query.toLowerCase()
  const name = displayNameOf(node.id).toLowerCase()
  if (name === q) return 'exact'
  if (name.startsWith(q)) return 'prefix'
  if (name.includes(q)) return 'substring'
  return fuzzyScore(query, node.id) !== null ? 'id' : null
}

function owningRootOf(graph: Graph, node: Node): Node | undefined {
  let current = node
  const seen = new Set<string>([node.id])
  while (current.parentId !== undefined) {
    const parent = graph.nodesById.get(current.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    current = parent
  }
  return current === node ? undefined : current
}

/**
 * Search every node (roots and owned nodes) by display name, then id.
 * Order: exact name > name prefix > name substring > id-only; ties: roots before
 * owned nodes, then by id. Capped per template and overall. Used by the web UI;
 * `searchNodes` (MCP/CLI) stays root-only.
 */
export function searchNodesRanked(
  graph: Graph,
  query: string,
  options: { limit?: number } = {},
): RankedSearchResult[] {
  const term = query.trim()
  if (!term) return []
  const limit = Math.min(options.limit ?? RANKED_SEARCH_MAX_RESULTS, RANKED_SEARCH_MAX_RESULTS)
  const perTemplate = RANKED_SEARCH_MAX_PER_TEMPLATE

  const matched: RankedSearchResult[] = []
  for (const node of graph.nodesById.values()) {
    const match = rankMatch(term, node)
    if (match === null) continue
    const root = owningRootOf(graph, node)
    matched.push({ node, match, ...(root ? { owner: { id: root.id, template: root.template } } : {}) })
  }

  matched.sort((a, b) =>
    MATCH_RANK[a.match] - MATCH_RANK[b.match]
    || Number(a.owner !== undefined) - Number(b.owner !== undefined)
    || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0))

  const counts = new Map<string, number>()
  const results: RankedSearchResult[] = []
  for (const result of matched) {
    if (results.length >= limit) break
    const count = counts.get(result.node.template) ?? 0
    if (count >= perTemplate) continue
    counts.set(result.node.template, count + 1)
    results.push(result)
  }
  return results
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
      if (isLiveEdge(edge) && isVisibleEdgeType(graph, edge.type)) defaultEdgeTypes.add(edge.type)
    }
  }
  const edgeTypeSet = options.edgeTypes ? new Set(options.edgeTypes) : defaultEdgeTypes
  // reads and uses-type are directional (consumer → type); readsOutboundOnly (default true)
  // excludes both from inbound traversal so a shared type doesn't pull in every consumer
  const inboundTypeSet = new Set(
    [...edgeTypeSet].filter(type => !(readsOutboundOnly && isOutboundOnly(graph, type))),
  )

  const useAllowlist = (options.nodeTypes?.length ?? 0) > 0
  const allowedTemplates = useAllowlist ? new Set(options.nodeTypes) : null
  const excludedTemplates = useAllowlist
    ? null
    : options.excludeNodeTypes?.length
      ? new Set(options.excludeNodeTypes)
      : getStructuralNodeTemplates(graph)

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

  // Alias resolution (design §5): retired IDs — stale start IDs and edge
  // endpoints referencing pre-rename names — resolve to the live node instead
  // of dangling. The resolver builds the alias map at most once per call.
  const resolveLive = createAliasResolver(graph)

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

  const validStartIds = [...new Set(startNodeIds.map(resolveLive))].filter(id => graph.nodesById.has(id))
  const startSet = new Set(validStartIds)

  function runDownstream(): void {
    const visited = new Set<string>(startSet)
    const queue = validStartIds.map(id => ({ id, originId: id, distance: 0 }))

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      if (current.distance >= depth) continue

      for (const edge of graph.edgesByFrom.get(current.id) ?? []) {
        if (!isLiveEdge(edge) || !edgeTypeSet.has(edge.type)) continue
        const toId = resolveLive(edge.to)
        const node = graph.nodesById.get(toId)
        if (!node || !isIncluded(node)) continue
        if (visited.has(toId)) {
          originSets.get(toId)?.add(current.originId)
          continue
        }
        visited.add(toId)
        tryRecord(toId, current.originId, current.distance + 1, edge.type, current.id, 'downstream')
        queue.push({ id: toId, originId: current.originId, distance: current.distance + 1 })
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
        if (!isLiveEdge(edge) || !inboundTypeSet.has(edge.type)) continue
        const fromId = resolveLive(edge.from)
        const node = graph.nodesById.get(fromId)
        if (!node || !isIncluded(node)) continue
        if (visited.has(fromId)) {
          originSets.get(fromId)?.add(current.originId)
          continue
        }
        visited.add(fromId)
        tryRecord(fromId, current.originId, current.distance + 1, edge.type, current.id, 'upstream')
        queue.push({ id: fromId, originId: current.originId, distance: current.distance + 1 })
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
  const nodesWithEdges = new Set<string>()
  for (const id of combinedSet) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      if (seenEdgeIds.has(edge.id) || !isLiveEdge(edge) || !edgeTypeSet.has(edge.type)) continue
      // Endpoints resolve through the alias map so an edge referencing a
      // retired ID still connects to the live node it was traversed to.
      const from = resolveLive(edge.from)
      const to = resolveLive(edge.to)
      if (combinedSet.has(from) && combinedSet.has(to)) {
        edges.push(edge)
        seenEdgeIds.add(edge.id)
        nodesWithEdges.add(from)
        nodesWithEdges.add(to)
      }
    }
  }
  // Keep parent-hop ancestors even when they were reached through the
  // synthetic upstream parent traversal and therefore have no concrete edge
  // object in the result edge set.
  const prunedIds = new Set([...resultNodeIds].filter(id =>
    nodesWithEdges.has(id) || annotations.get(id)?.viaEdgeType === 'parent',
  ))

  let danglingEdges: Edge[] | undefined
  if (includeDanglingEdges) {
    danglingEdges = []
    const danglingSeenIds = new Set<string>()
    for (const id of prunedIds) {
      for (const edge of [...(graph.edgesByFrom.get(id) ?? []), ...(graph.edgesByTo.get(id) ?? [])]) {
        if (danglingSeenIds.has(edge.id) || seenEdgeIds.has(edge.id)) continue
        if (!isLiveEdge(edge) || !edgeTypeSet.has(edge.type)) continue
        const from = resolveLive(edge.from)
        const to = resolveLive(edge.to)
        const otherId = from === id ? to : from
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

/** Display label for a kind; unknown kinds fall back to the kind id. */
export function getKindLabel(graph: Graph, kind: string): string {
  return graph.kinds?.get(kind)?.label ?? (kind === 'component' ? 'Component' : kind)
}

/** Kind registry (id, label); always includes the default component kind. */
export function getKindRegistry(graph: Graph): Array<{ id: string; label: string }> {
  const registry = new Map<string, { id: string; label: string }>()
  registry.set('component', { id: 'component', label: getKindLabel(graph, 'component') })
  for (const kind of graph.kinds?.values() ?? []) {
    registry.set(kind.id, { id: kind.id, label: getKindLabel(graph, kind.id) })
  }
  return [...registry.values()]
}

/** Derive membership from current nodes, retaining declarations for empty namespaces. */
export function getNamespaces(graph: Graph): Map<string, Namespace> {
  const namespaces = new Map<string, Namespace>()
  for (const id of graph.nodesById.keys()) {
    namespaces.set(id.split('.')[0], { kind: 'component' })
  }
  for (const [name, declaration] of graph.namespaceDeclarations ?? []) {
    namespaces.set(name, { ...declaration })
  }
  return namespaces
}
