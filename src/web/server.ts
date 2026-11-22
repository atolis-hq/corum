import { printBanner } from '../banner.js'
import express from 'express'
import path from 'node:path'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Response } from 'express'
import { parse as parseYaml } from 'yaml'
import {
  computeClusterOverlay,
  getClusterView,
  getGraphSummary,
  expandExternalNodes,
  getKindLabel,
  getKindRegistry,
  getLineage,
  getNamespaces,
  getStructuralNodeTemplates,
  isLiveEdge,
  isVisibleEdgeType,
  listNodes,
  searchNodes,
  searchNodesRanked,
  type GetLineageOptions,
  type LineageDirection,
  type ListNodesFilter,
} from '../graph/index.js'
import { loadGraph, loadMultiGraph } from '../loader/index.js'
import { CORE_EDGE_TYPES } from '../loader/constants.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import { getPropertySchemasFromTemplate } from '../loader/template-props.js'
import type { EdgeType, Graph, MultiGraph, Node, Template } from '../schema/index.js'
import { QueryError } from '../schema/index.js'
import { registerVendorRoutes } from './vendor.js'
import { createGitPluginState, type GitPluginState } from './plugins/git-runtime.js'
import { ifNoneMatchSatisfied, resolvePluginAsset } from './plugins/assets.js'
import { BUILTIN_PLUGIN_DIR } from './plugins/builtin-dir.js'
import { createPluginRuntime, type PluginRuntime } from './plugins/runtime.js'
import { buildThemesCss } from './plugins/themes.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import { FileGraphSource } from '../source/file-source.js'
import type { GraphSource } from '../source/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WEB_DIR = path.join(__dirname, '..', '..', '..', 'web')
const require = createRequire(import.meta.url)
const { version } = require('../../../package.json') as { version: string }

export type WebServerOptions = {
  port?: number
  /** Interface to bind. Defaults to CORUM_WEB_HOST, then all interfaces. */
  host?: string
  graphPath?: string
  source?: GraphSource
  fileWatcher?: boolean
  /** Unpacked development plugin directories (`--plugin-dir`); watched regardless of `fileWatcher`. */
  pluginDirs?: string[]
  fileWatcherDebounceMs?: number
  gitPollSeconds?: number
  logger?: (message: string) => void
  /** Called after the served graph is reloaded (file watcher, git poll, or manual reload). */
  onReload?: () => void
}

export type WebServerHandle = {
  port: number
  close(): Promise<void>
}

export type GraphFileWatcherOptions = {
  graphPath: string
  debounceMs?: number
  logger?: (message: string) => void
  /** Standalone plugin directories to watch; only their `plugin.yaml` changes matter. */
  pluginWatchDirs?: () => string[]
  /** Development plugin directories: any file change inside them reloads the plugin list. */
  devPluginWatchDirs?: () => string[]
  /** Watch the graph, packs and standalone plugins. False watches only development plugin directories. */
  watchGraph?: boolean
  /**
   * Called after a debounced batch of changes. `graphReloaded` is false when only plugin
   * manifests changed; `pluginsChanged` is false when only graph data (node files) changed.
   */
  onReload?: (info: { graphReloaded: boolean; pluginsChanged: boolean }) => void
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

export function createMultiGraphCache(source: GraphSource): MultiGraphCache {
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

/** Walk materialized parentId links to the cluster root; undefined for roots. */
function getOwningRoot(graph: Graph, node: Node, firstParentId?: string): Node | undefined {
  let current: Node = node
  let parentId = current.parentId ?? firstParentId
  const seen = new Set<string>([current.id])
  while (parentId !== undefined && !seen.has(parentId)) {
    const parent = graph.nodesById.get(parentId)
    if (!parent) break
    seen.add(parent.id)
    current = parent
    parentId = current.parentId
  }
  return current === node ? undefined : current
}

function summarizeNodeForNavigation(graph: Graph, node: Node): Node & { parentId?: string; ownedSection?: string } {
  const ownership = getNavigationOwnership(graph, node)
  return {
    ...node,
    ...(ownership ?? {}),
  }
}

type NodeRefValue = { display: string; nodeId: string } | { display: string }

function resolveLocalRef(graph: Graph, node: Node, section: string, name: string): string | undefined {
  // Walk up the node ID hierarchy to find the nearest ancestor owning section.name.
  // This handles refs on both root nodes and nested child nodes correctly.
  let ancestor = node.parentId ?? node.id
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
  // Local refs use #/{section}/{name} for any owned section — section names
  // are pack-defined, so no fixed prefix list here.
  const local = /^#\/([^/]+)\/(.+)$/.exec(rawValue)
  if (local) {
    const [, section, name] = local
    const id = resolveLocalRef(graph, node, section, name)
    return id ? { display: name, nodeId: id } : { display: name }
  }
  if (graph.nodesById.has(rawValue)) return { display: rawValue, nodeId: rawValue }
  return { display: rawValue }
}

function annotateNodeRefProperties(graph: Graph, node: Node, template: Template): Record<string, unknown> {
  if (!template.properties) return node.properties
  const propSchemas = getPropertySchemasFromTemplate(template.properties as Record<string, unknown>)
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

function parseIncludeEdges(value: unknown, graph: Graph): EdgeType[] {
  if (typeof value !== 'string' || value.trim() === '') return []
  const known = graph.edgeTypes ?? new Map(Object.entries(CORE_EDGE_TYPES))
  const types = value
    .split(',')
    .map(item => item.trim())
    .filter((item): item is EdgeType => known.has(item))
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

export function replaceGraph(target: Graph, source: Graph): void {
  target.nodesById = source.nodesById
  target.edgesByFrom = source.edgesByFrom
  target.edgesByTo = source.edgesByTo
  target.templates = source.templates
  target.diagnostics = source.diagnostics
  target.edgeTypes = source.edgeTypes
  target.namespaceDeclarations = source.namespaceDeclarations
  target.kinds = source.kinds
  target.sourceContent = source.sourceContent
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

  let packDirs: string[] = []
  let pluginDirs: string[] = []
  let devDirs: string[] = []
  const watchGraph = options.watchGraph ?? true
  let needGraphReload = false
  let needPluginRefresh = false

  function refreshWatchers(): void {
    closeWatchers()
    packDirs = watchGraph ? resolvePackDirs(graphPath) : []
    pluginDirs = watchGraph ? (options.pluginWatchDirs?.() ?? []).map(dir => path.resolve(dir)) : []
    devDirs = (options.devPluginWatchDirs?.() ?? []).map(dir => path.resolve(dir))
    const graphRoots = watchGraph ? [path.resolve(graphPath)] : []
    watchers = [...new Set([...graphRoots, ...packDirs, ...pluginDirs, ...devDirs])]
      .flatMap(root => watchRoot(root, filename => scheduleReload(root, filename)))
  }

  function isInside(file: string, dir: string): boolean {
    const relative = path.relative(dir, file)
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  }

  /** What a change to this file affects: the graph data, the plugin list, or both. */
  function classify(root: string, filename: string): { graph: boolean; plugins: boolean } | null {
    const file = path.resolve(root, filename)
    if (devDirs.some(dir => isInside(file, dir))) return { graph: false, plugins: true }
    if (file === path.join(path.resolve(graphPath), 'graph.yaml')) return { graph: true, plugins: true }
    if (packDirs.some(dir => isInside(file, dir))) return { graph: true, plugins: true }
    if (pluginDirs.some(dir => isInside(file, dir))) {
      return path.basename(file) === 'plugin.yaml' ? { graph: false, plugins: true } : null
    }
    return { graph: true, plugins: false }
  }

  async function reload(): Promise<void> {
    if (reloading) {
      // A change arrived mid-reload: try again once it finishes instead of dropping it.
      timer = setTimeout(() => {
        timer = undefined
        void reload()
      }, debounceMs)
      return
    }
    reloading = true
    const graphReloaded = needGraphReload
    const pluginsChanged = needPluginRefresh
    needGraphReload = false
    needPluginRefresh = false
    try {
      if (graphReloaded) {
        const nextGraph = await loadGraph({ graphPath, strict: true })
        replaceGraph(graph, nextGraph)
      }
      refreshWatchers()
      onReload?.({ graphReloaded, pluginsChanged })
      logger(graphReloaded ? `[corum] graph reloaded after file change` : `[corum] plugins refreshed after file change`)
    } catch (err) {
      logger(`[corum] graph reload failed: ${err}`)
    } finally {
      reloading = false
    }
  }

  function scheduleReload(root: string, filename?: string | Buffer | null): void {
    // Development plugin directories react to any file; everything else only to YAML.
    if (!devDirs.includes(root) && !isRelevantWatchEvent(filename)) return
    // An event without a filename from a development directory can only mean plugin files changed.
    const found = filename
      ? classify(root, String(filename))
      : devDirs.includes(root) ? { graph: false, plugins: true } : { graph: true, plugins: true }
    if (!found) return
    // Without graph watching (development directories only) the graph is never reloaded from disk.
    const effect = watchGraph ? found : { graph: false, plugins: found.plugins }
    if (!effect.graph && !effect.plugins) return
    needGraphReload ||= effect.graph
    needPluginRefresh ||= effect.plugins
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
  pluginRuntime: PluginRuntime = createPluginRuntime({
    graph,
    graphDir: null,
    builtinDir: BUILTIN_PLUGIN_DIR,
    corumVersion: version,
  }),
  gitPluginsOption?: GitPluginState,
): express.Application {
  const app = express()

  // Versioned asset prefix: /v/<version>/<path> serves the same handlers as /<path>. A different
  // version is a 404 so a stale page fails loudly instead of receiving new bytes under old URLs.
  const assetPrefix = `/v/${encodeURIComponent(version)}`
  app.use((req, res, next) => {
    const match = /^\/v\/([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(req.url)
    if (!match) { next(); return }
    const rest = match[2] ?? '/'
    // The page links /api/themes.css as a first-party asset, so it is the one API path served under the version prefix.
    if (match[1] !== encodeURIComponent(version) || (/^\/(api|v)(\/|$)/.test(rest) && rest !== '/api/themes.css')) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    req.url = rest + (match[3] ?? '')
    next()
  })
  const gitPlugins = gitPluginsOption ?? (source?.pluginSnapshot ? createGitPluginState(source, BUILTIN_PLUGIN_DIR, version) : undefined)

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
        role: template.info?.role,
        description: template.info?.description,
        ui: template.ui,
      }))
    res.json(templates)
  })

  app.get('/api/edge-types', async (req, res) => {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }
    const defs = targetGraph.edgeTypes ?? new Map(Object.entries(CORE_EDGE_TYPES))
    res.json([...defs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(def => ({
        name: def.name,
        category: def.category,
        hidden: def.hidden ?? false,
        ...(def.colour !== undefined && { colour: def.colour }),
        ...(def.line !== undefined && { line: def.line }),
      })))
  })

  app.get('/api/nodes', async (req, res) => {
    const { namespace, kind, state, stability } = req.query
    const includeCore = req.query.includeCore === 'true'
    const singleTemplate = typeof req.query.template === 'string' && req.query.template
      ? [req.query.template]
      : undefined
    const multiTemplates = Array.isArray(req.query.templates)
      ? req.query.templates.filter((template): template is string => typeof template === 'string')
      : typeof req.query.templates === 'string' && req.query.templates
        ? [req.query.templates]
        : undefined
    const filter: ListNodesFilter = {
      templates: multiTemplates ?? singleTemplate,
      namespace: typeof namespace === 'string' ? namespace : undefined,
      kind: typeof kind === 'string' ? kind : undefined,
      state: typeof state === 'string' ? state as ListNodesFilter['state'] : undefined,
      stability: typeof stability === 'string' ? stability as ListNodesFilter['stability'] : undefined,
    }
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const namespaces = getNamespaces(targetGraph)
    const nodes = listNodes(targetGraph, filter)
      .filter(node => includeCore || !targetGraph.templates.get(node.template)?.info?.core)
      .map(node => {
        const ownership = summarizeNodeForNavigation(targetGraph, node)
        return {
          id: ownership.id,
          template: ownership.template,
          namespace: ownership.namespace,
          kind: namespaces.get(ownership.namespace)?.kind ?? 'component',
          state: ownership.state,
          stability: ownership.stability,
          parentId: ownership.parentId,
          ownedSection: ownership.ownedSection,
          ...(() => {
            const owner = getOwningRoot(targetGraph, node, ownership.parentId)
            return owner ? { rootId: owner.id, rootTemplate: owner.template } : {}
          })(),
        }
      })
    res.json(nodes)
  })


  app.get('/api/graph', async (req, res) => {
    try {
      let targetGraph = graph
      if (typeof req.query.ref === 'string' && multiCache) {
        targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
      }

      const filterTemplates = Array.isArray(req.query.templates)
        ? req.query.templates.filter((template): template is string => typeof template === 'string')
        : typeof req.query.templates === 'string' && req.query.templates
          ? [req.query.templates]
          : undefined
      const filterExcludeTemplates = Array.isArray(req.query.exclude_templates)
        ? req.query.exclude_templates.filter((template): template is string => typeof template === 'string')
        : undefined
      const excludeSet = filterTemplates?.length
        ? null
        : filterExcludeTemplates?.length
          ? new Set(filterExcludeTemplates)
          : getStructuralNodeTemplates(targetGraph)

      const namespaces = getNamespaces(targetGraph)
      const nodes: Array<{ id: string; template: string; namespace: string; kind: string; state: string; stability: string; parentId: string | null }> = []
      for (const node of targetGraph.nodesById.values()) {
        if (filterTemplates?.length && !filterTemplates.includes(node.template)) continue
        if (excludeSet?.has(node.template)) continue
        const ownership = getNavigationOwnership(targetGraph, node)
        nodes.push({
          id: node.id,
          template: node.template,
          namespace: node.namespace,
          kind: namespaces.get(node.namespace)?.kind ?? 'component',
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
          if (!isLiveEdge(edge) || !isVisibleEdgeType(targetGraph, edge.type)) continue
          if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
          edges.push({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })
        }
      }

      res.json({ nodes, edges })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/api/kinds', async (req, res) => {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }
    const namespaces = getNamespaces(targetGraph)
    res.json({
      kinds: getKindRegistry(targetGraph),
      namespaces: [...namespaces]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, ns]) => ({ namespace: name, kind: ns.kind, label: getKindLabel(targetGraph, ns.kind) })),
    })
  })

  app.get('/api/stats', async (req, res) => {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }
    res.json(getGraphSummary(targetGraph))
  })

  app.get('/api/search', async (req, res) => {
    try {
      let targetGraph = graph
      if (typeof req.query.ref === 'string' && multiCache) {
        targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
      }

      const q = typeof req.query.q === 'string' ? req.query.q : ''
      if (req.query.include_owned === 'true') {
        // Opt-in web UI mode: all nodes, ranked and capped; default stays root-only.
        res.json(searchNodesRanked(targetGraph, q))
        return
      }
      const queries = q.split(',').map(part => part.trim()).filter(Boolean)
      const templates = Array.isArray(req.query.templates)
        ? req.query.templates.filter((template): template is string => typeof template === 'string')
        : typeof req.query.templates === 'string' && req.query.templates
          ? [req.query.templates]
          : undefined
      const excludeTemplates = Array.isArray(req.query.exclude_templates)
        ? req.query.exclude_templates.filter((template): template is string => typeof template === 'string')
        : undefined
      const rawLimit = parseInt(String(req.query.limit ?? '10'), 10)
      const rawOffset = parseInt(String(req.query.offset ?? '0'), 10)

      res.json(searchNodes(targetGraph, queries, {
        templates,
        excludeTemplates,
        limit: Number.isNaN(rawLimit) ? 10 : rawLimit,
        offset: Number.isNaN(rawOffset) ? 0 : rawOffset,
        searchProperties: req.query.search_properties === 'true',
      }))
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/api/lineage', async (req, res) => {
    try {
      let targetGraph = graph
      if (typeof req.query.ref === 'string' && multiCache) {
        targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
      }

      const nodeIds = Array.isArray(req.query.node_ids)
        ? req.query.node_ids.filter((id): id is string => typeof id === 'string')
        : typeof req.query.node_ids === 'string' && req.query.node_ids
          ? [req.query.node_ids]
          : []
      if (nodeIds.length === 0) {
        res.status(400).json({ error: 'node_ids query param required' })
        return
      }

      const rawDepth = parseInt(String(req.query.depth ?? '2'), 10)
      const direction = (['downstream', 'upstream', 'both'] as const).includes(req.query.direction as LineageDirection)
        ? req.query.direction as LineageDirection
        : 'downstream'
      const knownEdgeTypes = targetGraph.edgeTypes ?? new Map(Object.entries(CORE_EDGE_TYPES))
      const edgeTypes = Array.isArray(req.query.edge_types)
        ? req.query.edge_types.filter((type): type is EdgeType => typeof type === 'string' && knownEdgeTypes.has(type))
        : undefined
      const excludeNodeTypes = Array.isArray(req.query.exclude_node_types)
        ? req.query.exclude_node_types.filter((type): type is string => typeof type === 'string')
        : undefined
      const options: GetLineageOptions = {
        depth: Number.isNaN(rawDepth) ? 2 : rawDepth,
        direction,
        edgeTypes,
        excludeNodeTypes,
        includeDanglingEdges: req.query.include_dangling_edges === 'true',
        readsOutboundOnly: req.query.reads_outbound_only !== 'false',
      }

      res.json(getLineage(targetGraph, nodeIds, options))
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
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

      const cluster = getClusterView(targetGraph, nodeId, parseIncludeEdges(req.query.includeEdges, targetGraph), {
        includeInboundReads: true,
      })
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

      // Compute included nodes from dangling semantic edges: data-type nodes (Schema,
      // EnumDefinition) are expanded with structural children; operational nodes get
      // root metadata only (for connectivity panels).
      const clusterIds = new Set([cluster.root.id, ...cluster.descendants.map(n => n.id)])
      const externalIds = new Set<string>()
      for (const edge of cluster.edges) {
        if (!clusterIds.has(edge.from)) externalIds.add(edge.from)
        if (!clusterIds.has(edge.to)) externalIds.add(edge.to)
      }
      const includedNodes = expandExternalNodes(targetGraph, externalIds)

      const owner = getOwningRoot(targetGraph, cluster.root)
      res.json({
        root: summarizeNodeForNavigation(targetGraph, annotateNode(targetGraph, cluster.root)),
        ...(owner ? { owner: { id: owner.id, template: owner.template } } : {}),
        descendants: cluster.descendants.map(child => summarizeNodeForNavigation(targetGraph, annotateNode(targetGraph, child))),
        includedNodes: includedNodes.map(node => {
          const summary = summarizeNodeForNavigation(targetGraph, annotateNode(targetGraph, node))
          const owningRoot = getOwningRoot(targetGraph, node, summary.parentId)
          return {
            ...summary,
            ...(owningRoot ? { rootId: owningRoot.id, rootTemplate: owningRoot.template } : {}),
          }
        }),
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

  app.get('/api/plugins', async (_req, res, next) => {
    try {
      if (gitPlugins) {
        const request = await gitPlugins.current()
        res.setHeader('Cache-Control', 'no-cache')
        res.json(request.statuses)
        return
      }
      res.setHeader('Cache-Control', 'no-cache')
      res.json(pluginRuntime.statuses())
    } catch (error) { next(error) }
  })

  // The stylesheet of every registered theme (ADR-011 section 3): sanitised and scoped to html[data-theme="<id>"].
  let lastThemeDiagnostics = ''
  app.get('/api/themes.css', async (_req, res, next) => {
    try {
      const request = gitPlugins ? await gitPlugins.current() : null
      const statuses = request ? request.statuses : pluginRuntime.statuses()
      const read = async (pluginId: string, file: string): Promise<string | null> => {
        if (request) {
          const plugin = request.enabledPlugin(pluginId)
          if (!plugin) return null
          if (plugin.origin !== 'builtin' && plugin.origin !== 'dev') {
            const asset = await request.asset(plugin, file.replace(/^(\.\/)+/, ''))
            return asset ? asset.bytes.toString('utf8') : null
          }
          const local = resolvePluginAsset(plugin.dir, file.replace(/^(\.\/)+/, ''))
          return local ? readFileSync(local.file, 'utf8') : null
        }
        const dir = pluginRuntime.enabledDir(pluginId)
        const local = dir ? resolvePluginAsset(dir, file.replace(/^(\.\/)+/, '')) : null
        return local ? readFileSync(local.file, 'utf8') : null
      }
      const built = await buildThemesCss(statuses, read)
      const signature = built.diagnostics.join('\n')
      if (signature !== lastThemeDiagnostics) {
        lastThemeDiagnostics = signature
        for (const message of built.diagnostics) console.error(`[corum] theme: ${message}`)
      }
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Content-Type', 'text/css; charset=utf-8')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.send(built.css)
    } catch (error) { next(error) }
  })

  app.get('/plugins/:id/*', async (req, res, next) => {
    try {
      const request = gitPlugins ? await gitPlugins.current() : null
      const plugin = request?.enabledPlugin(req.params.id)
      // Built-in and development plugins live on local disk; everything else is read from the pinned commit.
      if (request && plugin?.origin !== 'builtin' && plugin?.origin !== 'dev') {
        const asset = plugin ? await request.asset(plugin, (req.params as Record<string, string>)[0] ?? '') : null
        if (!asset) { res.status(404).json({ error: 'Not found' }); return }
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('ETag', asset.etag)
        res.setHeader('Content-Type', asset.contentType)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        if (ifNoneMatchSatisfied(req.headers['if-none-match'], asset.etag)) res.status(304).end()
        else res.send(asset.bytes)
        return
      }
      const dir = request ? plugin?.dir ?? null : pluginRuntime.enabledDir(req.params.id)
      const asset = dir ? resolvePluginAsset(dir, (req.params as Record<string, string>)[0] ?? '') : null
      if (!asset) {
        res.status(404).json({ error: 'Not found' })
        return
      }
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('ETag', asset.etag)
      res.setHeader('Content-Type', asset.contentType)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (ifNoneMatchSatisfied(req.headers['if-none-match'], asset.etag)) {
        res.status(304).end()
        return
      }
      res.sendFile(asset.file, { etag: false, lastModified: false, cacheControl: false, acceptRanges: false, dotfiles: 'allow' }, err => {
        if (err && !res.headersSent) res.status(404).json({ error: 'Not found' })
      })
    } catch (error) { next(error) }
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

  const versionAsset = (url: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)
    ? url
    : `${assetPrefix}/${url.replace(/^\//, '')}`
  const indexHtml = readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
    .replace(/\b(href|src)="([^"]+)"/g, (_m, attr: string, url: string) => `${attr}="${versionAsset(url)}"`)
    .replace(/("[^"\n]+":\s*)"(\/[^"]+)"/g, (_m, key: string, url: string) => `${key}"${versionAsset(url)}"`)

  app.get(['/', '/index.html'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(indexHtml)
  })

  app.use(['/plugins', '/vendor'], (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  })

  registerVendorRoutes(app)

  // Built-in plugin sources are reachable only through /plugins/:id/* (which enforces enabled state and extension rules).
  app.use('/builtin', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use(express.static(WEB_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.jsx')) {
        res.setHeader('Content-Type', 'text/babel; charset=utf-8')
      }
    },
  }))

  // Final error handler: never leak stack traces or filesystem paths.
  app.use((err: unknown, _req: express.Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err)
      return
    }
    const status = typeof err === 'object' && err !== null && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500
    const clientError = status >= 400 && status < 500
    res.status(clientError ? status : 500).json({ error: clientError ? (status === 400 ? 'Bad request' : 'Request failed') : 'Internal server error' })
  })

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
  const host = options.host ?? process.env.CORUM_WEB_HOST
  const graphPath = options.graphPath ?? process.env.CORUM_GRAPH_PATH ?? path.join(process.cwd(), '.corum/graph')
  const logger = options.logger ?? console.error
  const reloadEvents = createReloadEvents()
  const multiCache = options.source ? createMultiGraphCache(options.source) : undefined
  let reloadInFlight: Promise<void> | null = null
  // File runtime retains watcher behavior; Git plugin requests resolve their own pinned snapshot.
  const pluginGraphDir = options.source && !(options.source instanceof FileGraphSource) ? null : graphPath
  const pluginRuntime = createPluginRuntime({
    graph,
    graphDir: pluginGraphDir,
    builtinDir: BUILTIN_PLUGIN_DIR,
    corumVersion: version,
    // Git sources resolve development plugins inside their own pinned plugin state.
    devPluginDirs: pluginGraphDir === null ? undefined : options.pluginDirs,
    logger,
  })

  const gitPlugins = options.source?.pluginSnapshot
    ? createGitPluginState(options.source, BUILTIN_PLUGIN_DIR, version, logger, undefined, options.pluginDirs)
    : undefined
  const devPluginWatchDirs = (options.pluginDirs ?? []).map(dir => path.resolve(dir))

  async function reloadState(reason: string): Promise<void> {
    if (reloadInFlight) return reloadInFlight
    reloadInFlight = (async () => {
      const nextGraph = options.source
        ? await loadGraph({ source: options.source, strict: true })
        : await loadGraph({ graphPath, strict: true })
      // Resolve the default-branch commit once per reload, before anything is
      // swapped: a failure fails the reload so the poller retries it.
      const nextPlugins = await gitPlugins?.prepare()
      replaceGraph(graph, nextGraph)
      multiCache?.invalidate()
      pluginRuntime.refresh()
      if (nextPlugins) gitPlugins?.install(nextPlugins)
      options.onReload?.()
      reloadEvents.notify()
      logger(`[corum] graph reloaded after ${reason}`)
    })()

    try {
      await reloadInFlight
    } finally {
      reloadInFlight = null
    }
  }

  const app = createApp(graph, reloadEvents, options.source, multiCache, () => reloadState('manual reload'), pluginRuntime, gitPlugins)
  const watchGraphFiles = isFileWatcherEnabled(options)
  const stopWatcher = watchGraphFiles || devPluginWatchDirs.length > 0
    ? startGraphFileWatcher(graph, {
        graphPath,
        watchGraph: watchGraphFiles,
        devPluginWatchDirs: () => devPluginWatchDirs,
        debounceMs: options.fileWatcherDebounceMs,
        logger,
        pluginWatchDirs: () => pluginRuntime.watchDirs(),
        onReload: ({ graphReloaded, pluginsChanged }) => {
          // Node-data changes do not re-resolve plugins; plugin/pack/graph.yaml changes do.
          if (graphReloaded) multiCache?.invalidate()
          if (pluginsChanged) {
            pluginRuntime.refresh()
            gitPlugins?.refreshDev()
          }
          options.onReload?.()
          reloadEvents.notify()
        },
      })
    : undefined
  const stopPoller = startGitSourcePoller(options.source, options.gitPollSeconds, logger, () => reloadState('git poll'))
  return new Promise((resolve, reject) => {
    const onListening = () => {
      const addr = server.address() as AddressInfo
      if (options.port !== 0) {
        printBanner({
          config: [
            { key: 'graphPath', value: graphPath },
            { key: 'webDir', value: WEB_DIR },
            { key: 'host', value: host ?? 'all interfaces' },
            { key: 'port', value: String(addr.port) },
          ],
          services: [{ name: 'web', url: `http://localhost:${addr.port}` }],
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
    }
    const server = host ? app.listen(port, host, onListening) : app.listen(port, onListening)
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
