import type { EdgeType, Stability, State } from '../schema/index.js'

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

export const VALID_EDGE_TYPES = [
  'triggers',
  'produces',
  'reads',
  'calls',
  'implements',
  'maps-to',
  'derived-from',
  'renamed-from',
  'has-field',
  'has-value',
] as const satisfies readonly EdgeType[]

export const VALID_STATE_SET = new Set<string>(VALID_STATES)
export const VALID_STABILITY_SET = new Set<string>(VALID_STABILITIES)
export const VALID_EDGE_TYPE_SET = new Set<string>(VALID_EDGE_TYPES)

export const STRUCTURAL_EDGE_BY_ITEM_TEMPLATE: Partial<Record<string, EdgeType>> = {
  Field: 'has-field',
  EnumValue: 'has-value',
}
