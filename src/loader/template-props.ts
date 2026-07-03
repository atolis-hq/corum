/**
 * Shared helper for resolving a template's flattened property-schema map.
 *
 * Templates express inheritance via nested `allOf` (see ADR-008): a
 * template's `properties` block is either a plain JSON-schema-like object
 * with a `properties` map, or an `allOf` array of such objects (accumulated
 * from `extends` resolution at pack-load time). This walks that structure
 * and merges all declared properties into a single flat map, keyed by
 * property name.
 *
 * Used by both the cluster loader (to find node-ref targets) and the linter
 * (to validate node properties against their owning template's schema).
 */
export function getPropertySchemasFromTemplate(
  props: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  if (Array.isArray(props.allOf)) {
    const merged: Record<string, Record<string, unknown>> = {}
    for (const schema of props.allOf) {
      Object.assign(merged, getPropertySchemasFromTemplate(schema as Record<string, unknown>))
    }
    return merged
  }
  if (typeof props.properties === 'object' && props.properties !== null) {
    return props.properties as Record<string, Record<string, unknown>>
  }
  return {}
}

export interface TemplateSchema {
  properties: Record<string, Record<string, unknown>>
  required: Set<string>
  /** False only when some level of the `allOf` chain declares `additionalProperties: false`. */
  additionalProperties: boolean
}

/**
 * Merge a template's `properties` block (including its `allOf` inheritance
 * chain) into a flat schema view: the combined property map, the union of
 * all `required` lists, and whether unknown properties are disallowed
 * anywhere in the chain. Used by the linter for shallow property validation.
 */
export function getTemplateSchema(templateProperties: unknown): TemplateSchema {
  const properties: Record<string, Record<string, unknown>> = {}
  const required = new Set<string>()
  let additionalProperties = true

  const walk = (props: unknown): void => {
    if (typeof props !== 'object' || props === null) return
    const record = props as Record<string, unknown>
    if (Array.isArray(record.allOf)) {
      for (const schema of record.allOf) walk(schema)
      return
    }
    if (typeof record.properties === 'object' && record.properties !== null) {
      Object.assign(properties, record.properties as Record<string, Record<string, unknown>>)
    }
    if (Array.isArray(record.required)) {
      for (const name of record.required) {
        if (typeof name === 'string') required.add(name)
      }
    }
    if (record.additionalProperties === false) additionalProperties = false
  }
  walk(templateProperties)

  return { properties, required, additionalProperties }
}
