import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { discoverPlugins } from '../web/plugins/discover.js'
import { parsePluginManifest } from '../web/plugins/manifest.js'
import { resolvePluginStatuses } from '../web/plugins/status.js'

export type ValidationResult = {
  /** 0 valid, 1 plugin errors, 2 setup failure. */
  exitCode: 0 | 1 | 2
  errors: string[]
  warnings: string[]
}

/** Check a plugin directory with the server's own manifest, engine and template rules. */
export function validatePluginDir(dir: string, graphTemplates: Set<string>, corumVersion: string): ValidationResult {
  const root = path.resolve(dir)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { exitCode: 2, errors: [`${root}: directory not found`], warnings: [] }
  }
  const manifestPath = path.join(root, 'plugin.yaml')
  if (!existsSync(manifestPath)) {
    return { exitCode: 2, errors: [`${root}: no plugin.yaml found`], warnings: [] }
  }

  const parsed = parsePluginManifest(readFileSync(manifestPath, 'utf8'))
  if (parsed.errors.length > 0 || !parsed.manifest) {
    return { exitCode: 1, errors: parsed.errors.map(error => `${manifestPath}: ${error}`), warnings: [] }
  }

  const errors: string[] = []
  const warnings: string[] = []
  const { plugins, errors: discoverErrors } = discoverPlugins({
    builtinDir: path.join(root, '.no-builtin'), graphDir: null, graphYaml: null, packPluginDirs: [], devPluginDirs: [root],
  })
  errors.push(...discoverErrors.filter(message => !message.startsWith('warning:')).map(message => `${root}: ${message}`))
  for (const status of resolvePluginStatuses(plugins, { graphTemplates, corumVersion, overrides: [] })) {
    if (status.status === 'unavailable') errors.push(`${root}: ${status.reason ?? 'unavailable'}`)
  }

  if (!existsSync(path.join(root, ...parsed.manifest.main.split('/')))) {
    warnings.push(`${root}: main "${parsed.manifest.main}" does not exist`)
  }
  return { exitCode: errors.length > 0 ? 1 : 0, errors, warnings }
}
