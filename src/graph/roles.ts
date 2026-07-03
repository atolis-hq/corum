import type { Template } from '../schema/index.js'

/**
 * Template roles — the capability contract between packs and the engine.
 *
 * A template declares `info.role` to opt into privileged engine behaviour
 * (schema collapse, field-level lineage, structural classification). Roles
 * resolve through the `extends` chain, so `AvroSchema extends Schema`
 * inherits Schema's `type-container` role without engine changes.
 *
 * Known roles:
 * - `field`          — atomic, independently-addressable property; unit of field-level lineage
 * - `value`          — enum constant
 * - `type-container` — object-shaped contract owning fields (Schema)
 * - `enum-container` — enumerated type owning values (EnumDefinition)
 * - `mapping`        — keyed collection type (Mapping)
 */
export type TemplateRole = 'field' | 'value' | 'type-container' | 'enum-container' | 'mapping'

const STRUCTURAL_ROLES = new Set<string>(['field', 'value', 'type-container', 'enum-container', 'mapping'])
const DATA_ROLES = new Set<string>(['type-container', 'enum-container'])

/** Resolve a template's role, walking the extends chain (nearest declaration wins). */
export function getTemplateRole(templates: Map<string, Template>, templateName: string): string | undefined {
  const seen = new Set<string>()
  let current = templates.get(templateName)
  while (current && !seen.has(current.name)) {
    seen.add(current.name)
    const role = current.info?.role
    if (typeof role === 'string') return role
    current = current.extends ? templates.get(current.extends) : undefined
  }
  return undefined
}

export function templateHasRole(templates: Map<string, Template>, templateName: string, role: string): boolean {
  return getTemplateRole(templates, templateName) === role
}

export interface EdgeTypeConstraints {
  outgoing?: string[]
  incoming?: string[]
  supports?: string[]
}

/**
 * Resolve a template's declared `edge-types` constraints, walking the
 * `extends` chain (nearest declaration wins, matching getTemplateRole).
 * Returns undefined when neither the template nor any ancestor declares an
 * `edge-types` block — such templates are unconstrained for edge endpoint
 * linting purposes.
 */
export function getEdgeTypeConstraints(
  templates: Map<string, Template>,
  templateName: string,
): EdgeTypeConstraints | undefined {
  const seen = new Set<string>()
  let current = templates.get(templateName)
  while (current && !seen.has(current.name)) {
    seen.add(current.name)
    const declared = current['edge-types']
    if (declared) return declared
    current = current.extends ? templates.get(current.extends) : undefined
  }
  return undefined
}

const structuralCache = new WeakMap<Map<string, Template>, Set<string>>()
const dataCache = new WeakMap<Map<string, Template>, Set<string>>()

/** Templates whose nodes are materialised structural children (hidden from top-level listings). */
export function getStructuralTemplates(templates: Map<string, Template>): Set<string> {
  let cached = structuralCache.get(templates)
  if (!cached) {
    cached = collectByRoles(templates, STRUCTURAL_ROLES)
    structuralCache.set(templates, cached)
  }
  return cached
}

/** Templates representing shared data types whose children are expanded in cluster views. */
export function getDataTemplates(templates: Map<string, Template>): Set<string> {
  let cached = dataCache.get(templates)
  if (!cached) {
    cached = collectByRoles(templates, DATA_ROLES)
    dataCache.set(templates, cached)
  }
  return cached
}

function collectByRoles(templates: Map<string, Template>, roles: ReadonlySet<string>): Set<string> {
  const result = new Set<string>()
  for (const name of templates.keys()) {
    const role = getTemplateRole(templates, name)
    if (role !== undefined && roles.has(role)) result.add(name)
  }
  return result
}
