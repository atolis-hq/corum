import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import type { GraphSource, PluginSnapshot } from '../../source/index.js'
import { loadGraph } from '../../loader/index.js'
import { discoverPlugins, mergeDevPlugins, readPluginOverrides, readStandalonePaths, validatePluginsKey, type DiscoveredPlugin, type PluginOrigin } from './discover.js'
import { isSafeRelativePath, parsePluginManifest, type PluginManifest } from './manifest.js'
import { parsePluginAssetPath } from './assets.js'
import { resolvePluginStatuses, type PluginStatus } from './status.js'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export type PluginRequest = {
  ref: string
  statuses: PluginStatus[]
  errors: string[]
  enabledPlugin(id: string): DiscoveredPlugin | null
  asset(plugin: DiscoveredPlugin, requestPath: string): Promise<{ bytes: Buffer; contentType: string; etag: string } | null>
  /** The same pinned commit with unpacked development plugins overlaid; they are read from local disk. */
  withDev(devDirs: string[]): PluginRequest
}

/** Resolve the default-branch commit and compute plugin state for it (no caching). */
export async function gitPluginRequest(source: GraphSource, builtinDir: string, corumVersion: string): Promise<PluginRequest> {
  return computePluginRequest(await source.pluginSnapshot!(), builtinDir, corumVersion)
}

export type GitPluginState = {
  /**
   * Resolve the default-branch commit and compute its plugin state without
   * publishing it. Rejects on failure so the caller can fail the whole reload.
   */
  prepare(): Promise<PluginRequest>
  /** Publish a prepared state (swapped in together with the graph). */
  install(next: PluginRequest): void
  /** Current pinned state; never contacts the source once a full state exists. */
  current(): Promise<PluginRequest>
  /** Re-read development plugins from disk (their files changed); the pinned commit is unchanged. */
  refreshDev(): void
}

/**
 * Holds the plugin state for the commit the last reload resolved. Requests
 * read it without any git work, so one request sees exactly one commit.
 * If no state could be built at startup, built-ins are served and the build is
 * retried (at most once per `retryMs`) until it succeeds.
 */
export function createGitPluginState(
  source: GraphSource, builtinDir: string, corumVersion: string,
  logger: (message: string) => void = () => {}, retryMs = 5000, devDirs: string[] = [],
): GitPluginState {
  let devView: { base: PluginRequest; view: PluginRequest } | null = null
  let lastDevLog = ''
  function withDev(base: PluginRequest): PluginRequest {
    if (devDirs.length === 0) return base
    if (devView?.base === base) return devView.view
    const view = base.withDev(devDirs)
    devView = { base, view }
    const added = view.errors.filter(error => !base.errors.includes(error))
    const signature = added.join('\n')
    if (signature !== lastDevLog) {
      lastDevLog = signature
      for (const error of added) logger(`[corum] plugin: ${error}`)
    }
    return view
  }
  let state: PluginRequest | null = null
  let fallback = false
  let nextRetryAt = 0
  let building: Promise<PluginRequest> | null = null
  let lastRef: string | undefined

  async function prepare(): Promise<PluginRequest> {
    return computePluginRequest(await source.pluginSnapshot!(), builtinDir, corumVersion)
  }
  function install(next: PluginRequest) {
    state = next
    fallback = false
    if (next.ref !== lastRef) {
      lastRef = next.ref
      for (const error of next.errors) logger(`[corum] plugin: ${error}`)
    }
  }
  async function build(): Promise<PluginRequest> {
    try {
      const next = await prepare()
      install(next)
      return next
    } catch (error) {
      nextRetryAt = Date.now() + retryMs
      if (state) return state
      state = await builtinsOnly(error)
      fallback = true
      return state
    }
  }
  /** Built-ins only, used when the source is unreachable and no state exists yet. */
  async function builtinsOnly(error: unknown): Promise<PluginRequest> {
    logger(`[corum] plugin state unavailable, serving built-ins only: ${error instanceof Error ? error.message : String(error)}`)
    const stub = {
      ref: 'unavailable', graphDir: '', source: {} as PluginSnapshot['source'],
      readFile: async () => null,
    } as PluginSnapshot
    return computePluginRequest(stub, builtinDir, corumVersion)
  }

  return {
    prepare,
    install,
    async current() {
      if (state && !(fallback && Date.now() >= nextRetryAt)) return withDev(state)
      building ??= build().finally(() => { building = null })
      return withDev(await building)
    },
    refreshDev() { devView = null },
  }
}

async function computePluginRequest(snapshot: PluginSnapshot, builtinDir: string, corumVersion: string): Promise<PluginRequest> {
  // A broken default-branch graph must not take plugins down: plugins that
  // require templates become unavailable, everything else keeps working.
  let templates = new Set<string>()
  try {
    const graph = await loadGraph({ source: snapshot.source, strict: false })
    templates = new Set(graph.templates.keys())
  } catch { /* leave the template set empty */ }
  const readYaml = async (file: string): Promise<unknown> => {
    const bytes = await snapshot.readFile(file)
    if (!bytes) return null
    try { return parseYaml(bytes.toString('utf8')) } catch { return null }
  }
  const graphYaml = await readYaml(path.posix.join(snapshot.graphDir, 'graph.yaml'))
  const discovered = discoverPlugins({ builtinDir, graphDir: null, graphYaml: null, packPluginDirs: [] })
  const errors = [...discovered.errors, ...validatePluginsKey(graphYaml)]
  const plugins = discovered.plugins
  const missing: PluginStatus[] = []
  const ids = new Set(plugins.map(plugin => plugin.manifest.id))
  const missingPaths = new Set<string>()

  async function add(declared: string, base: string, origin: PluginOrigin) {
    const dir = path.posix.normalize(path.posix.join(base, declared))
    const bytes = await snapshot.readFile(path.posix.join(dir, 'plugin.yaml'))
    if (!bytes) {
      // Missing declarations are keyed by path and never compete with manifest IDs.
      if (missingPaths.has(declared)) return
      missingPaths.add(declared)
      // A missing manifest has no ID; preserve the exact author-supplied path.
      const manifest: PluginManifest = {
        id: declared, version: '', engines: { corum: '*' }, requires: { templates: [] },
        main: '', contributes: { pages: [], nodeActions: [], themes: [] },
      }
      missing.push({
        id: declared, name: declared, origin, version: '', manifest, status: 'unavailable',
        reason: `plugin.yaml not found at ${declared} on ${snapshot.ref.slice(0, 7)}`,
      })
      return
    }
    const parsed = parsePluginManifest(bytes.toString('utf8'))
    errors.push(...parsed.errors.map(error => `${declared}: ${error}`))
    if (!parsed.manifest) return
    if (ids.has(parsed.manifest.id)) {
      errors.push(`duplicate plugin id "${parsed.manifest.id}" in ${dir}; keeping the first plugin`)
      return
    }
    ids.add(parsed.manifest.id)
    plugins.push({ manifest: parsed.manifest, dir, origin })
  }

  const packs = record(graphYaml).templatePacks
  for (const pack of Array.isArray(packs) ? packs : []) {
    const packPath = record(pack).path
    if (typeof packPath !== 'string') continue
    const dir = path.posix.normalize(path.posix.join(snapshot.graphDir, packPath))
    const declarations = record(await readYaml(path.posix.join(dir, 'pack.yaml'))).plugins
    for (const declared of Array.isArray(declarations) ? declarations : []) {
      if (typeof declared !== 'string' || !isSafeRelativePath(declared)) {
        errors.push(`pack ${dir}: invalid plugins entry ${JSON.stringify(declared)}`)
        continue
      }
      await add(declared, dir, 'pack')
    }
  }
  for (const declared of readStandalonePaths(graphYaml)) {
    await add(declared, snapshot.graphDir, 'standalone')
  }
  const overrides = readPluginOverrides(graphYaml)

  /** Assemble the request view, optionally overlaying development plugins (read from local disk). */
  function assemble(devDirs: string[]): PluginRequest {
    const all = plugins.map(plugin => ({ ...plugin }))
    const devMessages = devDirs.length > 0 ? mergeDevPlugins(all, devDirs) : []
    const statuses = [...resolvePluginStatuses(all, {
      graphTemplates: templates, corumVersion, overrides,
    }), ...missing]
    return {
      ref: snapshot.ref, statuses, errors: [...errors, ...devMessages],
      enabledPlugin(id: string): DiscoveredPlugin | null {
        // A shadowed or duplicate entry shares its id with the plugin that is served.
        const enabled = statuses.some(status => status.id === id && status.status === 'enabled')
        return enabled ? all.find(plugin => plugin.manifest.id === id && plugin.unavailableReason === undefined) ?? null : null
      },
      async asset(plugin: DiscoveredPlugin, requestPath: string) {
        const request = parsePluginAssetPath(requestPath)
        if (!request) return null
        const bytes = await snapshot.readFile(path.posix.join(plugin.dir, request.decoded))
        if (!bytes) return null
        return {
          bytes, contentType: request.contentType,
          etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
        }
      },
      withDev: assemble,
    }
  }
  return assemble([])
}
