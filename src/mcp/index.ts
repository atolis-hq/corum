import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'
import { getCluster, getLinkedFields, listNodes, type ListNodesFilter } from '../graph/index.js'
import { loadGraph, loadMultiGraph } from '../loader/index.js'
import type { BranchGraph, Graph } from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import type { GraphSource } from '../source/index.js'
import { startGraphFileWatcher, startWebServer } from '../web/server.js'
import { compactKeys, getSerializer } from './serializers.js'

type ToolContent = { type: 'text'; text: string }

type ToolResult = {
  content: ToolContent[]
  isError?: boolean
}

type MaybePromise<T> = T | Promise<T>
type ToolHandler = (args: Record<string, unknown>) => MaybePromise<ToolResult>

export function createMcpHandlers(graph: Graph, source?: GraphSource): {
  list_nodes: ToolHandler
  list_templates: ToolHandler
  get_template: ToolHandler
  get_cluster: ToolHandler
  get_linked_fields: ToolHandler
  list_branches: ToolHandler
  diff_branch: ToolHandler
} {
  return {
    list_nodes(args) {
      const run = (targetGraph: Graph): ToolResult => {
        const filter: ListNodesFilter = {
          template: typeof args.template === 'string' ? args.template : undefined,
          component: typeof args.component === 'string' ? args.component : undefined,
          state: typeof args.state === 'string' ? args.state as ListNodesFilter['state'] : undefined,
          stability: typeof args.stability === 'string' ? args.stability as ListNodesFilter['stability'] : undefined,
        }
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

    list_templates(args) {
      try {
        const summaries = [...graph.templates.values()]
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
      const run = (targetGraph: Graph): ToolResult =>
        formatResult(getCluster(targetGraph, String(args.node_id)), args.format, getCompactKeys(args))

      if (hasBranch(args)) {
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
        const multi = await loadMultiGraph({ source })
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
        const multi = await loadMultiGraph({ source })
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
  fn: (branch: BranchGraph) => ToolResult,
): Promise<ToolResult> {
  try {
    if (!source) throw new QueryError('GraphSource is required when branch is provided')
    const multi = await loadMultiGraph({ source })
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

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isEntrypoint()) {
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
  const noWeb = process.argv.includes('--no-web')
  const watchFiles = process.argv.includes('--watch')
  if (!noWeb) {
    await startWebServer(graph, {
      graphPath: config.graphPath,
      fileWatcher: config.fileWatcherGraphPath && watchFiles ? true : undefined,
      source: config.source,
    })
  } else if (watchFiles && config.fileWatcherGraphPath) {
    startGraphFileWatcher(graph, { graphPath: config.fileWatcherGraphPath })
  }

  const server = new Server(
    { name: 'corum', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_nodes',
        description: 'List nodes in the graph. Returns id, template, component, state, stability for each matched node.',
        inputSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', description: 'Filter by template name' },
            component: { type: 'string', description: 'Filter by component name' },
            state: { type: 'string', description: 'Filter by lifecycle state' },
            stability: { type: 'string', description: 'Filter by stability' },
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
            branch: { type: 'string', description: 'Branch ref to load the cluster from' },
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
      case 'get_linked_fields':
        return await handlers.get_linked_fields(args)
      case 'list_branches':
        return await handlers.list_branches(args)
      case 'diff_branch':
        return await handlers.diff_branch(args)
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true }
    }
  })

  await server.connect(new StdioServerTransport())
}
