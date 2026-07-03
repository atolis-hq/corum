import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

export interface ComponentNameReplacement {
  from: string
  to: string
}

export interface DeduplicationRule {
  primary: string
  secondary: string
}

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
  includeConsumed?: boolean
}

export interface CorumImportEntry {
  adapter: 'corum'
  spec: string
}

export type ImportEntry = OpenAPIImportEntry | AsyncAPIImportEntry | CorumImportEntry

export type EdgeCasingMode = 'preserve' | 'match'

export interface ImportConfig {
  componentNameReplacements?: ComponentNameReplacement[]
  deduplication?: DeduplicationRule[]
  /**
   * How to resolve an edge endpoint that fails an exact match against the
   * final merged node set. 'preserve' (default) leaves it untouched — it
   * surfaces as an "unresolved node" diagnostic at load time, as today.
   * 'match' retries case-insensitively and rewrites to the exact surviving
   * casing when the match is unambiguous — fixes cross-source field-casing
   * drift (e.g. a secondary adapter's `fields.Amount` edge after dedup kept
   * the primary adapter's `fields.amount` node).
   */
  edgeCasing?: EdgeCasingMode
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
  const cfg = raw as ImportConfig
  for (const replacement of cfg.componentNameReplacements ?? []) {
    if (!replacement.from || !replacement.to) {
      throw new Error(`Invalid import config: componentNameReplacements entries must have non-empty "from" and "to"`)
    }
  }
  for (const rule of cfg.deduplication ?? []) {
    if (!rule.primary || !rule.secondary) {
      throw new Error(`Invalid import config: deduplication entries must have non-empty "primary" and "secondary"`)
    }
  }
  if (cfg.edgeCasing !== undefined && cfg.edgeCasing !== 'preserve' && cfg.edgeCasing !== 'match') {
    throw new Error(`Invalid import config: edgeCasing must be "preserve" or "match"`)
  }
  return cfg
}

export function applyComponentNameReplacements(
  name: string,
  replacements: ComponentNameReplacement[],
): string {
  return replacements.find(r => r.from === name)?.to ?? name
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
