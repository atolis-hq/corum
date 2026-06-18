import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

export type ComponentMapping =
  | { strategy: 'uri-segment'; segment: number }
  | { strategy: 'uri-segment'; pattern: string }
  | { strategy: 'tag' }
  | { strategy: 'hardcoded'; component: string }

export interface OpenAPIImportEntry {
  adapter: 'openapi'
  spec: string
  componentMapping: ComponentMapping
}

export interface AsyncAPIImportEntry {
  adapter: 'asyncapi'
  spec: string
  componentMapping:
    | { strategy: 'channel' }
    | { strategy: 'hardcoded'; component: string }
}

export type ImportEntry = OpenAPIImportEntry | AsyncAPIImportEntry

export interface ImportConfig {
  imports: ImportEntry[]
}

export function loadImportConfig(filePath: string): ImportConfig {
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    throw new Error(`Failed to parse import config: ${err}`)
  }
  if (!isImportConfig(raw)) {
    throw new Error(`Invalid import config: must have an "imports" array`)
  }
  return raw
}

function isImportConfig(value: unknown): value is ImportConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'imports' in value &&
    Array.isArray((value as Record<string, unknown>).imports)
  )
}

export function buildOpenAPIConfig(
  spec: string,
  strategy: string,
  segment?: number,
  pattern?: string,
  component?: string,
): OpenAPIImportEntry {
  let componentMapping: ComponentMapping
  if (strategy === 'hardcoded') {
    if (!component) throw new Error('--component required for hardcoded strategy')
    componentMapping = { strategy: 'hardcoded', component }
  } else if (strategy === 'tag') {
    componentMapping = { strategy: 'tag' }
  } else if (pattern) {
    componentMapping = { strategy: 'uri-segment', pattern }
  } else {
    componentMapping = { strategy: 'uri-segment', segment: segment ?? 0 }
  }
  return { adapter: 'openapi', spec, componentMapping }
}
