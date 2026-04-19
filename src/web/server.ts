import express from 'express'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AddressInfo } from 'node:net'
import { getCluster, listNodes, type ListNodesFilter } from '../graph/index.js'
import { loadGraph } from '../loader/index.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import type { Graph } from '../schema/index.js'
import type { Node } from '../schema/index.js'
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

export function createApp(graph: Graph): express.Application {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/templates', (req, res) => {
    const includeCore = req.query.includeCore === 'true'
    const templates = [...graph.templates.values()]
      .filter(template => includeCore || !template.core)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(template => ({
        name: template.name,
        version: template.version,
        core: template.core ?? false,
        abstract: template.abstract ?? false,
        extends: template.extends,
        description: template.description,
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
      .filter(node => includeCore || !graph.templates.get(node.template)?.core)
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
      const cluster = getCluster(graph, nodeId)
      res.json({
        root: summarizeNodeForNavigation(graph, cluster.root),
        children: cluster.children.map(child => summarizeNodeForNavigation(graph, child)),
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
