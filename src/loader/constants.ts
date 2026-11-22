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
  'triggers': { name: 'triggers', category: 'semantic', colour: '#b45309' },
  'produces': { name: 'produces', category: 'semantic', colour: '#0f766e' },
  'reads': { name: 'reads', category: 'semantic', traversal: 'outbound-only', colour: '#1d4ed8' },
  'uses-type': { name: 'uses-type', category: 'semantic', traversal: 'outbound-only', colour: '#0891b2' },
  'calls': { name: 'calls', category: 'semantic', colour: '#6d28d9' },
  'implements': { name: 'implements', category: 'semantic', colour: '#475569' },
  'maps-to': { name: 'maps-to', category: 'lineage', colour: '#be185d' },
  'derived-from': { name: 'derived-from', category: 'lineage', colour: '#6b7280', line: { dash: '5 5' } },
  'renamed-from': { name: 'renamed-from', category: 'lineage', hidden: true },
  'has-field': { name: 'has-field', category: 'structural' },
  'has-value': { name: 'has-value', category: 'structural' },
}

export const CORE_EDGE_TYPE_MAP: ReadonlyMap<string, EdgeTypeDef> = new Map(Object.entries(CORE_EDGE_TYPES))

export const VALID_EDGE_TYPES: readonly EdgeType[] = Object.keys(CORE_EDGE_TYPES)

export const VALID_STATE_SET = new Set<string>(VALID_STATES)
export const VALID_STABILITY_SET = new Set<string>(VALID_STABILITIES)
export const VALID_EDGE_TYPE_SET = new Set<string>(VALID_EDGE_TYPES)
