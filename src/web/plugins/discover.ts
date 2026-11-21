import { createHash } from 'node:crypto'
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
  /** Development plugins only: fingerprint of the directory contents, so the browser can detect edits. */
  revision?: string
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
  errors.push(...mergeDevPlugins(plugins, opts.devPluginDirs ?? []))

  return { plugins, errors }
}

const REVISION_FILE_CAP = 5000

/** Fingerprint of a directory's files (paths, sizes, mtimes); changes when any file is edited. */
export function directoryRevision(root: string): string {
  const hash = createHash('sha256')
  let seen = 0
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)) } catch { return }
    for (const entry of entries) {
      if (seen >= REVISION_FILE_CAP) return
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      try {
        const info = statSync(file)
        seen++
        hash.update(`${path.relative(root, file)}\0${info.size}\0${info.mtimeMs}\n`)
      } catch { /* vanished mid-walk */ }
    }
  }
  walk(root)
  return hash.digest('hex').slice(0, 16)
}

/**
 * Merge unpacked development plugins (`--plugin-dir`) into `plugins` in place. A development
 * plugin replaces a pack/standalone plugin with the same id for this run (the replaced one gets an
 * `unavailableReason`), cannot replace a built-in, and the first of two development plugins with
 * one id wins. Returns warnings and errors for the caller to log. Mutates the given plugin objects,
 * so pass copies when the originals are shared.
 */
export function mergeDevPlugins(plugins: DiscoveredPlugin[], devDirs: string[]): string[] {
  const messages: string[] = []
  const devSeen = new Map<string, DiscoveredPlugin>()
  for (const rawDir of devDirs) {
    const dir = path.resolve(rawDir)
    const manifest = readManifestFile(dir, `development plugin ${dir}`, messages)
    if (!manifest) continue
    const revision = directoryRevision(dir)
    const earlierDev = devSeen.get(manifest.id)
    if (earlierDev) {
      const reason = `duplicate plugin id "${manifest.id}"; keeping the development plugin at ${earlierDev.dir}`
      messages.push(`development plugin ${dir}: ${reason}`)
      plugins.push({ manifest, dir, origin: 'dev', revision, unavailableReason: reason })
      continue
    }
    const existing = plugins.find(plugin => plugin.manifest.id === manifest.id && plugin.unavailableReason === undefined)
    if (existing?.origin === 'builtin') {
      const reason = `cannot replace the built-in plugin "${manifest.id}"`
      messages.push(`development plugin ${dir}: ${reason}`)
      plugins.push({ manifest, dir, origin: 'dev', revision, unavailableReason: reason })
      continue
    }
    const plugin: DiscoveredPlugin = { manifest, dir, origin: 'dev', revision }
    devSeen.set(manifest.id, plugin)
    if (existing) {
      messages.push(`warning: development plugin at ${dir} replaces ${existing.origin} plugin "${manifest.id}" at ${existing.dir} for this run`)
      existing.unavailableReason = `shadowed by development plugin at ${dir}`
      plugins.splice(plugins.indexOf(existing), 0, plugin)
    } else {
      plugins.push(plugin)
    }
  }
  return messages
}

