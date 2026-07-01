import { printBanner } from '../banner.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'
import {
  computeClusterOverlay,
  getCluster,
  getClusterView,
  getGraphSummary,
  getLineage,
  getLinkedFields,
  listNodes,
  SEMANTIC_EDGE_TYPES,
  searchNodes,
  STRUCTURAL_NODE_TEMPLATES,
  type GetLineageOptions,
  type LineageDirection,
  type ListNodesFilter,
  type SearchNodesOptions,
} from '../graph/index.js'
import { loadGraph, loadMultiGraph } from '../loader/index.js'
import type { BranchGraph, EdgeType, Graph } from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import type { GraphSource } from '../source/index.js'
import { startGraphFileWatcher, startWebServer, type MultiGraphCache } from '../web/server.js'
import { USAGE_GUIDE_PROMPT } from './prompts/usage-guide.js'
import { compactKeys, getSerializer } from './serializers.js'

type ToolContent = { type: 'text'; text: string }

type ToolResult = {
  content: ToolContent[]
  isError?: boolean
}

type MaybePromise<T> = T | Promise<T>
type ToolHandler = (args: Record<string, unknown>) => MaybePromise<ToolResult>

const EDGE_TYPES = [
  'triggers',
  'produces',
  'reads',
  'calls',
  'implements',
  'maps-to',
  'derived-from',
  'renamed-from',
  'has-field',
  'has-value',
] as const satisfies readonly EdgeType[]

const EDGE_TYPE_SET = new Set<EdgeType>(EDGE_TYPES)
const STATE_VALUES = ['draft', 'proposed', 'agreed', 'future', 'removed', 'implemented'] as const
const STABILITY_VALUES = ['unstable', 'stable', 'deprecated'] as const
const LINEAGE_DIRECTIONS = ['downstream', 'upstream', 'both'] as const satisfies readonly LineageDirection[]
const OUTPUT_FORMATS = ['yaml', 'json', 'toon'] as const

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function parseEdgeTypes(value: unknown): EdgeType[] | undefined {
  const requested = toStringArray(value)
  if (!requested) return undefined
  const invalid = requested.filter(type => !EDGE_TYPE_SET.has(type as EdgeType))
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
} {
  const resolveMulti = (src: GraphSource) => cache ? cache.get() : loadMultiGraph({ source: src })

  return {
    list_nodes(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const filter = parseListNodesFilter(args.filter)
        const summaries = listNodes(targetGraph, filter).map(node => ({
          id: node.id,
          template: node.template,
          component: node.component,
          state: node.state,
          stability: node.stability,
        }))
        return formatResult(summaries, args.format, getCompactKeys(args))
      }

      if (hasBranch(args)) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
      } catch (err) {
        return errorResult(err)
      }
    },

    get_graph_summary(args) {
      const run = (targetGraph: Graph): ToolResult =>
        formatResult(getGraphSummary(targetGraph), args.format, getCompactKeys(args))

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
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
        return formatResult(searchNodes(targetGraph, queries, options), args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
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
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
      } catch (err) {
        return errorResult(err)
      }
    },

    get_template(args) {
      try {
        const name = String(args.name)
        const template = graph.templates.get(name)
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
        const edgeTypes = parseEdgeTypes(args.edge_types)
          ?? [...SEMANTIC_EDGE_TYPES]

        const cluster = getClusterView(targetGraph, String(args.node_id), edgeTypes)
        if (overlayRefs.length === 0 || !source || !branchRef) {
          return formatResult(cluster, args.format, getCompactKeys(args))
        }
        const multi = await resolveMulti(source)
        const overlay = computeClusterOverlay(multi, branchRef, overlayRefs, String(args.node_id))
        return formatResult({ ...cluster, overlay }, args.format, getCompactKeys(args))
      }

      const branchRef = hasBranch(args) ? String(args.branch) : undefined

      if (branchRef) {
        return withBranchGraph(source, branchRef, branch => run(branch.graph, branchRef), cache)
      }

      return run(graph).catch(err => errorResult(err))
    },

    get_graph(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const filter = parseListNodesFilter(args.filter)
        const effectiveFilter: ListNodesFilter = (!filter.templates?.length && !filter.excludeTemplates?.length)
          ? { ...filter, excludeTemplates: [...STRUCTURAL_NODE_TEMPLATES] }
          : filter

        const nodes = listNodes(targetGraph, effectiveFilter)
          .map(node => ({
            id: node.id,
            template: node.template,
            component: node.component,
            state: node.state,
            stability: node.stability,
          }))

        const nodeIds = new Set(nodes.map(node => node.id))
        const edges: Array<{ id: string; from: string; to: string; type: string }> = []
        for (const edgeList of targetGraph.edgesByFrom.values()) {
          for (const edge of edgeList) {
            if (!SEMANTIC_EDGE_TYPES.has(edge.type) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
            edges.push({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })
          }
        }

        return formatResult({ nodes, edges }, args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
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

        return formatResult({
          template_names: [...targetGraph.templates.keys()].sort(),
          node_templates_in_use: [...nodeTemplatesInUse].sort(),
          edge_types_in_use: [...edgeTypesInUse].sort(),
          valid_edge_types: [...EDGE_TYPES],
          states: [...STATE_VALUES],
          stabilities: [...STABILITY_VALUES],
          lineage_directions: [...LINEAGE_DIRECTIONS],
          output_formats: [...OUTPUT_FORMATS],
        }, args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
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
          edgeTypes: parseEdgeTypes(args.edge_types),
          nodeTypes: toStringArray(args.node_types),
          excludeNodeTypes: toStringArray(args.exclude_node_types),
          includeDanglingEdges: args.include_dangling_edges === true,
          readsOutboundOnly: args.reads_outbound_only !== false,
        }
        return formatResult(getLineage(targetGraph, nodeIds, options), args.format, getCompactKeys(args))
      }

      if (hasBranch(args) && source) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
      } catch (err) {
        return errorResult(err)
      }
    },

    get_linked_fields(args) {
      const run = (targetGraph: Graph): ToolResult =>
        formatResult(getLinkedFields(targetGraph, String(args.node_id)), args.format, getCompactKeys(args))

      if (hasBranch(args)) {
        return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
      }

      try {
        return run(graph)
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
  }
}

async function withBranchGraph(
  source: GraphSource | undefined,
  branchRef: string,
  fn: (branch: BranchGraph) => MaybePromise<ToolResult>,
  cache?: MultiGraphCache,
): Promise<ToolResult> {
  try {
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

function formatResult(value: unknown, format: unknown, compact: unknown = false): ToolResult {
  const payload = compact === true ? compactKeys(value) : value
  return { content: [{ type: 'text', text: getSerializer(format).serialize(payload) }] }
}

function getCompactKeys(args: Record<string, unknown>): boolean {
  return args.compact_keys === true || args.compactKeys === true
}

function errorResult(err: unknown): ToolResult {
  const message = err instanceof QueryError ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
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

  const handlers = createMcpHandlers(graph, config.source)

  if (!noWeb) {
    await startWebServer(graph, {
      graphPath: config.graphPath,
      fileWatcher: config.fileWatcherGraphPath && watch ? true : undefined,
      source: config.source,
    })
  } else if (watch && config.fileWatcherGraphPath) {
    startGraphFileWatcher(graph, { graphPath: config.fileWatcherGraphPath })
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
    tools: [
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
        description: 'Get the full cluster for a root node.',
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
            include_dangling_edges: { type: 'boolean', description: 'Include edges to nodes outside the cluster. Default false.' },
            reads_outbound_only: { type: 'boolean', description: 'Restrict reads edges to outbound only. Default true.' },
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
        description: 'Return all semantic nodes and edges. Excludes structural templates and structural edge types by default.',
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
            branch: { type: 'string', description: 'Branch ref to load the graph from' },
            format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
            compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
          },
        },
      },
      {
        name: 'get_graph_metadata',
        description: 'Return discoverable graph metadata: template names, node templates in use, edge types, and valid enum values.',
        inputSchema: {
          type: 'object',
          properties: {
            branch: { type: 'string', description: 'Branch ref to load metadata from' },
            format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
            compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
          },
        },
      },
      {
        name: 'get_lineage',
        description: 'Traverse the graph from one or more origin nodes via BFS and return annotated lineage results.',
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
            include_dangling_edges: { type: 'boolean', description: 'Include edges to nodes outside the result set. Default false.' },
            reads_outbound_only: { type: 'boolean', description: 'Do not follow inbound reads edges in upstream traversal. Default true.' },
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
        description: 'Fuzzy search for root-level nodes by ID segments. Returns ranked results with score.',
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
        description: 'Diff a branch against the default branch.',
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
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
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
