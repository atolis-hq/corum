import type { OperationInterface, MessageInterface, AsyncAPIDocumentInterface } from '@asyncapi/parser'
import type { Node, Edge, Diagnostic } from '../../schema/index.js'
import type { AdapterPackConfig } from '../index.js'
import type { AsyncAPIImportEntry, FieldStrategy } from '../../import/config.js'

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function extractValue(
  strategy: FieldStrategy,
  operation: OperationInterface,
  message: MessageInterface,
): string | undefined {
  switch (strategy.strategy) {
    case 'channel-segment': {
      const address = operation.channels().all()[0]?.address() ?? ''
      const parts = address.split(strategy.separator).filter(s => s.length > 0)
      const idx = strategy.segment < 0 ? parts.length + strategy.segment : strategy.segment
      return parts[idx]
    }
    case 'channel-pattern': {
      const address = operation.channels().all()[0]?.address() ?? ''
      const match = address.match(strategy.pattern)
      return match?.[1] ?? match?.[0]
    }
    case 'name-segment': {
      const source = message.name() ?? message.id()
      if (!source) return undefined
      const parts = source.split(strategy.separator).filter(s => s.length > 0)
      const idx = strategy.segment < 0 ? parts.length + strategy.segment : strategy.segment
      return parts[idx]
    }
    case 'name-pattern': {
      const source = message.name() ?? message.id()
      if (!source) return undefined
      const match = source.match(strategy.pattern)
      return match?.[1] ?? match?.[0]
    }
    case 'tag': {
      const msgTags = message.tags().all()
      if (msgTags.length > 0) return msgTags[0].name()
      const opTagsFn = (operation as unknown as { tags?: () => { all: () => Array<{ name(): string }> } }).tags
      const opTags = opTagsFn?.()?.all?.() ?? []
      return opTags[0]?.name()
    }
    case 'hardcoded':
      return strategy.value
  }
}

export function deriveScalarType(
  type: string,
  format: string | undefined,
  scalarTypes: Record<string, string>,
): string | undefined {
  if (format && scalarTypes[`${type}/${format}`]) return scalarTypes[`${type}/${format}`]
  return scalarTypes[type]
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function deriveMessageName(
  message: MessageInterface,
  namingCtx: { strategy: FieldStrategy; operation: OperationInterface } | undefined,
  _specPath: string,
): { name: string } | null {
  const rawName = message.name()
  const rawId = message.id()

  if (!rawName && (!rawId || rawId.startsWith('<anonymous'))) return null
  if (!rawName && !namingCtx) return null

  const extracted = namingCtx
    ? extractValue(namingCtx.strategy, namingCtx.operation, message)
    : rawName

  if (!extracted) return null
  return { name: toKebabCase(extracted) }
}

export function classifyEvent(
  classification: AsyncAPIImportEntry['eventClassification'],
  operation: OperationInterface,
  message: MessageInterface,
): 'IntegrationEvent' | 'DomainEvent' {
  if (!classification) return 'IntegrationEvent'
  if (!('from' in classification)) {
    return classification.strategy === 'always-domain' ? 'DomainEvent' : 'IntegrationEvent'
  }
  const value = extractValue(classification.from, operation, message)
  return value === classification.domainValue ? 'DomainEvent' : 'IntegrationEvent'
}

export function deriveNodeId(
  kind: 'event' | 'schema' | 'field' | 'enum' | 'enumValue',
  component: string,
  name: string,
  opts?: { template?: string; parentId?: string; section?: string },
): string {
  if (kind === 'event') return `${component}.${opts?.template ?? 'IntegrationEvent'}.${name}`
  return `${opts!.parentId}.${opts!.section}.${name}`
}

export function countMessageSchemaUsage(document: AsyncAPIDocumentInterface): Map<string, number> {
  const rawDoc = document.json() as { components?: { schemas?: Record<string, unknown> } }
  const schemaNames = Object.keys(rawDoc.components?.schemas ?? {})
  const schemaToMessages = new Map<string, Set<string>>()

  for (const operation of document.allOperations()) {
    for (const message of operation.messages().all()) {
      const msgName = message.name() ?? message.id()
      if (!msgName) continue
      const msgJson = JSON.stringify((message as unknown as { json(): unknown }).json())
      for (const name of schemaNames) {
        if (msgJson.includes(`"#/components/schemas/${name}"`)) {
          if (!schemaToMessages.has(name)) schemaToMessages.set(name, new Set())
          schemaToMessages.get(name)!.add(msgName)
        }
      }
    }
  }

  const counts = new Map<string, number>()
  for (const [name, names] of schemaToMessages) counts.set(name, names.size)
  return counts
}

export function collectSharedSchemaNames(
  document: AsyncAPIDocumentInterface,
  counts: Map<string, number>,
): Set<string> {
  const rawDoc = document.json() as { components?: { schemas?: Record<string, unknown> } }
  const shared = new Set<string>()

  for (const [name, count] of counts) {
    if (count >= 2) shared.add(name)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [candidateName] of Object.entries(rawDoc.components?.schemas ?? {})) {
      if (shared.has(candidateName)) continue
      for (const sharedName of shared) {
        const sharedSchema = rawDoc.components?.schemas?.[sharedName]
        if (JSON.stringify(sharedSchema).includes(`"#/components/schemas/${candidateName}"`)) {
          shared.add(candidateName)
          changed = true
          break
        }
      }
    }
  }
  return shared
}

export function extractHeaders(
  rawHeaders: unknown,
  scalarTypes: Record<string, string>,
  specPath: string,
): { headers: Record<string, unknown>; diagnostics: Diagnostic[] } | null {
  if (!rawHeaders || typeof rawHeaders !== 'object') return null
  const h = rawHeaders as { type?: string; properties?: Record<string, unknown>; required?: string[] }
  if (!h.properties || Object.keys(h.properties).length === 0) return null

  const headers: Record<string, unknown> = {}
  const diagnostics: Diagnostic[] = []

  for (const [name, rawDef] of Object.entries(h.properties)) {
    const def = rawDef as { type?: string | string[]; format?: string; description?: string }
    const rawType = Array.isArray(def.type) ? (def.type.find(t => t !== 'null') ?? 'string') : (def.type ?? 'string')

    if (rawType === 'object') {
      diagnostics.push({ severity: 'warning', file: specPath, message: `Header "${name}" is a nested object — skipping` })
      continue
    }

    const scalarType = deriveScalarType(rawType, def.format, scalarTypes) ?? 'string'
    const required = Array.isArray(h.required) && h.required.includes(name)
    const entry: Record<string, unknown> = { type: scalarType, required }
    if (def.description) entry.description = def.description
    headers[name] = entry
  }

  return { headers, diagnostics }
}

// Placeholder — completed in Task 7
export function mapDocument(
  _document: AsyncAPIDocumentInterface,
  _entry: AsyncAPIImportEntry,
  _packConfig: AdapterPackConfig,
): MapResult {
  return { nodes: [], edges: [], diagnostics: [] }
}
