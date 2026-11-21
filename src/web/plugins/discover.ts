import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { isSafeRelativePath, parsePluginManifest, type PluginManifest } from './manifest.js'

export type PluginOrigin = 'builtin' | 'pack' | 'standalone' | 'dev'

export type DiscoveredPlugin = {
  manifest: PluginManifest
  dir: string
  origin: PluginOrigin
  /** Set when this plugin is listed but not usable (shadowed or duplicate); status becomes unavailable. */
  unavailableReason?: string
}

export type PluginOverride = { id: string; enabled: boolean }

export type DiscoverOptions = {
  builtinDir: string
  graphDir: string | null
  graphYaml: unknown
  packPluginDirs: string[]
  /** Unpacked development plugins (`--plugin-dir`); never read from graph configuration. */
  devPluginDirs?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extra built-in plugin parent directories (comma-separated). Test-only. */
export function extraBuiltinDirsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CORUM_BUILTIN_PLUGIN_DIRS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
}

function readManifestFile(dir: string, label: string, errors: string[]): PluginManifest | null {
  const manifestPath = path.join(dir, 'plugin.yaml')
  if (!existsSync(manifestPath)) {
    errors.push(`${label}: no plugin.yaml in ${dir}`)
    return null
  }
  const { manifest, errors: manifestErrors } = parsePluginManifest(readFileSync(manifestPath, 'utf8'))
  for (const error of manifestErrors) errors.push(`${label}: ${error}`)
  return manifest
}

function listSubdirectories(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() || (entry.isSymbolicLink() && statSync(path.join(dir, entry.name)).isDirectory()))
    .map(entry => path.join(dir, entry.name))
    .sort()
}

function pluginsList(graphYaml: unknown): unknown[] {
  if (!isRecord(graphYaml)) return []
  return Array.isArray(graphYaml.plugins) ? graphYaml.plugins : []
}

/** `graph.yaml` `plugins:` entries with a `path` (standalone registrations). */
export function readStandalonePaths(graphYaml: unknown): string[] {
  return pluginsList(graphYaml)
    .filter((entry): entry is { path: string } => isRecord(entry) && typeof entry.path === 'string')
    .map(entry => entry.path)
}

/** `graph.yaml` `plugins:` entries with `id` + `enabled` (overrides). */
export function readPluginOverrides(graphYaml: unknown): PluginOverride[] {
  return pluginsList(graphYaml)
    .filter((entry): entry is { id: string; enabled: boolean } =>
      isRecord(entry) && typeof entry.id === 'string' && typeof entry.enabled === 'boolean')
    .map(entry => ({ id: entry.id, enabled: entry.enabled }))
}

/** Report `graph.yaml` `plugins:` entries that are neither `{ path }` nor `{ id, enabled }`. */
export function validatePluginsKey(graphYaml: unknown): string[] {
  if (!isRecord(graphYaml) || graphYaml.plugins === undefined) return []
  if (!Array.isArray(graphYaml.plugins)) return ['graph.yaml: plugins must be a list']
  const errors: string[] = []
  graphYaml.plugins.forEach((entry, index) => {
    const isPath = isRecord(entry) && typeof entry.path === 'string' && entry.id === undefined
    const isOverride = isRecord(entry) && typeof entry.id === 'string' && typeof entry.enabled === 'boolean' && entry.path === undefined
    if (!isPath && !isOverride) errors.push(`graph.yaml: plugins[${index}] must be { path } or { id, enabled }`)
  })
  return errors
}

/**
 * Plugin directories declared by packs: each pack's `pack.yaml` `plugins:` list
 * (paths relative to the pack). Pack dirs come from `graph.yaml` `templatePacks`.
 */
export function resolvePackPluginDirs(
  graphDir: string,
  graphYaml: unknown,
  errors: string[] = [],
): string[] {
  const packs = isRecord(graphYaml) && Array.isArray(graphYaml.templatePacks) ? graphYaml.templatePacks : []
  const dirs: string[] = []
  for (const pack of packs) {
    if (!isRecord(pack) || typeof pack.path !== 'string') continue
    const packDir = path.resolve(graphDir, pack.path)
    const packYamlPath = path.join(packDir, 'pack.yaml')
    if (!existsSync(packYamlPath)) continue
    let meta: unknown
    try {
      meta = parseYaml(readFileSync(packYamlPath, 'utf8'))
    } catch {
      continue
    }
    const plugins = isRecord(meta) && Array.isArray(meta.plugins) ? meta.plugins : []
    for (const rel of plugins) {
      if (typeof rel !== 'string' || !isSafeRelativePath(rel)) {
        errors.push(`pack ${packDir}: invalid plugins entry ${JSON.stringify(rel)}`)
        continue
      }
      dirs.push(path.resolve(packDir, ...rel.split('/')))
    }
  }
  return dirs
}

export function discoverPlugins(opts: DiscoverOptions): { plugins: DiscoveredPlugin[]; errors: string[] } {
  const errors: string[] = []
  const plugins: DiscoveredPlugin[] = []
  const byId = new Map<string, DiscoveredPlugin>()

  function add(manifest: PluginManifest | null, dir: string, origin: PluginOrigin): void {
    if (!manifest) return
    const existing = byId.get(manifest.id)
    if (existing) {
      const winner = existing.origin === 'builtin' ? 'built-in' : existing.origin
      errors.push(`duplicate plugin id "${manifest.id}" in ${dir}; keeping the ${winner} plugin at ${existing.dir}`)
      return
    }
    const plugin = { manifest, dir, origin }
    byId.set(manifest.id, plugin)
    plugins.push(plugin)
  }

  for (const parent of [opts.builtinDir, ...extraBuiltinDirsFromEnv()]) {
    for (const dir of listSubdirectories(parent)) {
      if (!existsSync(path.join(dir, 'plugin.yaml'))) continue
      add(readManifestFile(dir, `built-in plugin ${path.basename(dir)}`, errors), dir, 'builtin')
    }
  }

  for (const dir of opts.packPluginDirs) {
    add(readManifestFile(dir, `pack plugin ${dir}`, errors), dir, 'pack')
  }

  if (opts.graphDir !== null) {
    errors.push(...validatePluginsKey(opts.graphYaml))
    for (const rel of readStandalonePaths(opts.graphYaml)) {
      const dir = path.resolve(opts.graphDir, rel)
      add(readManifestFile(dir, `plugin ${rel}`, errors), dir, 'standalone')
    }
  }

  // Development plugins last: they replace pack/standalone plugins of the same id for this run.
  const devSeen = new Map<string, DiscoveredPlugin>()
  for (const rawDir of opts.devPluginDirs ?? []) {
    const dir = path.resolve(rawDir)
    const manifest = readManifestFile(dir, `development plugin ${dir}`, errors)
    if (!manifest) continue
    const earlierDev = devSeen.get(manifest.id)
    if (earlierDev) {
      const reason = `duplicate plugin id "${manifest.id}"; keeping the development plugin at ${earlierDev.dir}`
      errors.push(`development plugin ${dir}: ${reason}`)
      plugins.push({ manifest, dir, origin: 'dev', unavailableReason: reason })
      continue
    }
    const existing = byId.get(manifest.id)
    if (existing?.origin === 'builtin') {
      const reason = `cannot replace the built-in plugin "${manifest.id}"`
      errors.push(`development plugin ${dir}: ${reason}`)
      plugins.push({ manifest, dir, origin: 'dev', unavailableReason: reason })
      continue
    }
    const plugin: DiscoveredPlugin = { manifest, dir, origin: 'dev' }
    devSeen.set(manifest.id, plugin)
    if (existing) {
      errors.push(`warning: development plugin at ${dir} replaces ${existing.origin} plugin "${manifest.id}" at ${existing.dir} for this run`)
      existing.unavailableReason = `shadowed by development plugin at ${dir}`
      plugins.splice(plugins.indexOf(existing), 0, plugin)
    } else {
      plugins.push(plugin)
    }
    byId.set(manifest.id, plugin)
  }

  return { plugins, errors }
}

