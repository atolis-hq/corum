import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, KindDef } from '../schema/index.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'

export const DEFAULT_KIND = 'component'

/** The built-in registry: only the default kind, regardless of packs. */
export function builtinKinds(): Map<string, KindDef> {
  return new Map([[DEFAULT_KIND, { id: DEFAULT_KIND, label: 'Component' }]])
}

function sameKind(a: KindDef, b: KindDef): boolean {
  return a.label === b.label && JSON.stringify(a.templates ?? null) === JSON.stringify(b.templates ?? null)
}

/**
 * Build the kind registry: the built-in default plus any `kinds.yaml` declared
 * by loaded packs. Conflicting redeclarations are errors (first kept);
 * identical redeclarations are accepted. Malformed files never abort loading.
 */
export function loadKinds(packContent: ContentMap, diagnostics: Diagnostic[]): Map<string, KindDef> {
  const kinds = builtinKinds()
  const keys = listYamlKeys(packContent, '').filter(key => key === 'kinds.yaml' || key.endsWith('/kinds.yaml'))
  for (const key of keys) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(packContent, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }
    const declared = (raw as { kinds?: unknown } | null)?.kinds
    if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
      diagnostics.push({ severity: 'error', file: key, message: `kinds.yaml must declare a 'kinds' map` })
      continue
    }
    for (const [id, defRaw] of Object.entries(declared as Record<string, unknown>)) {
      if (typeof defRaw !== 'object' || defRaw === null || Array.isArray(defRaw)) {
        diagnostics.push({ severity: 'error', file: key, message: `kind '${id}' must be an object` })
        continue
      }
      const def = defRaw as Record<string, unknown>
      if (typeof def.label !== 'string' || def.label.trim() === '') {
        diagnostics.push({ severity: 'error', file: key, message: `kind '${id}' must have a non-empty string 'label'` })
        continue
      }
      let templates: string[] | undefined
      if (def.templates !== undefined) {
        if (!Array.isArray(def.templates) || !def.templates.every(t => typeof t === 'string')) {
          diagnostics.push({ severity: 'error', file: key, message: `kind '${id}' templates must be a list of strings` })
          continue
        }
        templates = def.templates as string[]
      }
      const kind: KindDef = { id, label: def.label, ...(templates && { templates }) }
      const existing = kinds.get(id)
      if (existing) {
        if (!sameKind(existing, kind)) {
          diagnostics.push({ severity: 'error', file: key, message: `kind '${id}' is already declared with a different definition` })
        }
        continue
      }
      kinds.set(id, kind)
    }
  }
  return kinds
}
