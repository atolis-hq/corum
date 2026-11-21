import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import type { GraphSource, PluginSnapshot } from '../../source/index.js'
import { loadGraph } from '../../loader/index.js'
import { discoverPlugins, readPluginOverrides, readStandalonePaths, validatePluginsKey, type DiscoveredPlugin, type PluginOrigin } from './discover.js'
import { isSafeRelativePath, parsePluginManifest, type PluginManifest } from './manifest.js'
import { parsePluginAssetPath } from './assets.js'
import { resolvePluginStatuses, type PluginStatus } from './status.js'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

type PluginRequest = Awaited<ReturnType<typeof computePluginRequest>>
const cache = new WeakMap<GraphSource, { key: string; value: Promise<PluginRequest> }>()

/**
 * One request, one default-branch commit, including compatibility and asset bytes.
 * Computed state is shared by every request at the same commit.
 */
export async function gitPluginRequest(source: GraphSource, builtinDir: string, corumVersion: string): Promise<PluginRequest> {
  const snapshot = await source.pluginSnapshot!()
  const key = `${snapshot.ref}\0${builtinDir}\0${corumVersion}`
  const hit = cache.get(source)
  if (hit?.key === key) return hit.value
  const value = computePluginRequest(snapshot, builtinDir, corumVersion)
  cache.set(source, { key, value })
  value.catch(() => { if (cache.get(source)?.value === value) cache.delete(source) })
  return value
}

async function computePluginRequest(snapshot: PluginSnapshot, builtinDir: string, corumVersion: string) {
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
        main: '', contributes: { pages: [], nodeActions: [] },
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
  const statuses = [...resolvePluginStatuses(plugins, {
    graphTemplates: templates, corumVersion,
    overrides: readPluginOverrides(graphYaml),
  }), ...missing]
  return {
    statuses, errors,
    enabledPlugin(id: string): DiscoveredPlugin | null {
      return statuses.find(status => status.id === id)?.status === 'enabled'
        ? plugins.find(plugin => plugin.manifest.id === id) ?? null : null
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
  }
}
