import express from 'express'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AddressInfo } from 'node:net'
import { getClusterView, listNodes, type ListNodesFilter } from '../graph/index.js'
import { loadGraph } from '../loader/index.js'
import { VALID_EDGE_TYPE_SET } from '../loader/constants.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import type { EdgeType, Graph, Node, Template } from '../schema/index.js'
import { QueryError } from '../schema/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WEB_DIR = path.join(__dirname, '..', '..', '..', 'web')

export type WebServerOptions = {
  port?: number
  graphPath?: string
  logger?: (message: string) => void
}

export type WebServerHandle = {
  port: number
  close(): Promise<void>
}

async function getPluginFiles(): Promise<string[]> {
  try {
    const files = await readdir(path.join(WEB_DIR, 'plugins'))
    return files.filter(file => file.endsWith('.jsx'))
  } catch {
    return []
  }
}

function getNavigationOwnership(graph: Graph, node: Node): { parentId: string; ownedSection: string } | undefined {
  let match: { parentId: string; ownedSection: string } | undefined

  for (const parent of graph.nodesById.values()) {
    if (parent.id === node.id) continue
    const parentTemplate = graph.templates.get(parent.template)
    if (!parentTemplate) continue

    for (const [section, childTemplate] of Object.entries(getOwnedSections(parentTemplate))) {
      if (childTemplate !== node.template) continue
      if (!node.id.startsWith(`${parent.id}.${section}.`)) continue
      if (!match || parent.id.length > match.parentId.length) {
        match = { parentId: parent.id, ownedSection: section }
      }
    }
  }

  return match
}

function summarizeNodeForNavigation(graph: Graph, node: Node): Node & { parentId?: string; ownedSection?: string } {
  const ownership = getNavigationOwnership(graph, node)
  return {
    ...node,
    ...(ownership ?? {}),
  }
}

type NodeRefValue = { display: string; nodeId: string } | { display: string }

function resolveNodeRef(graph: Graph, node: Node, rawValue: string): NodeRefValue {
  if (rawValue.startsWith('#/schemas/')) {
    const name = rawValue.slice(10)
    const id = `${node.id}.schemas.${name}`
    return graph.nodesById.has(id) ? { display: name, nodeId: id } : { display: name }
  }
  if (rawValue.startsWith('#/enums/')) {
    const name = rawValue.slice(8)
    const id = `${node.id}.enums.${name}`
    return graph.nodesById.has(id) ? { display: name, nodeId: id } : { display: name }
  }
  if (graph.nodesById.has(rawValue)) return { display: rawValue, nodeId: rawValue }
  return { display: rawValue }
}

function getPropertySchemas(templateProperties: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (Array.isArray(templateProperties.allOf)) {
    const merged: Record<string, Record<string, unknown>> = {}
    for (const schema of templateProperties.allOf) {
      Object.assign(merged, getPropertySchemas(schema as Record<string, unknown>))
    }
    return merged
  }
  if (typeof templateProperties.properties === 'object' && templateProperties.properties !== null) {
    return templateProperties.properties as Record<string, Record<string, unknown>>
  }
  return {}
}

function annotateNodeRefProperties(graph: Graph, node: Node, template: Template): Record<string, unknown> {
  if (!template.properties) return node.properties
  const propSchemas = getPropertySchemas(template.properties as Record<string, unknown>)
  const result: Record<string, unknown> = { ...node.properties }

  for (const [key, schema] of Object.entries(propSchemas)) {
    const value = result[key]
    if (value === undefined) continue

    if (schema.format === 'node-ref' && typeof value === 'string') {
      result[key] = resolveNodeRef(graph, node, value)
    } else if (
      schema.type === 'object' &&
      typeof schema.additionalProperties === 'object' &&
      schema.additionalProperties !== null &&
      (schema.additionalProperties as Record<string, unknown>).format === 'node-ref' &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) =>
          typeof v === 'string' ? [k, resolveNodeRef(graph, node, v)] : [k, v],
        ),
      )
    }
  }
  return result
}

function parseIncludeEdges(value: unknown): EdgeType[] {
  if (typeof value !== 'string' || value.trim() === '') return []
  const types = value
    .split(',')
    .map(item => item.trim())
    .filter((item): item is EdgeType => VALID_EDGE_TYPE_SET.has(item))
  return [...new Set(types)]
}

export function createApp(graph: Graph): express.Application {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/templates', (req, res) => {
    const includeCore = req.query.includeCore === 'true'
    const templates = [...graph.templates.values()]
      .filter(template => includeCore || !template.info?.core)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(template => ({
        name: template.name,
        version: template.info?.version,
        core: template.info?.core ?? false,
        abstract: template.info?.abstract ?? false,
        extends: template.extends,
        description: template.info?.description,
        ui: template.ui,
      }))
    res.json(templates)
  })

  app.get('/api/nodes', (req, res) => {
    const { template, component, state, stability } = req.query
    const includeCore = req.query.includeCore === 'true'
    const filter: ListNodesFilter = {
      template: typeof template === 'string' ? template : undefined,
      component: typeof component === 'string' ? component : undefined,
      state: typeof state === 'string' ? state as ListNodesFilter['state'] : undefined,
      stability: typeof stability === 'string' ? stability as ListNodesFilter['stability'] : undefined,
    }
    const nodes = listNodes(graph, filter)
      .filter(node => includeCore || !graph.templates.get(node.template)?.info?.core)
      .map(node => {
        const ownership = summarizeNodeForNavigation(graph, node)
        return {
          id: ownership.id,
          template: ownership.template,
          component: ownership.component,
          state: ownership.state,
          stability: ownership.stability,
          parentId: ownership.parentId,
          ownedSection: ownership.ownedSection,
        }
      })
    res.json(nodes)
  })

  app.get('/api/cluster', (req, res) => {
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId query param required' })
      return
    }

    try {
      const cluster = getClusterView(graph, nodeId, parseIncludeEdges(req.query.includeEdges))
      const rootTemplate = graph.templates.get(cluster.root.template)
      const annotatedRoot = rootTemplate
        ? { ...cluster.root, properties: annotateNodeRefProperties(graph, cluster.root, rootTemplate) }
        : cluster.root
      res.json({
        root: summarizeNodeForNavigation(graph, annotatedRoot),
        descendants: cluster.descendants.map(child => summarizeNodeForNavigation(graph, child)),
        includedNodes: cluster.includedNodes.map(node => summarizeNodeForNavigation(graph, node)),
        edges: cluster.edges,
      })
    } catch (err) {
      const message = err instanceof QueryError ? err.message : String(err)
      res.status(404).json({ error: message })
    }
  })

  app.get('/api/plugins', async (_req, res) => {
    const files = await getPluginFiles()
    res.json(files)
  })

  app.use(express.static(WEB_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.jsx')) {
        res.setHeader('Content-Type', 'text/babel; charset=utf-8')
      }
    },
  }))

  return app
}

export function startWebServer(graph: Graph, options: WebServerOptions = {}): Promise<WebServerHandle> {
  const portSource = options.port !== undefined
    ? 'options.port'
    : process.env.CORUM_WEB_PORT !== undefined
      ? 'CORUM_WEB_PORT'
      : 'default'
  const graphPathSource = options.graphPath !== undefined
    ? 'options.graphPath'
    : process.env.CORUM_GRAPH_PATH !== undefined
      ? 'CORUM_GRAPH_PATH'
      : 'default'
  const port = options.port ?? parseInt(process.env.CORUM_WEB_PORT ?? '3000', 10)
  const graphPath = options.graphPath ?? process.env.CORUM_GRAPH_PATH ?? path.join(process.cwd(), '.corum/graph')
  const logger = options.logger ?? console.error
  const app = createApp(graph)
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const addr = server.address() as AddressInfo
      if (options.port !== 0) {
        logger(`[corum web] config graphPath=${graphPath} (${graphPathSource})`)
        logger(`[corum web] config port=${addr.port} (${portSource})`)
        logger(`[corum web] config webDir=${WEB_DIR}`)
        logger(`[corum web] http://localhost:${addr.port}`)
      }
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
      })
    })
    server.on('error', reject)
  })
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isEntrypoint()) {
  const graphPath = process.env.CORUM_GRAPH_PATH ?? path.join(process.cwd(), '.corum/graph')
  const graph = await loadGraph({ graphPath, strict: true })
  await startWebServer(graph, { graphPath })
}
