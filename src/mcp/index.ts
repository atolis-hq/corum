import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import path from 'node:path'
import { getCluster, getLinkedFields, listNodes, type ListNodesFilter } from '../graph/index.js'
import { loadGraph } from '../loader/index.js'
import type { Graph } from '../schema/index.js'
import { QueryError } from '../schema/index.js'

type ToolContent = { type: 'text'; text: string }

type ToolResult = {
  content: ToolContent[]
  isError?: boolean
}

export function createMcpHandlers(graph: Graph): {
  list_nodes: (args: Record<string, unknown>) => ToolResult
  get_cluster: (args: Record<string, unknown>) => ToolResult
  get_linked_fields: (args: Record<string, unknown>) => ToolResult
} {
  return {
    list_nodes(args) {
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
      return jsonResult(summaries)
    },

    get_cluster(args) {
      try {
        return jsonResult(getCluster(graph, String(args.node_id)))
      } catch (err) {
        return errorResult(err)
      }
    },

    get_linked_fields(args) {
      try {
        return jsonResult(getLinkedFields(graph, String(args.node_id)))
      } catch (err) {
        return errorResult(err)
      }
    },
  }
}

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(err: unknown): ToolResult {
  const message = err instanceof QueryError ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
}

if (isEntrypoint()) {
  const graphPath = process.env.CORUM_GRAPH_PATH ?? path.join(process.cwd(), '.corum/graph')

  let graph: Graph
  let loadError: string | undefined

  try {
    graph = await loadGraph({ graphPath, strict: true })
  } catch (err) {
    loadError = String(err)
    graph = await loadGraph({ graphPath, strict: false }).catch(() => ({
      nodesById: new Map(),
      edgesByFrom: new Map(),
      edgesByTo: new Map(),
      templates: new Map(),
      diagnostics: [],
    }))
  }

  const handlers = createMcpHandlers(graph)
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
