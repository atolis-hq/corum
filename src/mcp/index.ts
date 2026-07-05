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
import { buildUsageGuidePrompt } from './prompts/usage-guide.js'
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
  create_edges: ToolHandler
  update_edge: ToolHandler
  delete_edge: ToolHandler
  create_fields: ToolHandler
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
        const results = searchNodes(targetGraph, queries, options).map(result =>
          wantFull
            ? fullNode(result.node, incProv)
            : summarizeNode(result.node, incProv),
        )
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
        const includeDescendants = args.include_descendants === true
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

    async create_fields(args) {
      try {
        const session = requireSession()
        if (!Array.isArray(args.fields)) {
          throw new QueryError('fields is required and must be an array')
        }
        const results = []
        for (const field of args.fields) {
          if (!isPlainObject(field)) {
            throw new QueryError('each field must be an object')
          }
          const parentId = requireString(field.parent_id || field.parentId, 'field.parent_id')
          const schemaName = requireString(field.schema_name || field.schemaName, 'field.schema_name')
          const fieldName = requireString(field.name, 'field.name')
          const fieldDef: Record<string, unknown> = {
            type: requireString(field.type, 'field.type'),
          }
          if (field.nullable !== undefined) {
            fieldDef.nullable = field.nullable === true
          }
          if (typeof field.description === 'string') {
            fieldDef.description = field.description
          }
          const document: Record<string, unknown> = {
            id: parentId,
            schemas: {
              [schemaName]: {
                fields: {
                  [fieldName]: fieldDef,
                },
              },
            },
          }
          const result = await session.applyCluster(document, 'merge')
          results.push({ parentId, schemaName, fieldName, summary: result.summary, createdIds: result.createdIds, warnings: result.warnings })
        }
        return formatResult({ created: results.length, fields: results }, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err, args.format)
      }
    },

    async create_edges(args) {
      try {
        const session = requireSession()
        if (!Array.isArray(args.edges)) {
          throw new QueryError('edges is required and must be an array')
        }
        const results = []
        for (const edge of args.edges) {
          if (!isPlainObject(edge)) {
            throw new QueryError('each edge must be an object')
          }
          const result = await session.createEdge({
            from: requireString(edge.from, 'edge.from'),
            to: requireString(edge.to, 'edge.to'),
            type: requireString(edge.type, 'edge.type'),
            state: edge.state as State | undefined,
            stability: edge.stability as Stability | undefined,
            notes: typeof edge.notes === 'string' ? edge.notes : undefined,
            properties: isPlainObject(edge.properties) ? edge.properties : undefined,
          })
          results.push({ edge: result.edge, summary: result.summary, warnings: result.warnings })
        }
        return formatResult({ created: results.length, edges: results }, args.format, getCompactKeys(args))
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
  return { content: [{ type: 'text', text: getSerializer(format ?? 'toon').serialize(payload) }] }
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
      text = getSerializer(format ?? 'toon').serialize(payload)
    } catch {
      text = getSerializer(undefined).serialize(payload)
    }
    return { content: [{ type: 'text', text }], isError: true }
  }
  const message = err instanceof QueryError ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

// Shared parameter schemas — these appear on nearly every tool, so factoring
// them out keeps the always-loaded tool definitions lean and consistent. Deep
// guidance (compact_keys mapping, toon rationale, workflows) lives in the
// on-demand usage-guide prompt, not here.
const FORMAT_PARAM = { type: 'string', enum: [...OUTPUT_FORMATS], description: 'Default toon (lean, self-describing). yaml for humans, json for conventional parsing.' }
const COMPACT_KEYS_PARAM = { type: 'boolean', description: 'Abbreviate field-name keys to save tokens (see usage-guide). Default false.' }
const BRANCH_READ_PARAM = { type: 'string', description: 'Branch ref to read from. Default: open session or source default.' }
const PROVENANCE_PARAM = { type: 'boolean', description: 'Include node provenance (source/derivation). Default false.' }
const EDGE_IDS_PARAM = { type: 'boolean', description: 'Include edge ids in edge output. Default false.' }
const STATE_PARAM = { type: 'string', enum: [...STATE_VALUES], description: 'Lifecycle state.' }
const STABILITY_PARAM = { type: 'string', enum: [...STABILITY_VALUES], description: 'Stability.' }
const IO_PARAMS = { format: FORMAT_PARAM, compact_keys: COMPACT_KEYS_PARAM }

export function getMcpToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_nodes',
      description: 'Root nodes matching a filter, as slim summaries. Prefer search_nodes for keyword discovery; use this for exhaustive filtered inventories.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: {
              templates: { type: 'array', items: { type: 'string' }, description: 'Include only these templates (OR).' },
              exclude_templates: { type: 'array', items: { type: 'string' }, description: 'Exclude these templates.' },
              component: { type: 'string', description: 'Filter by component.' },
              state: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              stability: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            },
          },
          include_provenance: PROVENANCE_PARAM,
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'list_templates',
      description: 'List loaded templates with summary metadata (name, version, core, abstract, extends, description).',
      inputSchema: {
        type: 'object',
        properties: {
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'get_template',
      description: 'Full definition of one template: property schema, owned sections, edge-type constraints, role.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Template name.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'get_cluster',
      description: 'Structural detail of ONE node. Returns the root with its collapsed schemas/enums (compact JSON-schema form, not child nodes) by default. Owned descendants (operations, commands, events) are opt-in via include_descendants:true and can be large — narrow with node_types. To follow relationships across nodes use get_lineage instead.',
      inputSchema: {
        type: 'object',
        required: ['node_id'],
        properties: {
          node_id: { type: 'string', description: 'Fully qualified node ID.' },
          edge_types: { type: 'array', items: { type: 'string' }, description: 'External-node edge types to follow. Default: all semantic.' },
          collapse_schemas: { type: 'boolean', description: 'Collapse schema/enum children into compact schemas+enums blocks on the root. Default true.' },
          include_descendants: { type: 'boolean', description: 'Include owned descendants (operations, commands, events). Opt-in; can be large. Default false.' },
          node_types: { type: 'array', items: { type: 'string' }, description: 'Restrict descendants to these templates.' },
          include_edges: { type: 'boolean', description: 'Include the edge list. Default false.' },
          include_edge_ids: EDGE_IDS_PARAM,
          include_provenance: PROVENANCE_PARAM,
          branch: BRANCH_READ_PARAM,
          overlay_refs: { type: 'array', items: { type: 'string' }, description: 'Branch refs to overlay as ghost field data.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'get_graph',
      description: 'Semantic nodes across the whole graph (structural templates/edges excluded); include_edges adds semantic edges. Whole-graph payload is large — prefer search_nodes or get_lineage for targeted work.',
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
          include_edges: { type: 'boolean', description: 'Include semantic edges. Default false.' },
          include_provenance: PROVENANCE_PARAM,
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'get_graph_metadata',
      description: 'Discover graph contents: template names, node templates in use, edge types in use. Call first; only traverse edge types listed in edge_types_in_use. include_static_enums:true adds valid edge types, states, stabilities, directions, formats.',
      inputSchema: {
        type: 'object',
        properties: {
          include_static_enums: { type: 'boolean', description: 'Also return valid edge types, states, stabilities, directions, formats. Default false.' },
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'get_lineage',
      description: 'BFS traversal from origin node(s); returns reachable nodes annotated with depth and the edge/node they arrived via. Batch multiple node_ids in one call — results merge and dedupe. Lean by default; scope with direction, depth, and edge_types.',
      inputSchema: {
        type: 'object',
        required: ['node_ids'],
        properties: {
          node_ids: { type: 'array', items: { type: 'string' }, description: 'Origin node IDs; all expand in parallel.' },
          depth: { type: 'number', description: 'Max hops. Default 2.' },
          direction: { type: 'string', enum: ['downstream', 'upstream', 'both'], description: 'Default downstream.' },
          edge_types: { type: 'array', items: { type: 'string' }, description: 'Edge types to traverse. Default: all non-structural.' },
          node_types: { type: 'array', items: { type: 'string' }, description: 'Template allowlist.' },
          exclude_node_types: { type: 'array', items: { type: 'string' }, description: 'Template denylist.' },
          include_dangling_edges: { type: 'boolean', description: 'Include dangling edges. Default false.' },
          reads_outbound_only: { type: 'boolean', description: 'Skip inbound reads/uses-type in upstream traversal. Default true.' },
          lean: { type: 'boolean', description: 'Minimal node shape (ids + traversal annotations only). Default true.' },
          include_edges: { type: 'boolean', description: 'Include edges. Default false.' },
          include_edge_ids: EDGE_IDS_PARAM,
          include_provenance: PROVENANCE_PARAM,
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'get_linked_fields',
      description: 'All maps-to edges touching fields owned by the given root node.',
      inputSchema: {
        type: 'object',
        required: ['node_id'],
        properties: {
          node_id: { type: 'string', description: 'Fully qualified root node ID.' },
          include_edge_ids: EDGE_IDS_PARAM,
          include_provenance: PROVENANCE_PARAM,
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'get_graph_summary',
      description: 'High-level stats: node count, component count, orphan breakdown, edge counts by type, diagnostic count.',
      inputSchema: {
        type: 'object',
        properties: {
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'search_nodes',
      description: 'Ranked fuzzy search for root nodes by ID segment. Returns slim summaries (id, template, component, state, stability). Preferred discovery entry point; use list_nodes only for exhaustive filtered inventories.',
      inputSchema: {
        type: 'object',
        required: ['queries'],
        properties: {
          queries: { type: 'array', items: { type: 'string' }, description: 'Search terms (OR).' },
          templates: { type: 'array', items: { type: 'string' }, description: 'Template allowlist.' },
          exclude_templates: { type: 'array', items: { type: 'string' }, description: 'Template denylist.' },
          page_size: { type: 'number', description: 'Max results. Default 10.' },
          offset: { type: 'number', description: 'Pagination offset. Default 0.' },
          search_properties: { type: 'boolean', description: 'Also match name/description/x-aka. Default false.' },
          full_nodes: { type: 'boolean', description: 'Add every property to each result — far larger output; leave off unless you need the bodies. Default false.' },
          include_provenance: PROVENANCE_PARAM,
          branch: BRANCH_READ_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'list_branches',
      description: 'List branches available from the graph source and their load status.',
      inputSchema: {
        type: 'object',
        properties: {
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'diff_branch',
      description: 'Diff a branch against the default branch. Rename-aware: old IDs resolve through the rename trail, so a branch holding an old name overlays the renamed node rather than showing add+remove. warnings flags branches editing a retired name — rebase the branch or apply the rename.',
      inputSchema: {
        type: 'object',
        required: ['branch'],
        properties: {
          branch: { type: 'string', description: 'Branch ref to diff against the default branch.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'start_changes',
      description: 'Open a write session — required before any mutation; while open, reads reflect uncommitted state. Mutations persist only at commit_changes; discard_changes aborts. autosave defaults OFF. Git default branches are read-only: pass a writable branch or create:true to fork from default head. Errors if a session with pending changes is already open (commit or discard first).',
      inputSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Branch to load and commit to. Default: source default.' },
          create: { type: 'boolean', description: 'Fork a new branch from default head (git only). Default false.' },
          autosave: { type: 'boolean', description: 'Persist each mutation (file: write-through; git: WIP checkpoint commit). Default false.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'apply_cluster',
      description: 'Upsert a cluster-style nested document (same shape as cluster YAML: root fields + owned sections of named children). merge: patch only what is present (null property clears a key). replace: WARNING document is AUTHORITATIVE — children and owned sections absent from it are DELETED (an absent section means an empty section). A changed child key is delete+add, never a rename — use rename_node. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['document', 'mode'],
        properties: {
          document: { type: 'object', description: 'Root node plus owned sections with named children.' },
          mode: { type: 'string', enum: ['merge', 'replace'], description: 'merge: patch present fields. replace: authoritative — absent children/sections DELETED.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'create_node',
      description: 'Create a root cluster (omit parent_id; document needs id+template) or an owned child (pass parent_id+section+name; document is the child body). Nested owned children and structural edges (has-field, has-value) generate automatically. Defaults: state proposed, stability unstable. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['document'],
        properties: {
          document: { type: 'object', description: 'Root: {id, template, properties?, ...ownedSections}. Child: the body (properties flattened, optional nested sections).' },
          parent_id: { type: 'string', description: 'Owning parent ID — omit for a root cluster.' },
          section: { type: 'string', description: 'Owned section under parent (e.g. fields, schemas); required with parent_id.' },
          name: { type: 'string', description: 'Local name of the new child; required with parent_id.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'update_node',
      description: 'Patch a node\'s properties/state/stability (properties is a patch; null clears a key). Cannot rename — use rename_node. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Fully qualified node ID.' },
          properties: { type: 'object', description: 'Property patch; null clears a key.' },
          state: STATE_PARAM,
          stability: STABILITY_PARAM,
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'rename_node',
      description: 'Rename a node (replace the last ID segment). Descendant IDs, parentId, and edge endpoints rewrite automatically; a cluster root\'s file moves at commit. Records a rename trail (previousIds + renamed-from edge) when the old name is shared history on default; record_trail overrides. The ONLY rename path — apply_cluster and imports never infer renames. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['id', 'new_name'],
        properties: {
          id: { type: 'string', description: 'Node ID to rename.' },
          new_name: { type: 'string', description: 'New last segment (grammar [A-Za-z0-9_-], no dots).' },
          record_trail: { type: 'boolean', description: 'Force (true) or suppress (false) the rename trail.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'delete_node',
      description: 'Delete a node and its owned subtree. Soft delete (state removed, stays queryable) when the node is shared history on default; hard delete (removes subtree + touching edges) otherwise. purge:true forces hard; record_trail overrides (true soft, false hard). Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Node ID to delete.' },
          purge: { type: 'boolean', description: 'Force hard delete. Default false.' },
          record_trail: { type: 'boolean', description: 'true forces soft delete, false forces hard.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'create_fields',
      description: 'Batch create multiple fields across different schemas in one operation. Each field becomes a proper Field node with structural edges. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['fields'],
        properties: {
          fields: {
            type: 'array',
            description: 'Array of field definitions',
            items: {
              type: 'object',
              required: ['parent_id', 'schema_name', 'name', 'type'],
              properties: {
                parent_id: { type: 'string', description: 'Root node ID (e.g. orders.DomainModel.order).' },
                schema_name: { type: 'string', description: 'Schema name within the root (e.g. order, order-placed-payload).' },
                name: { type: 'string', description: 'Field name.' },
                type: { type: 'string', description: 'Field type (e.g. uuid, decimal, string).' },
                nullable: { type: 'boolean', description: 'Whether field is nullable. Default false.' },
                description: { type: 'string', description: 'Optional field description.' },
              },
            },
          },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'create_edges',
      description: 'Batch create multiple edges in one operation. Same validation as create_edge. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['edges'],
        properties: {
          edges: {
            type: 'array',
            description: 'Array of edge definitions',
            items: {
              type: 'object',
              required: ['from', 'to', 'type'],
              properties: {
                from: { type: 'string', description: 'Source node ID.' },
                to: { type: 'string', description: 'Target node ID.' },
                type: { type: 'string', description: 'Edge type.' },
                state: STATE_PARAM,
                stability: STABILITY_PARAM,
                notes: { type: 'string', description: 'Free-text note.' },
                properties: { type: 'object', description: 'Edge properties.' },
              },
            },
          },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'update_edge',
      description: 'Patch an edge\'s state/stability/notes/properties (null clears notes or a property key). Endpoints and type are immutable — delete+create to change them. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Edge ID ({from}__{type}__{to}).' },
          state: STATE_PARAM,
          stability: STABILITY_PARAM,
          notes: { description: 'New notes; null clears them.' },
          properties: { type: 'object', description: 'Property patch; null clears a key.' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'delete_edge',
      description: 'Hard-delete an edge (edges carry no subtree). To soft-remove, use update_edge with state removed. Needs an open session.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Edge ID ({from}__{type}__{to}).' },
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'pending_changes',
      description: 'Show the session\'s change journal and a summary diff (added/modified/removed counts) vs base. Needs an open session.',
      inputSchema: {
        type: 'object',
        properties: {
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'discard_changes',
      description: 'Abort the session without committing, dropping in-memory changes. Autosaved file-source writes are NOT rolled back. Needs an open session.',
      inputSchema: {
        type: 'object',
        properties: {
          ...IO_PARAMS,
        },
      },
    },
    {
      name: 'commit_changes',
      description: 'Lint, serialise, and commit the working graph, then close the session. Error diagnostics BLOCK the commit (session stays open to fix); warnings ride along. Git autosave WIP checkpoints squash into one commit unless an external commit interleaved. Fails if the branch head moved externally. Needs an open session.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message. Default: journal summary.' },
          ...IO_PARAMS,
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
        { role: 'user' as const, content: { type: 'text' as const, text: buildUsageGuidePrompt([...graph.templates.keys()].sort()) } },
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
      case 'create_fields':
        return await handlers.create_fields(args)
      case 'create_edges':
        return await handlers.create_edges(args)
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
