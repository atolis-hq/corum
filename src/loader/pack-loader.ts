import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Template } from '../schema/index.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'

function topoSortTemplates(templates: Map<string, Template>): Template[] {
  const sorted: Template[] = []
  const visited = new Set<string>()
  function visit(name: string): void {
    if (visited.has(name)) return
    visited.add(name)
    const t = templates.get(name)
    if (!t) return
    if (t.extends) visit(t.extends)
    sorted.push(t)
  }
  for (const name of templates.keys()) visit(name)
  return sorted
}

const RESERVED_TEMPLATE_KEYS = new Set([
  'name', 'info', 'extends', 'properties', 'edge-types', 'ui',
])

export function getOwnedSections(template: Template): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(template)) {
    if (
      !RESERVED_TEMPLATE_KEYS.has(key) &&
      typeof value === 'object' &&
      value !== null &&
      'item-template' in value &&
      typeof (value as Record<string, unknown>)['item-template'] === 'string'
    ) {
      result[key] = (value as Record<string, string>)['item-template']
    }
  }
  return result
}

export function loadPacks(
  content: ContentMap,
  diagnostics: Diagnostic[],
): Map<string, Template> {
  const templates = new Map<string, Template>()
  let base: Template | undefined

  const templateKeys = listYamlKeys(content, '').filter(key => key.includes('/templates/'))

  for (const key of templateKeys) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(content, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }

    const templateRecord = raw as Record<string, unknown>
    const info = typeof templateRecord.info === 'object' && templateRecord.info !== null
      ? templateRecord.info as Record<string, unknown>
      : null

    if (typeof templateRecord.name !== 'string' || typeof info?.version !== 'string') {
      diagnostics.push({ severity: 'error', file: key, message: 'template missing required name or info.version' })
      continue
    }

    const template = templateRecord as Template
    if (template.name === 'base') {
      base = template
    } else {
      templates.set(template.name, template)
    }
  }

  if (base) {
    for (const template of templates.values()) {
      inheritNonReserved(template, base)
    }
  }

  for (const template of topoSortTemplates(templates)) {
    if (!template.extends) continue

    const parent = templates.get(template.extends)
    if (!parent) {
      diagnostics.push({
        severity: 'error',
        file: `template:${template.name}`,
        message: `extends references unknown template: ${template.extends}`,
      })
      continue
    }

    if (parent.properties && template.properties) {
      template.properties = { allOf: [parent.properties, template.properties] }
    } else if (parent.properties) {
      template.properties = parent.properties
    }
    inheritNonReserved(template, parent)
  }

  return templates
}

function inheritNonReserved(template: Template, parent: Template): void {
  for (const [key, value] of Object.entries(parent)) {
    if (!RESERVED_TEMPLATE_KEYS.has(key) && !(key in template)) {
      template[key] = value
    }
  }
}
