import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, EdgeCategory, EdgeTypeDef } from '../schema/index.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'
import { CORE_EDGE_TYPES } from './constants.js'

const VALID_CATEGORIES = new Set<string>(['structural', 'semantic', 'lineage'])

/** Edge type names appear inside edge ids ({from}__{type}__{to}). */
const EDGE_TYPE_NAME_RE = /^[a-z][a-z0-9-]*$/

/**
 * Build the edge type vocabulary: core definitions plus any `edge-types.yaml`
 * declared by loaded packs. Core definitions cannot be overridden; collisions
 * between packs keep the first definition with a warning.
 */
export function loadEdgeTypes(
  packContent: ContentMap,
  diagnostics: Diagnostic[],
): Map<string, EdgeTypeDef> {
  const edgeTypes = new Map<string, EdgeTypeDef>(Object.entries(CORE_EDGE_TYPES))

  const keys = listYamlKeys(packContent, '').filter(key => key.endsWith('/edge-types.yaml'))
  for (const key of keys) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(packContent, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }

    const declared = (raw as { 'edge-types'?: unknown })?.['edge-types']
    if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
      diagnostics.push({ severity: 'error', file: key, message: `edge-types.yaml must declare an 'edge-types' map` })
      continue
    }

    for (const [name, defRaw] of Object.entries(declared as Record<string, unknown>)) {
      if (!EDGE_TYPE_NAME_RE.test(name)) {
        diagnostics.push({
          severity: 'error',
          file: key,
          message: `invalid edge type name '${name}': must match ${EDGE_TYPE_NAME_RE}`,
        })
        continue
      }
      if (typeof defRaw !== 'object' || defRaw === null) {
        diagnostics.push({ severity: 'error', file: key, message: `edge type '${name}' must be an object` })
        continue
      }
      const def = defRaw as Record<string, unknown>
      if (typeof def.category !== 'string' || !VALID_CATEGORIES.has(def.category)) {
        diagnostics.push({
          severity: 'error',
          file: key,
          message: `edge type '${name}' has invalid category '${String(def.category)}': expected structural, semantic, or lineage`,
        })
        continue
      }

      const existing = edgeTypes.get(name)
      if (existing) {
        diagnostics.push({
          severity: 'warning',
          file: key,
          message: `edge type '${name}' is already declared${name in CORE_EDGE_TYPES ? ' by core' : ''} — keeping the existing definition`,
        })
        continue
      }

      edgeTypes.set(name, {
        name,
        category: def.category as EdgeCategory,
        ...(typeof def.description === 'string' && { description: def.description }),
        ...(typeof def.properties === 'object' && def.properties !== null && {
          properties: def.properties as Record<string, unknown>,
        }),
        ...(def.hidden === true && { hidden: true }),
      })
    }
  }

  return edgeTypes
}
