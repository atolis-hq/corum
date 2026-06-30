import { printBanner } from '../banner.js'
import express from 'express'
import path from 'node:path'
import { existsSync, readFileSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Response } from 'express'
import { parse as parseYaml } from 'yaml'
import { computeClusterOverlay, getClusterView, listNodes, type ListNodesFilter } from '../graph/index.js'
import { loadGraph, loadMultiGraph } from '../loader/index.js'
import { VALID_EDGE_TYPE_SET } from '../loader/constants.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import type { EdgeType, Graph, MultiGraph, Node, Template } from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import type { GraphSource } from '../source/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WEB_DIR = path.join(__dirname, '..', '..', '..', 'web')

export type WebServerOptions = {
  port?: number
  graphPath?: string
  source?: GraphSource
  fileWatcher?: boolean
  fileWatcherDebounceMs?: number
  gitPollSeconds?: number
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

export type MultiGraphCache = {
  get(): Promise<MultiGraph>
  invalidate(): void
}

type PollableGraphSource = GraphSource & {
  reloadSignature(): Promise<string>
}

function createMultiGraphCache(source: GraphSource): MultiGraphCache {
  let cache: MultiGraph | null = null
  return {
    async get(): Promise<MultiGraph> {
      if (!cache) cache = await loadMultiGraph({ source })
      return cache
    },
    invalidate() {
      cache = null
    },
  }
}

async function getGraphForRef(ref: string, cache: MultiGraphCache, fallback: Graph): Promise<Graph> {
  const multi = await cache.get()
  const branch = multi.branches.find(item => item.ref === ref)
  return branch?.graph ?? fallback
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
  // Walk up the node's own ID hierarchy in 2-segment strides (section + name),
  // returning the deepest valid parent. This is O(depth) per node instead of O(N).
  const parts = node.id.split('.')
  let endIdx = parts.length - 2
  while (endIdx >= 1) {
    const candidateId = parts.slice(0, endIdx).join('.')
    const section = parts[endIdx]
    const candidate = graph.nodesById.get(candidateId)
    if (candidate) {
      const tmpl = graph.templates.get(candidate.template)
      if (tmpl) {
        const ownedSections = getOwnedSections(tmpl)
        if (section in ownedSections && ownedSections[section] === node.template) {
          return { parentId: candidateId, ownedSection: section }
        }
      }
    }
    endIdx -= 2
  }
  return undefined
}

function summarizeNodeForNavigation(graph: Graph, node: Node): Node & { parentId?: string; ownedSection?: string } {
  const ownership = getNavigationOwnership(graph, node)
  return {
    ...node,
    ...(ownership ?? {}),
  }
}

type NodeRefValue = { display: string; nodeId: string } | { display: string }

function resolveLocalRef(graph: Graph, nodeId: string, section: string, name: string): string | undefined {
  // Walk up the node ID hierarchy to find the nearest ancestor owning section.name.
  // This handles refs on both root nodes and nested Field nodes correctly.
  let ancestor = nodeId.replace(/\.fields\.[^.]+$/, '')
  while (ancestor.length > 0) {
    const candidate = `${ancestor}.${section}.${name}`
    if (graph.nodesById.has(candidate)) return candidate
    const dot = ancestor.lastIndexOf('.')
    if (dot === -1) break
    ancestor = ancestor.slice(0, dot)
  }
  return undefined
}

function resolveNodeRef(graph: Graph, node: Node, rawValue: string): NodeRefValue {
  if (rawValue.startsWith('#/schemas/')) {
    const name = rawValue.slice(10)
    const id = resolveLocalRef(graph, node.id, 'schemas', name)
    return id ? { display: name, nodeId: id } : { display: name }
  }
  if (rawValue.startsWith('#/enums/')) {
    const name = rawValue.slice(8)
    const id = resolveLocalRef(graph, node.id, 'enums', name)
    return id ? { display: name, nodeId: id } : { display: name }
  }
  if (rawValue.startsWith('#/mappings/')) {
    const name = rawValue.slice(11)
    const id = resolveLocalRef(graph, node.id, 'mappings', name)
    return id ? { display: name, nodeId: id } : { display: name }
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

export function createApp(
  graph: Graph,
  reloadEvents: ReloadEvents = createReloadEvents(),
  source?: GraphSource,
  multiCache?: MultiGraphCache,
  onReloadRequest?: () => Promise<void>,
): express.Application {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/events', (_req, res) => {
    reloadEvents.subscribe(res)
  })

  app.get('/api/templates', async (req, res) => {
    const includeCore = req.query.includeCore === 'true'

    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const templates = [...targetGraph.templates.values()]
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

  app.get('/api/nodes', async (req, res) => {
    const { template, component, state, stability } = req.query
    const includeCore = req.query.includeCore === 'true'
    const filter: ListNodesFilter = {
      template: typeof template === 'string' ? template : undefined,
      component: typeof component === 'string' ? component : undefined,
      state: typeof state === 'string' ? state as ListNodesFilter['state'] : undefined,
      stability: typeof stability === 'string' ? stability as ListNodesFilter['stability'] : undefined,
    }
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const nodes = listNodes(targetGraph, filter)
      .filter(node => includeCore || !targetGraph.templates.get(node.template)?.info?.core)
      .map(node => {
        const ownership = summarizeNodeForNavigation(targetGraph, node)
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

  const GRAPH_EXCLUDED_TEMPLATES = new Set([
    'Schema', 'EnumDefinition', 'Field', 'EnumValue', 'Mapping',
  ])
  const GRAPH_SEMANTIC_EDGE_TYPES = new Set<EdgeType>([
    'triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from',
  ])

  app.get('/api/graph', async (req, res) => {
    try {
      let targetGraph = graph
      if (typeof req.query.ref === 'string' && multiCache) {
        targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
      }

      const nodes: Array<{ id: string; template: string; component: string; state: string; stability: string; parentId: string | null }> = []
      for (const node of targetGraph.nodesById.values()) {
        if (GRAPH_EXCLUDED_TEMPLATES.has(node.template)) continue
        const ownership = getNavigationOwnership(targetGraph, node)
        nodes.push({
          id: node.id,
          template: node.template,
          component: node.component,
          state: node.state,
          stability: node.stability,
          parentId: ownership?.parentId ?? null,
        })
      }

      const nodeIds = new Set(nodes.map(n => n.id))
      // Clear parentId when the parent itself was excluded from the graph
      for (const n of nodes) {
        if (n.parentId && !nodeIds.has(n.parentId)) n.parentId = null
      }
      const edges = []
      for (const edgeList of targetGraph.edgesByFrom.values()) {
        for (const edge of edgeList) {
          if (!GRAPH_SEMANTIC_EDGE_TYPES.has(edge.type)) continue
          if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
          edges.push({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })
        }
      }

      res.json({ nodes, edges })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/api/stats', async (req, res) => {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const components = new Set<string>()
    for (const node of targetGraph.nodesById.values()) {
      if (node.component) components.add(node.component)
    }

    const nodesWithEdges = new Set<string>()
    const edgesByType: Record<string, number> = {
      triggers: 0, produces: 0, reads: 0, calls: 0, implements: 0, 'maps-to': 0, 'derived-from': 0,
    }
    for (const edgeList of targetGraph.edgesByFrom.values()) {
      for (const edge of edgeList) {
        if (!GRAPH_SEMANTIC_EDGE_TYPES.has(edge.type)) continue
        edgesByType[edge.type]++
        nodesWithEdges.add(edge.from)
        nodesWithEdges.add(edge.to)
      }
    }

    const orphanNodeCount = [...targetGraph.nodesById.values()]
      .filter(node => !nodesWithEdges.has(node.id) && getNavigationOwnership(targetGraph, node) === undefined).length

    res.json({
      nodeCount: targetGraph.nodesById.size,
      componentCount: components.size,
      orphanNodeCount,
      edgesByType,
      diagnosticCount: targetGraph.diagnostics.length,
    })
  })

  app.get('/api/cluster', async (req, res) => {
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId query param required' })
      return
    }

    try {
      let targetGraph = graph
      if (typeof req.query.ref === 'string' && multiCache) {
        targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
      }

      const cluster = getClusterView(targetGraph, nodeId, parseIncludeEdges(req.query.includeEdges))
      const rawOverlayRefs = req.query.overlayRefs
      const overlayRefs = Array.isArray(rawOverlayRefs)
        ? rawOverlayRefs.filter((r): r is string => typeof r === 'string' && r.length > 0)
        : typeof rawOverlayRefs === 'string' && rawOverlayRefs.length > 0
          ? [rawOverlayRefs]
          : []
      let overlay = null
      if (overlayRefs.length > 0 && multiCache && typeof req.query.ref === 'string') {
        const multi = await multiCache.get()
        overlay = computeClusterOverlay(multi, req.query.ref, overlayRefs, nodeId)
      }

      res.json({
        root: summarizeNodeForNavigation(targetGraph, annotateNode(targetGraph, cluster.root)),
        descendants: cluster.descendants.map(child => summarizeNodeForNavigation(targetGraph, annotateNode(targetGraph, child))),
        includedNodes: cluster.includedNodes.map(node => summarizeNodeForNavigation(targetGraph, annotateNode(targetGraph, node))),
        edges: cluster.edges,
        overlay,
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

  app.get('/api/branches', async (_req, res) => {
    if (!source) {
      res.status(501).json({ error: 'multi-branch requires a configured source' })
      return
    }

    try {
      const multi = multiCache ? await multiCache.get() : await loadMultiGraph({ source })
      res.json({
        default: multi.default.ref,
        branches: multi.branches.map(branch => ({
          ref: branch.ref,
          isDefault: branch.isDefault,
        })),
        results: multi.branchResults,
      })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
    }
  })

  app.post('/api/reload', async (_req, res) => {
    try {
      await onReloadRequest?.()
      res.status(202).json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
    }
  })

  app.get('/api/overlay/:ref(*)', async (req, res) => {
    if (!source) {
      res.status(501).json({ error: 'multi-branch requires a configured source' })
      return
    }

    try {
      const multi = multiCache ? await multiCache.get() : await loadMultiGraph({ source })
      const overlay = multi.overlay(req.params.ref)
      res.json({
        viewingRef: overlay.viewingRef,
        nodes: [...overlay.nodes.values()].map(node => ({
          id: node.id,
          ghostState: node.ghostState,
          branches: [...node.presence.keys()],
          node: node.presence.get(overlay.viewingRef) ?? [...node.presence.values()][0],
        })),
      })
    } catch (err) {
      if (err instanceof QueryError) {
        res.status(400).json({ error: err.message })
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
      }
    }
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
  const multiCache = options.source ? createMultiGraphCache(options.source) : undefined
  let reloadInFlight: Promise<void> | null = null

  async function reloadState(reason: string): Promise<void> {
    if (reloadInFlight) return reloadInFlight
    reloadInFlight = (async () => {
      const nextGraph = options.source
        ? await loadGraph({ source: options.source, strict: true })
        : await loadGraph({ graphPath, strict: true })
      replaceGraph(graph, nextGraph)
      multiCache?.invalidate()
      reloadEvents.notify()
      logger(`[corum] graph reloaded after ${reason}`)
    })()

    try {
      await reloadInFlight
    } finally {
      reloadInFlight = null
    }
  }

  const app = createApp(graph, reloadEvents, options.source, multiCache, () => reloadState('manual reload'))
  const stopWatcher = isFileWatcherEnabled(options)
    ? startGraphFileWatcher(graph, {
        graphPath,
        debounceMs: options.fileWatcherDebounceMs,
        logger,
        onReload: () => {
          multiCache?.invalidate()
          reloadEvents.notify()
        },
      })
    : undefined
  const stopPoller = startGitSourcePoller(options.source, options.gitPollSeconds, logger, () => reloadState('git poll'))
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const addr = server.address() as AddressInfo
      if (options.port !== 0) {
        printBanner({
          config: [
            { key: 'graphPath', value: graphPath },
            { key: 'webDir', value: WEB_DIR },
            { key: 'port', value: String(addr.port) },
          ],
          services: [{ name: 'web', url: `http://localhost:${addr.port}` }],
          logger,
        })
      }
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res, rej) => {
          stopWatcher?.()
          stopPoller?.()
          server.close(err => (err ? rej(err) : res()))
        }),
      })
    })
    server.on('error', reject)
  })
}

function startGitSourcePoller(
  source: GraphSource | undefined,
  pollSeconds: number | undefined,
  logger: (message: string) => void,
  onChange: () => Promise<void>,
): (() => void) | undefined {
  if (!source || !pollSeconds || !hasReloadSignature(source)) return undefined
  const pollableSource = source

  let timer: NodeJS.Timeout | undefined
  let stopped = false
  let inFlight = false
  let lastSignature: string | null = null

  async function check(): Promise<void> {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const signature = await pollableSource.reloadSignature()
      if (lastSignature !== null && signature !== lastSignature) {
        await onChange()
      }
      lastSignature = signature
    } catch (err) {
      logger(`[corum] git poll failed: ${err}`)
    } finally {
      inFlight = false
    }
  }

  void check()
  timer = setInterval(() => {
    void check()
  }, pollSeconds * 1000)
  logger(`[corum] git poll enabled (${pollSeconds}s)`)

  return () => {
    stopped = true
    if (timer) clearInterval(timer)
  }
}

function hasReloadSignature(source: GraphSource): source is PollableGraphSource {
  return typeof (source as PollableGraphSource).reloadSignature === 'function'
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isEntrypoint()) {
  const config = createGraphRuntimeConfig()
  const graph = await loadGraph({ source: config.source, strict: true })
  await startWebServer(graph, {
    graphPath: config.graphPath,
    source: config.source,
    gitPollSeconds: config.gitPollSeconds,
    fileWatcher: config.fileWatcherGraphPath && process.argv.includes('--watch') ? true : undefined,
  })
}
