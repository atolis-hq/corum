import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'
import { getCluster, getLinkedFields, listNodes, type ListNodesFilter } from '../graph/index.js'
import { loadGraph } from '../loader/index.js'
import type { Graph } from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import { startGraphFileWatcher, startWebServer } from '../web/server.js'
import { compactKeys, getSerializer } from './serializers.js'

type ToolContent = { type: 'text'; text: string }

type ToolResult = {
  content: ToolContent[]
  isError?: boolean
}

export function createMcpHandlers(graph: Graph): {
  list_nodes: (args: Record<string, unknown>) => ToolResult
  list_templates: (args: Record<string, unknown>) => ToolResult
  get_template: (args: Record<string, unknown>) => ToolResult
  get_cluster: (args: Record<string, unknown>) => ToolResult
  get_linked_fields: (args: Record<string, unknown>) => ToolResult
} {
  return {
    list_nodes(args) {
      try {
        const filter: ListNodesFilter = {
          template: typeof args.template === 'string' ? args.template : undefined,
          component: typeof args.component === 'string' ? args.component : undefined,
          state: typeof args.state === 'string' ? args.state as ListNodesFilter['state'] : undefined,
          stability: typeof args.stability === 'string' ? args.stability as ListNodesFilter['stability'] : undefined,
        }
        const summaries = listNodes(graph, filter).map(node => ({
          id: node.id,
          template: node.template,
          component: node.component,
          state: node.state,
          stability: node.stability,
        }))
        return formatResult(summaries, args.format, getCompactKeys(args))
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
      try {
        return formatResult(getCluster(graph, String(args.node_id)), args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    },

    get_linked_fields(args) {
      try {
        return formatResult(getLinkedFields(graph, String(args.node_id)), args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    },
  }
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

  const handlers = createMcpHandlers(graph)
  const noWeb = process.argv.includes('--no-web')
  const watchFiles = process.argv.includes('--watch')
  if (!noWeb) {
    await startWebServer(graph, {
      graphPath: config.graphPath,
      fileWatcher: config.fileWatcherGraphPath && watchFiles ? true : undefined,
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
        return handlers.list_nodes(args)
      case 'list_templates':
        return handlers.list_templates(args)
      case 'get_template':
        return handlers.get_template(args)
      case 'get_cluster':
        return handlers.get_cluster(args)
      case 'get_linked_fields':
        return handlers.get_linked_fields(args)
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true }
    }
  })

  await server.connect(new StdioServerTransport())
}
