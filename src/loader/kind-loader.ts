import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, KindDef } from '../schema/index.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'

/** Kinds are exact string identifiers, independent of node ID grammar. */
export function loadKinds(packContent: ContentMap, diagnostics: Diagnostic[]): Map<string, KindDef> {
  const kinds = new Map<string, KindDef>([['component', { label: 'Component' }]])
  for (const file of listYamlKeys(packContent, '').filter(key => key.endsWith('/kinds.yaml'))) {
    try {
      const raw = parseYaml(readYaml(packContent, file))
      const declared: unknown = raw?.kinds
      if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
        throw new Error("kinds.yaml must declare a 'kinds' map")
      }
      for (const [id, value] of Object.entries(declared)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || typeof value.label !== 'string' || !value.label.trim()
          || (value.templates !== undefined && (!Array.isArray(value.templates)
            || !value.templates.every((entry: unknown) => typeof entry === 'string')))) {
          diagnostics.push({ severity: 'error', file, message: `invalid kind '${id}': expected a label string and optional templates string list` })
          continue
        }
        const def: KindDef = {
          label: value.label,
          ...(value.templates !== undefined ? { templates: [...new Set<string>(value.templates)].sort() } : {}),
        }
        const existing = kinds.get(id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(def)) {
          diagnostics.push({ severity: 'error', file, message: `kind '${id}' has conflicting definitions — keeping the existing definition` })
        } else if (!existing) {
          kinds.set(id, def)
        }
      }
    } catch (err) {
      diagnostics.push({ severity: 'error', file, message: `invalid kinds.yaml: ${err}` })
    }
  }
  return kinds
}

/** Unknown kinds retain their exact id as their generic display label. */
export function getKindLabel(kinds: ReadonlyMap<string, KindDef> | undefined, kind: string): string {
  return kinds?.get(kind)?.label ?? (kind === 'component' ? 'Component' : kind)
}
