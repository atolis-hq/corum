import semver from 'semver'
import type { DiscoveredPlugin, PluginOrigin } from './discover.js'
import type { PluginManifest } from './manifest.js'

export type PluginStatusValue = 'enabled' | 'disabled' | 'unavailable'

export type PluginStatus = {
  id: string
  name?: string
  origin: PluginOrigin
  version: string
  status: PluginStatusValue
  reason?: string
  manifest: PluginManifest
}

export type StatusContext = {
  graphTemplates: Set<string>
  corumVersion: string
  overrides: { id: string; enabled: boolean }[]
}

function evaluate(plugin: DiscoveredPlugin, ctx: StatusContext): { status: PluginStatusValue; reason?: string } {
  const { manifest } = plugin
  if (ctx.overrides.some(override => override.id === manifest.id && !override.enabled)) {
    return { status: 'disabled' }
  }

  if (plugin.unavailableReason !== undefined) return { status: 'unavailable', reason: plugin.unavailableReason }

  const range = manifest.engines.corum
  if (semver.validRange(range) === null) {
    return { status: 'unavailable', reason: `engines.corum "${range}" is not a valid semver range` }
  }
  if (!semver.satisfies(ctx.corumVersion, range, { includePrerelease: true })) {
    return { status: 'unavailable', reason: `requires Corum ${range}; running ${ctx.corumVersion}` }
  }

  const missing = manifest.requires.templates.filter(name => !ctx.graphTemplates.has(name))
  if (missing.length > 0) {
    return { status: 'unavailable', reason: `missing templates: ${missing.join(', ')}` }
  }

  return { status: 'enabled' }
}

export function resolvePluginStatuses(plugins: DiscoveredPlugin[], ctx: StatusContext): PluginStatus[] {
  return plugins.map(plugin => {
    const { status, reason } = evaluate(plugin, ctx)
    const result: PluginStatus = {
      id: plugin.manifest.id,
      origin: plugin.origin,
      version: plugin.manifest.version,
      status,
      manifest: plugin.manifest,
    }
    if (reason !== undefined) result.reason = reason
    return result
  })
}
