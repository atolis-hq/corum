import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic, Template } from '../schema/index.js'

const RESERVED_TEMPLATE_KEYS = new Set([
  'name', 'version', 'core', 'abstract', 'extends',
  'description', 'properties', 'edge-types', 'ui',
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

export async function loadPacks(
  packDirs: string[],
  diagnostics: Diagnostic[],
): Promise<Map<string, Template>> {
  const templates = new Map<string, Template>()
  let base: Template | undefined

  for (const packDir of packDirs) {
    const templatesDir = path.join(packDir, 'templates')
    if (!existsSync(templatesDir)) {
      diagnostics.push({
        severity: 'warning',
        file: templatesDir,
        message: `templates directory not found in pack: ${packDir}`,
      })
      continue
    }

    const files = readdirSync(templatesDir).filter(file => file.endsWith('.yaml'))
    for (const file of files) {
      const filePath = path.join(templatesDir, file)
      let raw: unknown
      try {
        raw = parseYaml(readFileSync(filePath, 'utf-8'))
      } catch (err) {
        diagnostics.push({ severity: 'error', file: filePath, message: `failed to parse YAML: ${err}` })
        continue
      }

      const templateRecord = raw as Record<string, unknown>
      if (typeof templateRecord.name !== 'string' || typeof templateRecord.version !== 'string') {
        diagnostics.push({ severity: 'error', file: filePath, message: 'template missing required name or version' })
        continue
      }

      const template = templateRecord as Template
      if (template.name === 'base') {
        base = template
      } else {
        templates.set(template.name, template)
      }
    }
  }

  if (base) {
    for (const template of templates.values()) {
      inheritNonReserved(template, base)
    }
  }

  for (const template of templates.values()) {
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
