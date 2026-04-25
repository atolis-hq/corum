import express from 'express'
import path from 'node:path'
import { existsSync, readFileSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Response } from 'express'
import { parse as parseYaml } from 'yaml'
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
  fileWatcher?: boolean
  fileWatcherDebounceMs?: number
  logger?: (message: string) => void
}

export type WebServerHandle = {
  port: number
  close(): Promise<void>
}

export type GraphFileWatcherOptions = {
  graphPath: string
  debounceMs?: number
  logger?: (message: string) => void
  onReload?: () => void
}

type ReloadEvents = {
  subscribe(res: Response): void
  notify(): void
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

function annotateNode(graph: Graph, node: Node): Node {
  const template = graph.templates.get(node.template)
  return template ? { ...node, properties: annotateNodeRefProperties(graph, node, template) } : node
}

function parseIncludeEdges(value: unknown): EdgeType[] {
  if (typeof value !== 'string' || value.trim() === '') return []
  const types = value
    .split(',')
    .map(item => item.trim())
    .filter((item): item is EdgeType => VALID_EDGE_TYPE_SET.has(item))
  return [...new Set(types)]
}

function createReloadEvents(): ReloadEvents {
  const clients = new Set<Response>()
  let version = 0
  return {
    subscribe(res) {
      clients.add(res)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(`event: connected\ndata: ${JSON.stringify({ version })}\n\n`)
      res.on('close', () => clients.delete(res))
    },
    notify() {
      version += 1
      const payload = `event: graph-reloaded\ndata: ${JSON.stringify({ version })}\n\n`
      for (const client of clients) {
        client.write(payload)
      }
    },
  }
}

function replaceGraph(target: Graph, source: Graph): void {
  target.nodesById = source.nodesById
  target.edgesByFrom = source.edgesByFrom
  target.edgesByTo = source.edgesByTo
  target.templates = source.templates
  target.diagnostics = source.diagnostics
}

function isFileWatcherEnabled(options: WebServerOptions): boolean {
  if (options.fileWatcher !== undefined) return options.fileWatcher
  const value = process.env.CORUM_FILE_WATCHER ?? process.env.CORUM_WATCH
  return value === '1' || value === 'true' || value === 'yes'
}

function resolvePackDirs(graphPath: string): string[] {
  const graphYamlPath = path.join(graphPath, 'graph.yaml')
  if (!existsSync(graphYamlPath)) {
    return [path.resolve(graphPath, '.corum/packs')]
  }

  try {
    const doc = parseYaml(readFileSync(graphYamlPath, 'utf-8')) as Record<string, unknown>
    const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
    return packs
      .filter((pack): pack is { path: string } =>
        typeof pack === 'object' && pack !== null && typeof (pack as Record<string, unknown>).path === 'string',
      )
      .map(pack => path.resolve(graphPath, pack.path))
  } catch {
    return []
  }
}

function listDirectories(root: string): string[] {
  if (!existsSync(root)) return []
  const dirs = [root]
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      dirs.push(...listDirectories(path.join(root, entry.name)))
    }
  }
  return dirs
}

function watchRoot(root: string, onChange: (filename?: string | Buffer | null) => void): FSWatcher[] {
  if (!existsSync(root)) return []
  try {
    return [watch(root, { recursive: true }, (_eventType, filename) => onChange(filename))]
  } catch {
    return listDirectories(root).map(dir => watch(dir, (_eventType, filename) => onChange(filename)))
  }
}

function isRelevantWatchEvent(filename: string | Buffer | null | undefined): boolean {
  if (!filename) return true
  const name = String(filename).replace(/\\/g, '/')
  return name.endsWith('.yaml') || name.endsWith('.yml')
}

export function startGraphFileWatcher(
  graph: Graph,
  options: GraphFileWatcherOptions,
): () => void {
  const { graphPath, onReload } = options
  const logger = options.logger ?? console.error
  const debounceMs = options.debounceMs ?? 150
  let watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | undefined
  let reloading = false

  function closeWatchers(): void {
    for (const watcher of watchers) watcher.close()
    watchers = []
  }

  function refreshWatchers(): void {
    closeWatchers()
    const roots = [...new Set([path.resolve(graphPath), ...resolvePackDirs(graphPath)])]
    watchers = roots.flatMap(root => watchRoot(root, scheduleReload))
  }

  async function reload(): Promise<void> {
    if (reloading) return
    reloading = true
    try {
      const nextGraph = await loadGraph({ graphPath, strict: true })
      replaceGraph(graph, nextGraph)
      refreshWatchers()
      onReload?.()
      logger(`[corum] graph reloaded after file change`)
    } catch (err) {
      logger(`[corum] graph reload failed: ${err}`)
    } finally {
      reloading = false
    }
  }

  function scheduleReload(filename?: string | Buffer | null): void {
    if (!isRelevantWatchEvent(filename)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void reload()
    }, debounceMs)
  }

  refreshWatchers()
  logger(`[corum] file watcher enabled`)

  return () => {
    if (timer) clearTimeout(timer)
    closeWatchers()
  }
}

export function createApp(graph: Graph, reloadEvents: ReloadEvents = createReloadEvents()): express.Application {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/events', (_req, res) => {
    reloadEvents.subscribe(res)
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
      res.json({
        root: summarizeNodeForNavigation(graph, annotateNode(graph, cluster.root)),
        descendants: cluster.descendants.map(child => summarizeNodeForNavigation(graph, annotateNode(graph, child))),
        includedNodes: cluster.includedNodes.map(node => summarizeNodeForNavigation(graph, annotateNode(graph, node))),
        edges: cluster.edges,
      })
    } catch (err) {
      if (err instanceof QueryError) {
        res.status(404).json({ error: err.message })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  })

  app.get('/api/plugins', (_req, res) => {
    getPluginFiles()
      .then(files => res.json(files))
      .catch(() => res.json([]))
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
  const reloadEvents = createReloadEvents()
  const app = createApp(graph, reloadEvents)
  const stopWatcher = isFileWatcherEnabled(options)
    ? startGraphFileWatcher(graph, {
      graphPath,
      debounceMs: options.fileWatcherDebounceMs,
      logger,
      onReload: () => reloadEvents.notify(),
    })
    : undefined
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const addr = server.address() as AddressInfo
      if (options.port !== 0) {
        // graphPath is informational only — the graph object was already loaded by the caller
        logger(`[corum web] config graphPath=${graphPath} (${graphPathSource})`)
        logger(`[corum web] config port=${addr.port} (${portSource})`)
        logger(`[corum web] config webDir=${WEB_DIR}`)
        logger(`[corum web] http://localhost:${addr.port}`)
      }
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res, rej) => {
          stopWatcher?.()
          server.close(err => (err ? rej(err) : res()))
        }),
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
  await startWebServer(graph, { graphPath, fileWatcher: process.argv.includes('--watch') ? true : undefined })
}
