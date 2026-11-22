import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { BUILTIN_PLUGIN_DIR } from '../web/plugins/builtin-dir.js'
import { discoverPlugins } from '../web/plugins/discover.js'
import { parsePluginManifest } from '../web/plugins/manifest.js'
import { resolvePluginStatuses } from '../web/plugins/status.js'
import { sanitiseThemeCss } from '../web/plugins/themes.js'
import { sanitiseLayoutCss } from '../web/plugins/layouts.js'
import { lintPluginStyles } from './style-lints.js'

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
  // Same discovery as `corum web --plugin-dir`, including the built-ins a development plugin cannot replace.
  const { plugins } = discoverPlugins({
    builtinDir: BUILTIN_PLUGIN_DIR, graphDir: null, graphYaml: null, packPluginDirs: [], devPluginDirs: [root],
  })
  for (const status of resolvePluginStatuses(plugins, { graphTemplates, corumVersion, overrides: [] })) {
    if (status.origin === 'dev' && status.status === 'unavailable') errors.push(`${root}: ${status.reason ?? 'unavailable'}`)
  }

  if (!existsSync(path.join(root, ...parsed.manifest.main.split('/')))) {
    warnings.push(`${root}: main "${parsed.manifest.main}" does not exist`)
  }
  for (const theme of parsed.manifest.contributes.themes) {
    const file = path.join(root, ...theme.css.split('/'))
    if (!existsSync(file) || !statSync(file).isFile()) {
      errors.push(`${root}: theme "${theme.id}": css "${theme.css}" does not exist`)
      continue
    }
    const checked = sanitiseThemeCss(readFileSync(file, 'utf8'))
    for (const message of checked.errors) errors.push(`${file}: theme "${theme.id}": ${message}`)
    for (const message of checked.warnings) warnings.push(`${file}: theme "${theme.id}": ${message}`)
  }
  for (const layout of parsed.manifest.contributes.layouts) {
    const file = path.join(root, ...layout.css.split('/'))
    if (!existsSync(file) || !statSync(file).isFile()) {
      errors.push(`${root}: layout "${layout.id}": css "${layout.css}" does not exist`)
      continue
    }
    const checked = sanitiseLayoutCss(layout.id, readFileSync(file, 'utf8'))
    for (const message of checked.errors) errors.push(`${file}: layout "${layout.id}": ${message}`)
    for (const message of checked.warnings) warnings.push(`${file}: layout "${layout.id}": ${message}`)
  }
  warnings.push(...lintPluginStyles(root, parsed.manifest.contributes.themes.map(theme => theme.css)))
  return { exitCode: errors.length > 0 ? 1 : 0, errors, warnings }
}
