import type { EdgeType, EdgeTypeDef, Stability, State } from '../schema/index.js'

export const VALID_STATES = [
  'draft',
  'proposed',
  'agreed',
  'future',
  'removed',
  'implemented',
] as const satisfies readonly State[]

export const VALID_STABILITIES = [
  'unstable',
  'stable',
  'deprecated',
] as const satisfies readonly Stability[]

/**
 * Core edge type definitions — the single declaration of the built-in
 * vocabulary and its semantic categories. Packs extend this set via
 * `edge-types.yaml` (see loader/edge-type-loader.ts).
 */
export const CORE_EDGE_TYPES: Record<string, EdgeTypeDef> = {
  'triggers': { name: 'triggers', category: 'semantic' },
  'produces': { name: 'produces', category: 'semantic' },
  'reads': { name: 'reads', category: 'semantic' },
  'uses-type': { name: 'uses-type', category: 'semantic' },
  'calls': { name: 'calls', category: 'semantic' },
  'implements': { name: 'implements', category: 'semantic' },
  'maps-to': { name: 'maps-to', category: 'lineage' },
  'derived-from': { name: 'derived-from', category: 'lineage' },
  'renamed-from': { name: 'renamed-from', category: 'lineage', hidden: true },
  'has-field': { name: 'has-field', category: 'structural' },
  'has-value': { name: 'has-value', category: 'structural' },
}

export const CORE_EDGE_TYPE_MAP: ReadonlyMap<string, EdgeTypeDef> = new Map(Object.entries(CORE_EDGE_TYPES))

export const VALID_EDGE_TYPES: readonly EdgeType[] = Object.keys(CORE_EDGE_TYPES)

export const VALID_STATE_SET = new Set<string>(VALID_STATES)
export const VALID_STABILITY_SET = new Set<string>(VALID_STABILITIES)
export const VALID_EDGE_TYPE_SET = new Set<string>(VALID_EDGE_TYPES)
