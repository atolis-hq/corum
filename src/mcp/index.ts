import { printBanner } from '../banner.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'
import {
  computeClusterOverlay,
  expandExternalNodes,
  getCluster,
  getClusterView,
  getGraphSummary,
  getLineage,
  getLinkedFields,
  getStructuralNodeTemplates,
  getVisibleEdgeTypes,
  isVisibleEdgeType,
  listNodes,
  searchNodes,
  type GetLineageOptions,
  type LineageDirection,
  type ListNodesFilter,
  type SearchNodesOptions,
} from '../graph/index.js'
import { loadGraph, loadMultiGraph } from '../loader/index.js'
import type { BranchGraph, Edge, EdgeType, Graph, Stability, State } from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { MutationError, getActiveSession, startSession, type WorkingSession } from '../mutate/index.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import type { GraphSource } from '../source/index.js'
import { createMultiGraphCache, replaceGraph, startGraphFileWatcher, startWebServer, type MultiGraphCache } from '../web/server.js'
import { USAGE_GUIDE_PROMPT } from './prompts/usage-guide.js'
import { collapseClusterSchemas } from '../graph/schema-collapse.js'
import { compactKeys, getSerializer } from './serializers.js'

type ToolContent = { type: 'text'; text: string }

type ToolResult = {
  content: ToolContent[]
  isError?: boolean
}

type MaybePromise<T> = T | Promise<T>
type ToolHandler = (args: Record<string, unknown>) => MaybePromise<ToolResult>
type ToolDefinition = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    required?: string[]
    properties: Record<string, unknown>
  }
}

const STATE_VALUES = ['draft', 'proposed', 'agreed', 'future', 'removed', 'implemented'] as const
const STABILITY_VALUES = ['unstable', 'stable', 'deprecated'] as const
const LINEAGE_DIRECTIONS = ['downstream', 'upstream', 'both'] as const satisfies readonly LineageDirection[]
const OUTPUT_FORMATS = ['yaml', 'json', 'toon'] as const

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function parseEdgeTypes(value: unknown, graph: Graph): EdgeType[] | undefined {
  const requested = toStringArray(value)
  if (!requested) return undefined
  const known = graph.edgeTypes
  const invalid = known
    ? requested.filter(type => !known.has(type))
    : []
  if (invalid.length > 0) {
    throw new QueryError(`Unknown edge type: ${invalid.join(', ')}`)
  }
  return requested as EdgeType[]
}

function parseListNodesFilter(value: unknown): ListNodesFilter {
  const filterArg = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}

  return {
    templates: toStringArray(filterArg.templates),
    excludeTemplates: toStringArray(filterArg.exclude_templates),
    component: typeof filterArg.component === 'string' ? filterArg.component : undefined,
    state: typeof filterArg.state === 'string'
      ? filterArg.state as ListNodesFilter['state']
      : toStringArray(filterArg.state) as ListNodesFilter['state'] | undefined,
    stability: typeof filterArg.stability === 'string'
      ? filterArg.stability as ListNodesFilter['stability']
      : toStringArray(filterArg.stability) as ListNodesFilter['stability'] | undefined,
  }
}

function includesProvenance(args: Record<string, unknown>): boolean {
  return args.include_provenance === true || args.includeProvenance === true
}

function summarizeNode(node: Graph['nodesById'] extends Map<string, infer T> ? T : never, includeProvenance: boolean): Record<string, unknown> {
  return {
    id: node.id,
    template: node.template,
    component: node.component,
    state: node.state,
    stability: node.stability,
    ...(includeProvenance ? withProvenance(node) : {}),
  }
}

function withProvenance(node: Graph['nodesById'] extends Map<string, infer T> ? T : never): Record<string, unknown> {
  return {
    ...(node.extractedFrom !== undefined ? { extractedFrom: node.extractedFrom } : {}),
    ...(node.lastModifiedAt !== undefined ? { lastModifiedAt: node.lastModifiedAt } : {}),
    ...(node.derivation !== undefined ? { derivation: node.derivation } : {}),
    ...(node.derivedBy !== undefined ? { derivedBy: node.derivedBy } : {}),
  }
}

function fullNode(node: Graph['nodesById'] extends Map<string, infer T> ? T : never, includeProvenance: boolean): Record<string, unknown> {
  return {
    id: node.id,
    template: node.template,
    component: node.component,
    state: node.state,
    stability: node.stability,
    ...(node.corum !== undefined ? { corum: node.corum } : {}),
    properties: node.properties,
    ...(includeProvenance ? withProvenance(node) : {}),
  }
}

type EdgeOutputOptions = {
  includeProvenance?: boolean
  includeId?: boolean
}

function mapEdge(edge: Edge, options: EdgeOutputOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (options.includeId) out.id = edge.id
  out.from = edge.from
  out.to = edge.to
  out.type = edge.type
  if (edge.notes !== undefined) out.notes = edge.notes
  if (options.includeProvenance) {
    if (edge.derivation !== undefined) out.derivation = edge.derivation
    if (edge.derivedBy !== undefined) out.derivedBy = edge.derivedBy
  }
  return out
}

function getEdgeOutputOptions(args: Record<string, unknown>): EdgeOutputOptions {
  return {
    includeProvenance: includesProvenance(args),
    includeId: args.include_edge_ids === true,
  }
}

function mapLineageNode(
  node: Record<string, unknown>,
  includeProvenance: boolean,
  lean: boolean,
): Record<string, unknown> {
  const base = {
    id: String(node.id),
    origin_id: String(node.origin_id),
    depth: Number(node.depth),
    via_edge_type: String(node.via_edge_type),
    via_node_id: String(node.via_node_id),
  }

  if (lean) return base

  return {
    ...base,
    template: String(node.template),
    component: String(node.component),
    state: String(node.state),
    stability: String(node.stability),
    properties: (node.properties ?? {}) as Record<string, unknown>,
    ...(includeProvenance
      ? {
        ...(node.extractedFrom !== undefined ? { extractedFrom: node.extractedFrom } : {}),
        ...(node.lastModifiedAt !== undefined ? { lastModifiedAt: node.lastModifiedAt } : {}),
        ...(node.derivation !== undefined ? { derivation: node.derivation } : {}),
        ...(node.derivedBy !== undefined ? { derivedBy: node.derivedBy } : {}),
      }
      : {}),
  }
}

export function createMcpHandlers(graph: Graph, source?: GraphSource, cache?: MultiGraphCache): {
  list_nodes: ToolHandler
  list_templates: ToolHandler
  get_template: ToolHandler
  get_cluster: ToolHandler
  get_graph: ToolHandler
  get_graph_metadata: ToolHandler
  get_lineage: ToolHandler
  get_linked_fields: ToolHandler
  get_graph_summary: ToolHandler
  search_nodes: ToolHandler
  list_branches: ToolHandler
  diff_branch: ToolHandler
  start_changes: ToolHandler
  apply_cluster: ToolHandler
  create_node: ToolHandler
  update_node: ToolHandler
  rename_node: ToolHandler
  delete_node: ToolHandler
  create_edge: ToolHandler
  update_edge: ToolHandler
  delete_edge: ToolHandler
  pending_changes: ToolHandler
  discard_changes: ToolHandler
  commit_changes: ToolHandler
} {
  const resolveMulti = (src: GraphSource) => cache ? cache.get() : loadMultiGraph({ source: src })

  // Reads reflect the working session while one is open (design §7/§8):
  // un-branched reads serve the session's working graph; branch-scoped reads
  // for the session's own branch do too (see withBranchGraph). Behaviour with
  // no open session is unchanged.
  const readGraph = (): Graph => {
    const session = getActiveSession()
    return session && !session.isClosed() ? session.graph : graph
  }

  const requireSession = (): WorkingSession => {
    const session = getActiveSession()
    if (!session || session.isClosed()) {
      throw new QueryError('no working session is open — call start_changes first')
    }
    return session
  }

  return {
    list_nodes(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const filter = parseListNodesFilter(args.filter)
        const summaries = listNodes(targetGraph, filter)
          .map(node => summarizeNode(node, includesProvenance(args)))
        return formatResult(summaries, args.format, getCompactKeys(args))
      }

      if (hasBranch(args)) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    get_graph_summary(args) {
      const run = (targetGraph: Graph): ToolResult =>
        formatResult(getGraphSummary(targetGraph), args.format, getCompactKeys(args))

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    search_nodes(args) {
      const queries = Array.isArray(args.queries)
        ? args.queries.filter((query): query is string => typeof query === 'string')
        : []
      if (queries.length === 0) return errorResult(new QueryError('queries is required'))

      const run = (targetGraph: Graph): ToolResult => {
        const options: SearchNodesOptions = {
          templates: toStringArray(args.templates),
          excludeTemplates: toStringArray(args.exclude_templates),
          limit: typeof args.page_size === 'number' ? args.page_size : 10,
          offset: typeof args.offset === 'number' ? args.offset : 0,
          searchProperties: args.search_properties === true,
        }
        const wantFull = args.full_nodes === true
        const incProv = includesProvenance(args)
        const results = searchNodes(targetGraph, queries, options).map(result => ({
          score: result.score,
          node: wantFull
            ? fullNode(result.node, incProv)
            : summarizeNode(result.node, incProv),
        }))
        return formatResult(results, args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    list_templates(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const summaries = [...targetGraph.templates.values()]
          .map(template => ({
            name: template.name,
            version: template.info?.version,
            core: template.info?.core ?? false,
            abstract: template.info?.abstract ?? false,
            extends: template.extends,
            description: template.info?.description,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        return formatResult(summaries, args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    get_template(args) {
      try {
        const name = String(args.name)
        const template = readGraph().templates.get(name)
        if (!template) {
          throw new QueryError(`Template not found: ${name}`)
        }
        return formatResult(template, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    },

    get_cluster(args) {
      const overlayRefs = Array.isArray(args.overlay_refs)
        ? args.overlay_refs.filter((ref): ref is string => typeof ref === 'string')
        : []

      const run = async (targetGraph: Graph, branchRef?: string): Promise<ToolResult> => {
        const edgeTypes = parseEdgeTypes(args.edge_types, targetGraph)
          ?? getVisibleEdgeTypes(targetGraph)

        const rawCluster = getClusterView(targetGraph, String(args.node_id), edgeTypes)
        const clusterIds = new Set([rawCluster.root.id, ...rawCluster.descendants.map(n => n.id)])
        const externalIds = new Set<string>()
        for (const edge of rawCluster.edges) {
          if (!clusterIds.has(edge.from)) externalIds.add(edge.from)
          if (!clusterIds.has(edge.to)) externalIds.add(edge.to)
        }
        const cluster = { ...rawCluster, includedNodes: expandExternalNodes(targetGraph, externalIds) }
        const includeProvenance = includesProvenance(args)
        const collapseSchemas = args.collapse_schemas !== false
        const includeEdges = args.include_edges === true
        const includeDescendants = args.include_descendants !== false
        const nodeTypes = toStringArray(args.node_types)
        const edgeOptions = getEdgeOutputOptions(args)

        let clusterPayload: Record<string, unknown>
        if (collapseSchemas) {
          const collapsed = collapseClusterSchemas(targetGraph, cluster)
          let filteredDescendants = collapsed.descendants
          let filteredIncludedNodes = collapsed.includedNodes
          if (!includeDescendants) {
            filteredDescendants = []
            filteredIncludedNodes = []
          } else if (nodeTypes) {
            const typeSet = new Set(nodeTypes)
            filteredDescendants = filteredDescendants.filter(n => typeSet.has(n.template))
            filteredIncludedNodes = filteredIncludedNodes.filter(n => typeSet.has(n.template))
          }
          const mergedSchemas = { ...collapsed.schemas, ...collapsed.schemaEnums }
          clusterPayload = {
            root: {
              ...fullNode(collapsed.root, includeProvenance),
              ...(Object.keys(mergedSchemas).length > 0 ? { schemas: mergedSchemas } : {}),
              ...(Object.keys(collapsed.enums).length > 0 ? { enums: collapsed.enums } : {}),
            },
            ...(includeDescendants ? {
              descendants: filteredDescendants.map(node => fullNode(node, includeProvenance)),
              includedNodes: filteredIncludedNodes.map(node => fullNode(node, includeProvenance)),
            } : {}),
            ...(includeEdges ? { edges: collapsed.edges.map(e => mapEdge(e, edgeOptions)) } : {}),
          }
        } else {
          let filteredDescendants = cluster.descendants
          let filteredIncludedNodes = cluster.includedNodes
          if (!includeDescendants) {
            filteredDescendants = []
            filteredIncludedNodes = []
          } else if (nodeTypes) {
            const typeSet = new Set(nodeTypes)
            filteredDescendants = filteredDescendants.filter(n => typeSet.has(n.template))
            filteredIncludedNodes = filteredIncludedNodes.filter(n => typeSet.has(n.template))
          }
          clusterPayload = {
            root: fullNode(cluster.root, includeProvenance),
            ...(includeDescendants ? {
              descendants: filteredDescendants.map(node => fullNode(node, includeProvenance)),
              includedNodes: filteredIncludedNodes.map(node => fullNode(node, includeProvenance)),
            } : {}),
            ...(includeEdges ? { edges: cluster.edges.map(e => mapEdge(e, edgeOptions)) } : {}),
          }
        }
        if (overlayRefs.length === 0 || !source || !branchRef) {
          return formatResult(clusterPayload, args.format, getCompactKeys(args))
        }
        const multi = await resolveMulti(source)
        const overlay = computeClusterOverlay(multi, branchRef, overlayRefs, String(args.node_id))
        return formatResult({ ...clusterPayload, overlay }, args.format, getCompactKeys(args))
      }

      const branchRef = hasBranch(args) ? String(args.branch) : undefined

      if (branchRef) {
        return withBranchGraph(source, branchRef, branch => run(branch.graph, branchRef), cache)
      }

      return run(readGraph()).catch(err => errorResult(err))
    },

    get_graph(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const filter = parseListNodesFilter(args.filter)
        const effectiveFilter: ListNodesFilter = (!filter.templates?.length && !filter.excludeTemplates?.length)
          ? { ...filter, excludeTemplates: [...getStructuralNodeTemplates(targetGraph)] }
          : filter

        const nodes = listNodes(targetGraph, effectiveFilter)
          .map(node => summarizeNode(node, includesProvenance(args)))

        const payload: Record<string, unknown> = { nodes }
        if (args.include_edges === true) {
          const nodeIds = new Set(nodes.map(node => node.id))
          const edges: Array<{ id: string; from: string; to: string; type: string }> = []
          for (const edgeList of targetGraph.edgesByFrom.values()) {
            for (const edge of edgeList) {
              if (!isVisibleEdgeType(targetGraph, edge.type) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
              edges.push({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })
            }
          }
          payload.edges = edges
        }

        return formatResult(payload, args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    get_graph_metadata(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const nodeTemplatesInUse = new Set<string>()
        for (const node of targetGraph.nodesById.values()) nodeTemplatesInUse.add(node.template)

        const edgeTypesInUse = new Set<string>()
        for (const edgeList of targetGraph.edgesByFrom.values()) {
          for (const edge of edgeList) edgeTypesInUse.add(edge.type)
        }

        const includeStatic = args.include_static_enums === true
        return formatResult({
          template_names: [...targetGraph.templates.keys()].sort(),
          node_templates_in_use: [...nodeTemplatesInUse].sort(),
          edge_types_in_use: [...edgeTypesInUse].sort(),
          ...(includeStatic ? {
            valid_edge_types: [...(targetGraph.edgeTypes?.keys() ?? [])],
            states: [...STATE_VALUES],
            stabilities: [...STABILITY_VALUES],
            lineage_directions: [...LINEAGE_DIRECTIONS],
            output_formats: [...OUTPUT_FORMATS],
          } : {}),
        }, args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    get_lineage(args) {
      const nodeIds = Array.isArray(args.node_ids)
        ? args.node_ids.filter((id): id is string => typeof id === 'string')
        : []
      if (nodeIds.length === 0) return errorResult(new QueryError('node_ids is required'))

      const run = (targetGraph: Graph): ToolResult => {
        const direction = (['downstream', 'upstream', 'both'] as const).includes(args.direction as LineageDirection)
          ? args.direction as LineageDirection
          : 'downstream'
        const options: GetLineageOptions = {
          depth: typeof args.depth === 'number' ? args.depth : 2,
          direction,
          edgeTypes: parseEdgeTypes(args.edge_types, targetGraph),
          nodeTypes: toStringArray(args.node_types),
          excludeNodeTypes: toStringArray(args.exclude_node_types),
          includeDanglingEdges: args.include_dangling_edges === true,
          readsOutboundOnly: args.reads_outbound_only !== false,
        }
        const lineage = getLineage(targetGraph, nodeIds, options)
        const lean = args.lean !== false
        const includeEdges = args.include_edges === true
        const includeProvenance = includesProvenance(args)
        const edgeOptions = getEdgeOutputOptions(args)
        const payload: Record<string, unknown> = {
          nodes: lineage.nodes.map(node => mapLineageNode(node as unknown as Record<string, unknown>, includeProvenance, lean)),
        }
        if (includeEdges) payload.edges = lineage.edges.map(e => mapEdge(e, edgeOptions))
        if (args.include_dangling_edges === true && lineage.dangling_edges) payload.dangling_edges = lineage.dangling_edges
        return formatResult(payload, args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    get_linked_fields(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const linked = getLinkedFields(targetGraph, String(args.node_id))
        const incProv = includesProvenance(args)
        const edgeOptions = getEdgeOutputOptions(args)
        return formatResult({
          edges: linked.edges.map(e => mapEdge(e, edgeOptions)),
          nodes: linked.nodes.map(node => fullNode(node, incProv)),
        }, args.format, getCompactKeys(args))
      }

      if (hasBranch(args)) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph), cache)
      }

      try {
        return run(readGraph())
      } catch (err) {
        return errorResult(err)
      }
    },

    async list_branches(args) {
      try {
        if (!source) throw new QueryError('GraphSource is required for list_branches')
        const multi = await resolveMulti(source)
        const summaries = multi.branchResults.map(result => ({
          ref: result.ref,
          status: result.status,
          error: result.error,
          isDefault: result.ref === multi.default.ref,
        }))
        return formatResult(summaries, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    },

    async diff_branch(args) {
      try {
        if (!source) throw new QueryError('GraphSource is required for diff_branch')
        if (typeof args.branch !== 'string' || args.branch.length === 0) {
          throw new QueryError('branch is required')
        }
        const multi = await resolveMulti(source)
        return formatResult(multi.diff(args.branch), args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    },

    // -- write tools (design §8): thin wrappers over the working session ------

    async start_changes(args) {
      try {
        if (!source) throw new QueryError('GraphSource is required for start_changes')
        const session = await startSession(source, {
          branch: typeof args.branch === 'string' ? args.branch : undefined,
          create: args.create === true,
          ...(typeof args.autosave === 'boolean' ? { autosave: args.autosave } : {}),
        })
        return formatResult({
          branch: session.branch,
          default_branch: session.defaultBranch,
          base_sha: session.baseSha,
          autosave: session.autosave,
        }, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async apply_cluster(args) {
      try {
        const session = requireSession()
        if (args.mode !== 'merge' && args.mode !== 'replace') {
          throw new QueryError("mode must be 'merge' or 'replace'")
        }
        if (!isPlainObject(args.document)) {
          throw new QueryError('document must be an object (cluster-style document)')
        }
        const result = await session.applyCluster(args.document, args.mode as 'merge' | 'replace')
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async create_node(args) {
      try {
        const session = requireSession()
        if (!isPlainObject(args.document)) {
          throw new QueryError('document is required and must be an object')
        }
        const result = await session.createNode({
          document: args.document,
          parentId: typeof args.parent_id === 'string' ? args.parent_id : undefined,
          section: typeof args.section === 'string' ? args.section : undefined,
          name: typeof args.name === 'string' ? args.name : undefined,
        })
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async update_node(args) {
      try {
        const session = requireSession()
        const result = await session.updateNode(requireString(args.id, 'id'), {
          properties: isPlainObject(args.properties) ? args.properties : undefined,
          state: args.state as State | undefined,
          stability: args.stability as Stability | undefined,
        })
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async rename_node(args) {
      try {
        const session = requireSession()
        const result = await session.renameNode(
          requireString(args.id, 'id'),
          requireString(args.new_name, 'new_name'),
          typeof args.record_trail === 'boolean' ? args.record_trail : undefined,
        )
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async delete_node(args) {
      try {
        const session = requireSession()
        const result = await session.deleteNode(requireString(args.id, 'id'), {
          purge: args.purge === true,
          recordTrail: typeof args.record_trail === 'boolean' ? args.record_trail : undefined,
        })
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async create_edge(args) {
      try {
        const session = requireSession()
        const result = await session.createEdge({
          from: requireString(args.from, 'from'),
          to: requireString(args.to, 'to'),
          type: requireString(args.type, 'type'),
          state: args.state as State | undefined,
          stability: args.stability as Stability | undefined,
          notes: typeof args.notes === 'string' ? args.notes : undefined,
          properties: isPlainObject(args.properties) ? args.properties : undefined,
        })
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async update_edge(args) {
      try {
        const session = requireSession()
        const result = await session.updateEdge(requireString(args.id, 'id'), {
          state: args.state as State | undefined,
          stability: args.stability as Stability | undefined,
          notes: args.notes === null ? null : typeof args.notes === 'string' ? args.notes : undefined,
          properties: isPlainObject(args.properties) ? args.properties : undefined,
        })
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async delete_edge(args) {
      try {
        const session = requireSession()
        const result = await session.deleteEdge(requireString(args.id, 'id'))
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    pending_changes(args) {
      try {
        const session = requireSession()
        return formatResult(session.pendingChanges(), args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async discard_changes(args) {
      try {
        const session = requireSession()
        const branch = session.branch
        session.discard()
        if (session.autosave && session.branch === session.defaultBranch && source) {
          const fresh = await loadGraph({ source, ref: session.defaultBranch, strict: false })
          cache?.invalidate()
          replaceGraph(graph, fresh)
        }
        return formatResult({ discarded: true, branch }, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async commit_changes(args) {
      try {
        const session = requireSession()
        const result = await session.commitChanges(typeof args.message === 'string' ? args.message : undefined)
        // Committed content invalidates branch-scoped caches; when the session
        // was on the default branch, refresh the base graph in place so
        // post-session reads see the committed state.
        cache?.invalidate()
        if (result.committed && session.branch === session.defaultBranch) {
          replaceGraph(graph, session.graph)
        }
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new QueryError(`${name} is required`)
  }
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function withBranchGraph(
  source: GraphSource | undefined,
  branchRef: string,
  fn: (branch: BranchGraph) => MaybePromise<ToolResult>,
  cache?: MultiGraphCache,
): Promise<ToolResult> {
  try {
    // While a working session is open, branch-scoped reads of the session's
    // branch serve the working graph (design §7: reads see the working state).
    const session = getActiveSession()
    if (session && !session.isClosed() && session.branch === branchRef) {
      return await fn({ ref: branchRef, isDefault: branchRef === session.defaultBranch, graph: session.graph })
    }
    if (!source) throw new QueryError('GraphSource is required when branch is provided')
    const multi = cache ? await cache.get() : await loadMultiGraph({ source })
    const branch = multi.branches.find(item => item.ref === branchRef)
    if (!branch) throw new QueryError(`branch '${branchRef}' not found or failed to load`)
    return fn(branch)
  } catch (err) {
    return errorResult(err)
  }
}

function hasBranch(args: Record<string, unknown>): boolean {
  return typeof args.branch === 'string' && args.branch.length > 0
}

/**
 * Retries a previously-failed graph load. Only attempts the load when `loadError` is set —
 * a healthy graph is never re-loaded on the hot call path. On success, `graph` is mutated in
 * place (via `replaceGraph`) so existing closures over it observe the fresh data, and
 * `onReload` fires so callers can invalidate any dependent caches (e.g. a MultiGraphCache).
 * Returns the resulting error, if any (undefined once recovered).
 */
export async function ensureGraphLoaded(
  graph: Graph,
  loadError: string | undefined,
  loader: () => Promise<Graph>,
  onReload?: () => void,
): Promise<string | undefined> {
  if (!loadError) return undefined
  try {
    const fresh = await loader()
    replaceGraph(graph, fresh)
    onReload?.()
    return undefined
  } catch (err) {
    return String(err)
  }
}

function formatResult(value: unknown, format: unknown, compact: unknown = false): ToolResult {
  const payload = compact === true ? compactKeys(value) : value
  return { content: [{ type: 'text', text: getSerializer(format).serialize(payload) }] }
}

function getCompactKeys(args: Record<string, unknown>): boolean {
  return args.compact_keys === true || args.compactKeys === true
}

function errorResult(err: unknown, format?: unknown): ToolResult {
  // Validation failures return the linter's diagnostic format (severity,
  // message, nodeId) so agents can self-correct (design §8).
  if (err instanceof MutationError) {
    const payload = {
      error: err.message,
      diagnostics: err.diagnostics.map(d => ({
        severity: d.severity,
        message: d.message,
        ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
      })),
    }
    let text: string
    try {
      text = getSerializer(format).serialize(payload)
    } catch {
      text = getSerializer(undefined).serialize(payload)
    }
    return { content: [{ type: 'text', text }], isError: true }
  }
  const message = err instanceof QueryError ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function getMcpToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_nodes',
      description: 'List nodes in the graph. Returns id, template, component, state, stability for each matched node.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            description: 'Filter criteria',
            properties: {
              templates: {
                type: 'array',
                items: { type: 'string' },
                description: 'Include only these template types (OR semantics)',
              },
              exclude_templates: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exclude these template types',
              },
              component: { type: 'string', description: 'Filter by component name' },
              state: {
                description: 'Filter by lifecycle state as a string or array',
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              stability: {
                description: 'Filter by stability as a string or array',
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
            },
          },
          include_provenance: { type: 'boolean', description: 'Include provenance fields on returned nodes. Default false.' },
          branch: { type: 'string', description: 'Branch ref to load nodes from' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'list_templates',
      description: 'List loaded graph templates. Returns name, version, core, abstract, extends, and description for each template.',
      inputSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Branch ref to load templates from' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'get_template',
      description: 'Get full details for a loaded graph template.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Template name' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'get_cluster',
      description: 'Use when you need the full structural contents of a single node - its schema, fields, and owned children. Not suited for following relationships across the graph; use get_lineage for that.\n\nBy default returns only the root node with its collapsed schema and enums blocks (descendants and edges excluded). Pass include_descendants: true to include owned operations/commands/events. Pass include_edges: true to include the edge list.',
      inputSchema: {
        type: 'object',
        required: ['node_id'],
        properties: {
          node_id: { type: 'string', description: 'Fully qualified node ID' },
          edge_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Edge types to follow for external node inclusion. Defaults to all semantic types.',
          },
          collapse_schemas: { type: 'boolean', description: 'Collapse schema/enum child nodes into compact schemas and enums blocks on the root. Structural edges and schema child nodes are removed from descendants. Default true.' },
          include_descendants: { type: 'boolean', description: 'Include descendant nodes (operations, commands, events, and cross-component nodes). Default true.' },
          node_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowlist of node templates to include in the descendant set. Useful for limiting to specific types (e.g. ["DomainOperation", "DomainEvent"]).',
          },
          include_edges: { type: 'boolean', description: 'Include the edge list in the response. Default false.' },
          include_edge_ids: { type: 'boolean', description: 'Include edge id field in edge output. Default false.' },
          include_provenance: { type: 'boolean', description: 'Include provenance fields on returned nodes. Default false.' },
          branch: { type: 'string', description: 'Branch ref to load the cluster from' },
          overlay_refs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Branch refs to overlay. Returns ghost field data alongside the cluster.',
          },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'get_graph',
      description: 'Return semantic nodes (and optionally edges) across the graph. Excludes structural templates and structural edge types by default. Pass include_edges: true to include the semantic edge list.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: {
              templates: { type: 'array', items: { type: 'string' } },
              exclude_templates: { type: 'array', items: { type: 'string' } },
              component: { type: 'string' },
              state: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              stability: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            },
          },
          include_edges: { type: 'boolean', description: 'Include the semantic edge list in the response. Default false.' },
          include_provenance: { type: 'boolean', description: 'Include provenance fields on returned nodes. Default false.' },
          branch: { type: 'string', description: 'Branch ref to load the graph from' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'get_graph_metadata',
      description: 'Return discoverable graph metadata: template names, node templates in use, edge types in use. Call this first before making traversal queries. The edge_types_in_use field tells you which edge types are actually modelled in the current graph - there is no value traversing edge types that have no entries. Pass include_static_enums: true to also receive valid_edge_types, states, stabilities, lineage_directions, and output_formats.',
      inputSchema: {
        type: 'object',
        properties: {
          include_static_enums: { type: 'boolean', description: 'Include static enum reference fields (valid_edge_types, states, stabilities, lineage_directions, output_formats). Default false.' },
          branch: { type: 'string', description: 'Branch ref to load metadata from' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'get_lineage',
      description: 'Traverse the graph from one or more origin nodes via BFS and return annotated lineage results. Pass multiple node_ids to expand all origins in parallel in a single call rather than making separate calls - results are merged and deduplicated automatically.\n\nCommon patterns:\n- Event fan-out - direction: downstream, depth: 2 from an event node to see all triggered commands and the operations they invoke.\n- Find all writers to an aggregate - direction: upstream from a DomainModel node to see every command and operation that writes to it.\n- Full event chain - direction: downstream, depth: 3 or more to trace event -> command -> operation -> produced event chains.',
      inputSchema: {
        type: 'object',
        required: ['node_ids'],
        properties: {
          node_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fully-qualified IDs of origin nodes. All expand in parallel.',
          },
          depth: { type: 'number', description: 'Max hops. Default 2.' },
          direction: { type: 'string', enum: ['downstream', 'upstream', 'both'], description: 'Traversal direction. Default downstream.' },
          edge_types: { type: 'array', items: { type: 'string' }, description: 'Edge types to traverse. Default: all non-structural.' },
          node_types: { type: 'array', items: { type: 'string' }, description: 'Allowlist of node templates.' },
          exclude_node_types: { type: 'array', items: { type: 'string' }, description: 'Denylist of node templates.' },
          include_dangling_edges: { type: 'boolean', description: 'Include dangling edges in the response when present. Default false.' },
          reads_outbound_only: { type: 'boolean', description: 'Do not follow inbound reads/uses-type edges in upstream traversal. Default true.' },
          lean: { type: 'boolean', description: 'Return minimal lineage node shape. Default true.' },
          include_edges: { type: 'boolean', description: 'Include the edges list in the response. Default false.' },
          include_edge_ids: { type: 'boolean', description: 'Include edge id field in edge output. Default false.' },
          include_provenance: { type: 'boolean', description: 'Include provenance fields on returned nodes. Default false.' },
          branch: { type: 'string', description: 'Branch ref to load the lineage from' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'get_linked_fields',
      description: 'Get all maps-to edges touching fields owned by the given root node.',
      inputSchema: {
        type: 'object',
        required: ['node_id'],
        properties: {
          node_id: { type: 'string', description: 'Fully qualified root node ID' },
          include_edge_ids: { type: 'boolean', description: 'Include edge id field in edge output. Default false.' },
          include_provenance: { type: 'boolean', description: 'Include provenance fields on returned nodes. Default false.' },
          branch: { type: 'string', description: 'Branch ref to load linked fields from' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'get_graph_summary',
      description: 'Return high-level statistics: node count, component count, orphan breakdown, edge counts by type, diagnostic count.',
      inputSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Branch ref to load the summary from' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'search_nodes',
      description: 'Fuzzy search for root-level nodes by ID segments. Returns slim node summaries (id, template, component, state, stability) by default. Pass full_nodes: true to include properties. Prefer this over list_nodes when you have a domain term to search for - it returns ranked, targeted results without noise. Use list_nodes only when you need a complete inventory of nodes matching specific filter criteria.',
      inputSchema: {
        type: 'object',
        required: ['queries'],
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Search terms. OR semantics; any matching term qualifies the node.',
          },
          templates: { type: 'array', items: { type: 'string' }, description: 'Include only these template types.' },
          exclude_templates: { type: 'array', items: { type: 'string' }, description: 'Exclude these template types.' },
          page_size: { type: 'number', description: 'Max results to return. Default 10.' },
          offset: { type: 'number', description: 'Result offset for pagination. Default 0.' },
          search_properties: { type: 'boolean', description: 'Also match name, description, and x-aka properties.' },
          full_nodes: { type: 'boolean', description: 'Include properties on each result node. Default false.' },
          include_provenance: { type: 'boolean', description: 'Include provenance fields on returned nodes. Default false.' },
          branch: { type: 'string', description: 'Branch ref to search within' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'list_branches',
      description: 'List branches available from the configured graph source and their load status.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'diff_branch',
      description: 'Diff a branch against the default branch. Rename-aware: branch IDs are resolved through the default branch\'s rename trail before matching, so a branch still holding an old name overlays onto the renamed node instead of appearing as add+remove. The result\'s warnings field flags branches that modify a node under a retired name ("edits a retired name") — rebase the branch or apply the rename.',
      inputSchema: {
        type: 'object',
        required: ['branch'],
        properties: {
          branch: { type: 'string', description: 'Branch ref to diff against the default branch' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'start_changes',
      description: 'Open a working session for graph mutations. All other write tools require an open session; while a session is open, read tools reflect the working (uncommitted) state. Mutations stay in the session until commit_changes; discard_changes aborts. autosave defaults OFF for both file and git sources — prefer leaving it off unless you explicitly want per-mutation checkpoints. When autosave is ON, file sources write through to disk immediately and git sources land a "corum-wip:" checkpoint commit per mutation; commit_changes squashes the WIP run into a single commit when no external commit interleaved. Git default branches are read-only for writes: pass a writable branch explicitly or use create: true to fork one from the default branch head. Starting while a session with pending changes is open is an error — commit_changes or discard_changes first; with no pending changes the old session is reset cleanly.',
      inputSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Branch to load and commit to. Defaults to the source\'s default branch.' },
          create: { type: 'boolean', description: 'Fork a new branch from the default branch head (git sources only). Default false.' },
          autosave: { type: 'boolean', description: 'Override the autosave default (OFF by default. When ON: file sources write through immediately; git sources create WIP checkpoint commits).' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'apply_cluster',
      description: 'Upsert a cluster-style nested document — the same shape as cluster YAML: root node fields (id, template, properties, state/stability) plus owned sections keyed by child local name, with child properties flattened at the top level of each child. Requires an open session (start_changes).\n\nmode "merge": updates only what the document mentions — absent children and absent owned sections are left untouched (a null property value clears that key).\n\nmode "replace": WARNING — the document becomes AUTHORITATIVE for every owned section of the root\'s template. Children absent from the document are DELETED, and an ABSENT owned section means an EMPTY section: ALL of its children are DELETED (soft delete with state removed when the node exists on the default branch, hard purge otherwise). Only use replace with the complete intended contents of the cluster.\n\nA changed child key is NEVER treated as a rename: it is delete+add, and the response carries a possible-rename warning when a replace deletes and creates children with the same template under the same parent. To rename, use rename_node — it is the only rename path. Sections the template does not declare as owned are never touched.',
      inputSchema: {
        type: 'object',
        required: ['document', 'mode'],
        properties: {
          document: { type: 'object', description: 'Cluster-style document (root node plus owned sections with named children).' },
          mode: { type: 'string', enum: ['merge', 'replace'], description: 'merge: update what is present, leave the rest. replace: document is authoritative for owned sections — absent children/sections are DELETED.' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'create_node',
      description: 'Create a root cluster (omit parent_id; document requires id and template) or an owned child under an existing parent (pass parent_id, section, and name; document holds the child body with properties flattened at the top level). Nested owned children in the document are created in the same call and structural edges (has-field, has-value) generate automatically. Defaults: state "proposed", stability "unstable". Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        required: ['document'],
        properties: {
          document: { type: 'object', description: 'Cluster-style document. Roots: { id, template, properties?, ...ownedSections }. Owned children: the child body (properties flattened, optional nested owned sections).' },
          parent_id: { type: 'string', description: 'Owning parent node ID — omit to create a root cluster.' },
          section: { type: 'string', description: 'Owned section under the parent (e.g. "fields", "schemas"); required with parent_id.' },
          name: { type: 'string', description: 'Local name for the new owned child; required with parent_id.' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'update_node',
      description: 'Patch a node\'s properties, state, or stability. properties is a patch: only the keys given are changed, and a null value clears that key. Cannot change the node\'s name — that is rename_node (names are identity, never a property edit). Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Fully qualified node ID' },
          properties: { type: 'object', description: 'Property patch — null clears a key.' },
          state: { type: 'string', enum: [...STATE_VALUES], description: 'New lifecycle state.' },
          stability: { type: 'string', enum: [...STABILITY_VALUES], description: 'New stability.' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'rename_node',
      description: 'Rename a node (replace the last segment of its ID with new_name). Descendant IDs, parentId fields, and every edge endpoint are rewritten automatically; renaming a cluster root also moves its file at commit. Trail: by default, a rename records corum.identity.previousIds plus a renamed-from edge iff the node exists on the default branch head (i.e. the old name is shared history); record_trail forces (true) or suppresses (false) the trail. This is the ONLY rename path — apply_cluster and imports never infer renames. Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        required: ['id', 'new_name'],
        properties: {
          id: { type: 'string', description: 'Fully qualified node ID to rename' },
          new_name: { type: 'string', description: 'New last segment (ID grammar: [A-Za-z0-9_-], no dots).' },
          record_trail: { type: 'boolean', description: 'Override the trail threshold: true forces recording corum.identity.previousIds + renamed-from; false suppresses it.' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'delete_node',
      description: 'Delete a node and its owned subtree. Two tiers: soft delete sets state "removed" on the subtree (nodes stay in YAML and remain queryable); hard delete removes the subtree and every edge touching it. Default tier: soft when the node exists on the default branch head (shared history), hard otherwise (pure design work leaves no tombstones). purge: true always hard-deletes; record_trail overrides the threshold (true forces soft, false forces hard). Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Fully qualified node ID to delete' },
          purge: { type: 'boolean', description: 'Force hard delete of the subtree and all touching edges. Default false.' },
          record_trail: { type: 'boolean', description: 'Override the soft/hard threshold: true forces soft delete, false forces hard delete.' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'create_edge',
      description: 'Create an explicit edge between two nodes. Validated against endpoint existence and the pack edge-type vocabulary; edge-type constraint violations are returned as warnings. Defaults: state "proposed", stability "unstable". Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        required: ['from', 'to', 'type'],
        properties: {
          from: { type: 'string', description: 'Source node ID' },
          to: { type: 'string', description: 'Target node ID' },
          type: { type: 'string', description: 'Edge type (see get_graph_metadata valid_edge_types).' },
          state: { type: 'string', enum: [...STATE_VALUES], description: 'Lifecycle state. Default "proposed".' },
          stability: { type: 'string', enum: [...STABILITY_VALUES], description: 'Stability. Default "unstable".' },
          notes: { type: 'string', description: 'Free-text notes on the edge.' },
          properties: { type: 'object', description: 'Edge properties (validated against the pack edge-type schema).' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'update_edge',
      description: 'Patch an explicit edge\'s state, stability, notes, or properties. Endpoints and type are IMMUTABLE — delete_edge and create_edge instead. notes: null clears the notes; a null property value clears that key. Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Edge ID ({from}__{type}__{to})' },
          state: { type: 'string', enum: [...STATE_VALUES], description: 'New lifecycle state.' },
          stability: { type: 'string', enum: [...STABILITY_VALUES], description: 'New stability.' },
          notes: { description: 'New notes; null clears them.' },
          properties: { type: 'object', description: 'Property patch — null clears a key.' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'delete_edge',
      description: 'Delete an edge. Always a hard removal — edges carry no subtree. To soft-remove a relationship instead, use update_edge with state "removed". Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Edge ID ({from}__{type}__{to})' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'pending_changes',
      description: 'Show the open session\'s change journal and a summary diff (added/modified/removed node and edge counts) of the working graph against the session base. Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'discard_changes',
      description: 'Abort the working session without committing. With the default autosave OFF, this drops the in-memory session changes. Note: if autosave was turned ON for a file source, mutations already written to disk are NOT rolled back. Requires an open session (start_changes).',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
    {
      name: 'commit_changes',
      description: 'Lint, serialise, and commit the working graph, then close the session. The full linter runs first: error diagnostics BLOCK the commit (the session stays open to fix and retry); warnings ride along. Default message summarises the journal. Git autosave sessions squash their "corum-wip:" checkpoint run into a single commit when no external commit interleaved (otherwise the final commit lands on top and checkpoints are preserved); file-source autosave sessions have already persisted each mutation, so commit_changes just closes the session. Fails if the branch head moved externally since session start.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message. Default: a summary of the session journal.' },
          format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
          compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
        },
      },
    },
  ]
}

// TODO: A future library-first refactor (src/runtime/) would be the right path
// if external consumers of this startup API emerge. For now, the CLI is the only consumer.
export type McpServerOptions = {
  noWeb?: boolean
  watch?: boolean
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const { noWeb = false, watch = false } = options
  const config = createGraphRuntimeConfig()

  let graph: Graph
  let loadError: string | undefined

  try {
    graph = await loadGraph({ source: config.source, strict: true })
  } catch (err) {
    loadError = String(err)
    graph = {
      nodesById: new Map(),
      edgesByFrom: new Map(),
      edgesByTo: new Map(),
      templates: new Map(),
      diagnostics: [],
    }
  }

  const mcpCache = config.source ? createMultiGraphCache(config.source) : undefined
  const handlers = createMcpHandlers(graph, config.source, mcpCache)

  if (!noWeb) {
    try {
      await startWebServer(graph, {
        graphPath: config.graphPath,
        fileWatcher: config.fileWatcherGraphPath && watch ? true : undefined,
        source: config.source,
        onReload: () => mcpCache?.invalidate(),
      })
    } catch (err) {
      process.stderr.write(`[corum] web server failed to start, continuing MCP-only: ${err}\n`)
    }
  } else if (watch && config.fileWatcherGraphPath) {
    startGraphFileWatcher(graph, {
      graphPath: config.fileWatcherGraphPath,
      onReload: () => mcpCache?.invalidate(),
    })
  }

  const server = new Server(
    { name: 'corum', version: '0.1.0' },
    { capabilities: { tools: {}, prompts: {} } },
  )


  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'usage-guide',
        description: 'Orientation guide - recommended workflow, node ID format, edge types, output formats, and common query patterns.',
      },
    ],
  }))

  server.setRequestHandler(GetPromptRequestSchema, async request => {
    if (request.params.name !== 'usage-guide') {
      throw new Error(`Unknown prompt: ${request.params.name}`)
    }
    return {
      description: 'Corum graph query orientation guide',
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: USAGE_GUIDE_PROMPT } },
      ],
    }
  })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getMcpToolDefinitions(),
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    loadError = await ensureGraphLoaded(
      graph,
      loadError,
      () => loadGraph({ source: config.source, strict: true }),
      () => mcpCache?.invalidate(),
    )

    if (loadError) {
      return { content: [{ type: 'text', text: `Graph load error: ${loadError}` }], isError: true }
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    switch (request.params.name) {
      case 'list_nodes':
        return await handlers.list_nodes(args)
      case 'list_templates':
        return await handlers.list_templates(args)
      case 'get_template':
        return await handlers.get_template(args)
      case 'get_cluster':
        return await handlers.get_cluster(args)
      case 'get_graph':
        return await handlers.get_graph(args)
      case 'get_graph_metadata':
        return await handlers.get_graph_metadata(args)
      case 'get_lineage':
        return await handlers.get_lineage(args)
      case 'get_linked_fields':
        return await handlers.get_linked_fields(args)
      case 'get_graph_summary':
        return await handlers.get_graph_summary(args)
      case 'search_nodes':
        return await handlers.search_nodes(args)
      case 'list_branches':
        return await handlers.list_branches(args)
      case 'diff_branch':
        return await handlers.diff_branch(args)
      case 'start_changes':
        return await handlers.start_changes(args)
      case 'apply_cluster':
        return await handlers.apply_cluster(args)
      case 'create_node':
        return await handlers.create_node(args)
      case 'update_node':
        return await handlers.update_node(args)
      case 'rename_node':
        return await handlers.rename_node(args)
      case 'delete_node':
        return await handlers.delete_node(args)
      case 'create_edge':
        return await handlers.create_edge(args)
      case 'update_edge':
        return await handlers.update_edge(args)
      case 'delete_edge':
        return await handlers.delete_edge(args)
      case 'pending_changes':
        return await handlers.pending_changes(args)
      case 'discard_changes':
        return await handlers.discard_changes(args)
      case 'commit_changes':
        return await handlers.commit_changes(args)
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true }
    }
  })

  printBanner({
    config: [{ key: 'graphPath', value: config.graphPath }],
    services: [{ name: 'mcp', url: 'stdio' }],
    logger: (line) => process.stderr.write(line + '\n'),
  })

  await server.connect(new StdioServerTransport())
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isEntrypoint()) {
  await startMcpServer()
}
