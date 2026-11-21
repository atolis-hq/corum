import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Graph } from '../../schema/index.js'
import { discoverPlugins, readPluginOverrides, resolvePackPluginDirs } from './discover.js'
import { resolvePluginStatuses, type PluginStatus } from './status.js'

export type PluginRuntimeOptions = {
  graph: Graph
  /** Graph directory for file sources; null for git sources (built-ins only). */
  graphDir: string | null
  builtinDir: string
  corumVersion: string
  logger?: (message: string) => void
}

export type PluginRuntime = {
  /** Re-discover plugins and recompute statuses against the current graph. */
  refresh(): void
  /** Statuses for the API: no filesystem paths. */
  statuses(): PluginStatus[]
  /** Directory of an enabled plugin, or null (unknown, disabled or unavailable). */
  enabledDir(id: string): string | null
  /** Directories of registered standalone plugins, for the file watcher (their manifests). */
  watchDirs(): string[]
}

function readGraphYaml(graphDir: string | null): unknown {
  if (graphDir === null) return null
  const graphYamlPath = path.join(graphDir, 'graph.yaml')
  if (!existsSync(graphYamlPath)) return null
  try {
    return parseYaml(readFileSync(graphYamlPath, 'utf8'))
  } catch {
    return null
  }
}

export function createPluginRuntime(options: PluginRuntimeOptions): PluginRuntime {
  let current: PluginStatus[] = []
  let dirs = new Map<string, string>()
  let standaloneDirs: string[] = []
  let lastErrors = ''

  function refresh(): void {
    const graphYaml = readGraphYaml(options.graphDir)
    const errors: string[] = []
    const packPluginDirs = options.graphDir === null ? [] : resolvePackPluginDirs(options.graphDir, graphYaml, errors)
    const discovered = discoverPlugins({
      builtinDir: options.builtinDir,
      graphDir: options.graphDir,
      graphYaml,
      packPluginDirs,
    })
    errors.push(...discovered.errors)

    current = resolvePluginStatuses(discovered.plugins, {
      graphTemplates: new Set(options.graph.templates.keys()),
      corumVersion: options.corumVersion,
      overrides: options.graphDir === null ? [] : readPluginOverrides(graphYaml),
    })
    dirs = new Map(discovered.plugins.map(plugin => [plugin.manifest.id, plugin.dir]))
    standaloneDirs = discovered.plugins.filter(plugin => plugin.origin === 'standalone').map(plugin => plugin.dir)

    const signature = errors.join('\n')
    if (signature !== lastErrors) {
      lastErrors = signature
      for (const error of errors) options.logger?.(`[corum] plugin: ${error}`)
    }
  }

  refresh()

  return {
    refresh,
    statuses: () => current,
    enabledDir(id) {
      const status = current.find(entry => entry.id === id)
      return status?.status === 'enabled' ? dirs.get(id) ?? null : null
    },
    watchDirs: () => standaloneDirs,
  }
}
