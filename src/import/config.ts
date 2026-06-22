import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

export type FieldStrategy =
  | { strategy: 'channel-segment'; separator: string; segment: number }
  | { strategy: 'channel-pattern'; pattern: string }
  | { strategy: 'name-segment'; separator: string; segment: number }
  | { strategy: 'name-pattern'; pattern: string }
  | { strategy: 'tag' }
  | { strategy: 'hardcoded'; value: string }

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
  componentMapping: FieldStrategy
  messageNaming?: FieldStrategy
  eventClassification?:
    | { strategy: 'always-integration' }
    | { strategy: 'always-domain' }
    | { from: FieldStrategy; domainValue: string }
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

export function buildAsyncAPIConfig(
  spec: string,
  strategy: string,
  opts: { separator?: string; segment?: number; pattern?: string; value?: string } = {},
): AsyncAPIImportEntry {
  let componentMapping: FieldStrategy
  if (strategy === 'hardcoded') {
    if (!opts.value) throw new Error('--component required for hardcoded strategy')
    componentMapping = { strategy: 'hardcoded', value: opts.value }
  } else if (strategy === 'tag') {
    componentMapping = { strategy: 'tag' }
  } else if (strategy === 'channel-pattern') {
    componentMapping = { strategy: 'channel-pattern', pattern: opts.pattern ?? '' }
  } else if (strategy === 'name-pattern') {
    componentMapping = { strategy: 'name-pattern', pattern: opts.pattern ?? '' }
  } else if (strategy === 'name-segment') {
    componentMapping = { strategy: 'name-segment', separator: opts.separator ?? '.', segment: opts.segment ?? 0 }
  } else {
    componentMapping = { strategy: 'channel-segment', separator: opts.separator ?? '.', segment: opts.segment ?? 0 }
  }
  return { adapter: 'asyncapi', spec, componentMapping }
}
