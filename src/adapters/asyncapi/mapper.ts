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

export function mapDocument(
  document: AsyncAPIDocumentInterface,
  entry: AsyncAPIImportEntry,
  packConfig: AdapterPackConfig,
): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const sharedSchemas = new Map<string, string>()
  const sourceSchemas = new Map<string, unknown>()

  const rawDoc = document.json() as { components?: { schemas?: Record<string, unknown> } }

  for (const [name, schema] of Object.entries(rawDoc.components?.schemas ?? {})) {
    sourceSchemas.set(name, schema)
  }

  const schemaCounts = countMessageSchemaUsage(document)
  const sharedSchemaNames = collectSharedSchemaNames(document, schemaCounts)

  const schemaComponents = new Map<string, string>()
  for (const operation of document.allOperations()) {
    for (const message of operation.messages().all()) {
      const component = extractValue(entry.componentMapping, operation, message)
      if (!component) continue
      const msgName = message.name() ?? message.id()
      if (!msgName) continue
      const msgJson = JSON.stringify((message as unknown as { json(): unknown }).json())
      for (const schemaName of sharedSchemaNames) {
        if (msgJson.includes(`"#/components/schemas/${schemaName}"`)) {
          const existing = schemaComponents.get(schemaName)
          if (!existing) {
            schemaComponents.set(schemaName, component)
          } else if (existing !== component) {
            schemaComponents.set(schemaName, 'shared')
          }
        }
      }
    }
  }

  for (const [name, schema] of Object.entries(rawDoc.components?.schemas ?? {})) {
    const s = schema as { type?: string; enum?: unknown[] }
    const component = schemaComponents.get(name) ?? 'shared'
    if (s.enum) {
      sharedSchemas.set(name, `${component}.EnumDefinition.${name}`)
    } else if (sharedSchemaNames.has(name)) {
      sharedSchemas.set(name, `${component}.Schema.${name}`)
    }
  }

  for (const [name, schema] of Object.entries(rawDoc.components?.schemas ?? {})) {
    const s = schema as { type?: string; enum?: unknown[]; properties?: Record<string, unknown>; required?: string[] }
    const registeredId = sharedSchemas.get(name)
    if (!registeredId) continue

    if (s.enum) {
      const [component] = registeredId.split('.')
      nodes.push(makeNode(packConfig.constructs['enumDefinition']?.template ?? 'EnumDefinition', component, entry.spec, registeredId))
      for (const value of s.enum) {
        const valueId = deriveNodeId('enumValue', component, String(value), { parentId: registeredId, section: 'values' })
        const valueNode = makeNode(packConfig.constructs['enumValue']?.template ?? 'EnumValue', component, entry.spec, valueId)
        valueNode.properties = { name: String(value) }
        nodes.push(valueNode)
        edges.push({ id: `${registeredId}__has-value__${valueId}`, from: registeredId, to: valueId, type: 'has-value', state: 'implemented', stability: 'unstable' })
      }
      continue
    }

    if (!sharedSchemaNames.has(name)) continue
    const [component] = registeredId.split('.')
    nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, entry.spec, registeredId))
    emitFields(s, registeredId, 'fields', undefined, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
  }

  const seenMessages = new Map<string, string>()

  for (const operation of document.allOperations()) {
    const channelAddress = operation.channels().all()[0]?.address() ?? ''

    for (const message of operation.messages().all()) {
      const component = extractValue(entry.componentMapping, operation, message)
      if (!component) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for message on channel "${channelAddress}" — skipping` })
        continue
      }

      const namingCtx = entry.messageNaming ? { strategy: entry.messageNaming, operation } : undefined
      const nameResult = deriveMessageName(message, namingCtx, entry.spec)

      if (!nameResult) {
        const hasId = message.id() && !message.id().startsWith('<anonymous')
        diagnostics.push({
          severity: hasId ? 'warning' : 'error',
          file: entry.spec,
          message: hasId
            ? `Cannot derive name for message on channel "${channelAddress}" — skipping. Set message.name or configure messageNaming.`
            : `Anonymous message on channel "${channelAddress}" — skipping (no name or id)`,
        })
        continue
      }

      const messageName = nameResult.name

      if (seenMessages.has(messageName)) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `[INFO] Message "${messageName}" also on channel "${channelAddress}" — using first channel "${seenMessages.get(messageName)}"` })
        continue
      }
      seenMessages.set(messageName, channelAddress)

      const eventTemplate = classifyEvent(entry.eventClassification, operation, message)
      const eventId = deriveNodeId('event', component, messageName, { template: eventTemplate })
      const eventNode = makeNode(eventTemplate, component, entry.spec, eventId)

      const msgRaw = (message as unknown as { json(): Record<string, unknown> }).json()
      const properties: Record<string, unknown> = { topic: channelAddress }
      if (msgRaw.description) properties.description = String(msgRaw.description)

      if (message.hasHeaders()) {
        const rawHeaders = msgRaw.headers ?? null
        const headerResult = extractHeaders(rawHeaders, packConfig.scalarTypes, entry.spec)
        if (headerResult) {
          diagnostics.push(...headerResult.diagnostics)
          if (Object.keys(headerResult.headers).length > 0) properties.headers = headerResult.headers
        }
      }

      eventNode.properties = properties
      nodes.push(eventNode)

      const rawPayload = msgRaw.payload as Record<string, unknown> | undefined
      if (!rawPayload) continue

      const payloadStr = JSON.stringify(rawPayload)
      const refMatch = payloadStr.match(/"#\/components\/schemas\/([^"]+)"/)
      const payloadSchemaName = refMatch?.[1]

      if (payloadSchemaName) {
        const globalId = sharedSchemas.get(payloadSchemaName)
        if (globalId) {
          emitReadsEdge(eventId, globalId, edges)
        } else {
          const sourceSchema = sourceSchemas.get(payloadSchemaName) as { properties?: Record<string, unknown>; required?: string[] } | undefined
          if (sourceSchema) {
            const schemaKey = toKebabCase(payloadSchemaName)
            const schemaId = deriveNodeId('schema', component, schemaKey, { parentId: eventId, section: 'schemas' })
            nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, entry.spec, schemaId))
            edges.push({ id: `${eventId}__has-field__${schemaId}`, from: eventId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
            emitFields(sourceSchema, schemaId, 'fields', eventId, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
          }
        }
      } else if (rawPayload.type === 'object' && rawPayload.properties) {
        const schemaId = deriveNodeId('schema', component, messageName, { parentId: eventId, section: 'schemas' })
        nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, entry.spec, schemaId))
        edges.push({ id: `${eventId}__has-field__${schemaId}`, from: eventId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
        emitFields(rawPayload as { properties?: Record<string, unknown>; required?: string[] }, schemaId, 'fields', eventId, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
      } else {
        const primitiveType = Array.isArray(rawPayload.type) ? rawPayload.type.find(t => t !== 'null') : rawPayload.type
        if (primitiveType && primitiveType !== 'object') {
          diagnostics.push({ severity: 'warning', file: entry.spec, message: `Message "${messageName}" has scalar payload (type: ${primitiveType}) — Event created with no schemas section` })
        }
      }
    }
  }

  return { nodes, edges, diagnostics }
}

function makeNode(template: string, component: string, specPath: string, id: string): Node {
  return {
    id, template, component,
    state: 'implemented', stability: 'unstable', schemaVersion: '1',
    lastModifiedAt: new Date().toISOString().split('T')[0],
    extractedFrom: specPath,
    derivation: 'determined',
    derivedBy: 'adapter:asyncapi',
    properties: {},
  }
}

function emitReadsEdge(from: string, to: string, edges: Edge[]): void {
  const id = `${from}__reads__${to}`
  if (!edges.some(e => e.id === id)) {
    edges.push({ id, from, to, type: 'reads', state: 'implemented', stability: 'unstable' })
  }
}

function refName(ref: string): string {
  return ref.split('/').pop() ?? ref
}

function isRefSchema(schema: unknown): schema is { $ref: string } {
  return typeof schema === 'object' && schema !== null && '$ref' in schema
}

function resolveAllOfRef(schema: unknown): unknown {
  if (isRefSchema(schema)) return schema
  const s = schema as { allOf?: unknown[] }
  if (Array.isArray(s.allOf) && s.allOf.length === 1 && isRefSchema(s.allOf[0])) return s.allOf[0]
  return schema
}

function emitFields(
  schema: { properties?: Record<string, unknown>; required?: string[] },
  parentId: string,
  section: string,
  rootId: string | undefined,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
  sourceSchemas: Map<string, unknown>,
  localSchemas: Map<string, string>,
): void {
  const readsSource = rootId ?? parentId
  const [component] = parentId.split('.')

  for (const [fieldName, rawFieldSchema] of Object.entries(schema.properties ?? {})) {
    const fieldSchema = resolveAllOfRef(rawFieldSchema)
    const fieldId = deriveNodeId('field', component, fieldName, { parentId, section })
    const fieldNode = makeNode(packConfig.constructs['payloadField']?.template ?? 'Field', component, specPath, fieldId)
    const required = Array.isArray(schema.required) && schema.required.includes(fieldName)

    if (isRefSchema(fieldSchema)) {
      const schemaName = refName((fieldSchema as { $ref: string }).$ref)
      const globalId = sharedSchemas.get(schemaName)
      if (globalId) {
        emitReadsEdge(readsSource, globalId, edges)
        fieldNode.properties = { $ref: globalId, nullable: !required }
      } else if (localSchemas.has(schemaName)) {
        fieldNode.properties = { $ref: localSchemas.get(schemaName)!, nullable: !required }
      } else if (rootId) {
        const src = sourceSchemas.get(schemaName) as { properties?: Record<string, unknown>; required?: string[] } | undefined
        if (src) {
          const inlineId = deriveNodeId('schema', component, schemaName, { parentId: rootId, section: 'schemas' })
          if (!nodes.some(n => n.id === inlineId)) {
            nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, specPath, inlineId))
            edges.push({ id: `${rootId}__has-field__${inlineId}`, from: rootId, to: inlineId, type: 'has-field', state: 'implemented', stability: 'unstable' })
            const localRef = `#/schemas/${schemaName}`
            localSchemas.set(schemaName, localRef)
            emitFields(src, inlineId, 'fields', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
          }
          fieldNode.properties = { $ref: localSchemas.get(schemaName) ?? `#/schemas/${schemaName}`, nullable: !required }
        } else {
          fieldNode.properties = { $ref: schemaName, nullable: !required }
        }
      } else {
        fieldNode.properties = { $ref: schemaName, nullable: !required }
      }
    } else {
      const fs = fieldSchema as { type?: string | string[]; format?: string; enum?: unknown[]; items?: unknown; properties?: Record<string, unknown>; additionalProperties?: unknown }
      const rawType = Array.isArray(fs.type) ? (fs.type.find(t => t !== 'null') ?? 'string') : (fs.type ?? 'string')
      const isNullableArray = Array.isArray(fs.type) && fs.type.includes('null')
      const nullable = !required || isNullableArray

      if (fs.enum) {
        const enumRef = sharedSchemas.get(fieldName)
        fieldNode.properties = enumRef ? { $ref: enumRef, nullable } : { type: 'string', nullable }
        if (!enumRef) diagnostics.push({ severity: 'warning', file: specPath, message: `Inline enum for field "${fieldId}" — treating as string` })
      } else if (rawType === 'array') {
        const items = fs.items ? resolveAllOfRef(fs.items) : undefined
        if (!items) {
          fieldNode.properties = { type: 'string', nullable, collection: 'array' }
        } else if (isRefSchema(items)) {
          const sn = refName((items as { $ref: string }).$ref)
          const gId = sharedSchemas.get(sn)
          if (gId) {
            emitReadsEdge(readsSource, gId, edges)
            fieldNode.properties = { $ref: gId, nullable, collection: 'array' }
          } else if (localSchemas.has(sn)) {
            fieldNode.properties = { $ref: localSchemas.get(sn)!, nullable, collection: 'array' }
          } else if (rootId) {
            const src = sourceSchemas.get(sn) as { properties?: Record<string, unknown>; required?: string[] } | undefined
            if (src) {
              const inlineId = deriveNodeId('schema', component, sn, { parentId: rootId, section: 'schemas' })
              if (!nodes.some(n => n.id === inlineId)) {
                nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, specPath, inlineId))
                edges.push({ id: `${rootId}__has-field__${inlineId}`, from: rootId, to: inlineId, type: 'has-field', state: 'implemented', stability: 'unstable' })
                const localRef = `#/schemas/${sn}`
                localSchemas.set(sn, localRef)
                emitFields(src, inlineId, 'fields', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
              }
              fieldNode.properties = { $ref: localSchemas.get(sn) ?? `#/schemas/${sn}`, nullable, collection: 'array' }
            } else {
              fieldNode.properties = { type: 'string', nullable, collection: 'array' }
            }
          } else {
            fieldNode.properties = { type: 'string', nullable, collection: 'array' }
          }
        } else {
          const it = items as { type?: string; format?: string }
          fieldNode.properties = { type: deriveScalarType(it.type ?? 'string', it.format, packConfig.scalarTypes) ?? 'string', nullable, collection: 'array' }
        }
      } else if (rawType === 'object' && fs.properties) {
        if (rootId) {
          const inlineId = deriveNodeId('schema', component, fieldName, { parentId: rootId, section: 'schemas' })
          if (!nodes.some(n => n.id === inlineId)) {
            nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, specPath, inlineId))
            edges.push({ id: `${rootId}__has-field__${inlineId}`, from: rootId, to: inlineId, type: 'has-field', state: 'implemented', stability: 'unstable' })
            const localRef = `#/schemas/${fieldName}`
            localSchemas.set(fieldName, localRef)
            emitFields(fs as { properties?: Record<string, unknown>; required?: string[] }, inlineId, 'fields', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
          }
          fieldNode.properties = { $ref: localSchemas.get(fieldName) ?? `#/schemas/${fieldName}`, nullable }
        } else {
          diagnostics.push({ severity: 'warning', file: specPath, message: `Inline object field "${fieldId}" has no event context — treating as string` })
          fieldNode.properties = { type: 'string', nullable }
        }
      } else {
        const scalarType = deriveScalarType(rawType, fs.format, packConfig.scalarTypes)
        if (scalarType) {
          fieldNode.properties = { type: scalarType, nullable }
        } else {
          diagnostics.push({ severity: 'warning', file: specPath, message: `Unknown type for field "${fieldId}": ${rawType}/${fs.format} — defaulting to string` })
          fieldNode.properties = { type: 'string', nullable }
        }
      }
    }

    nodes.push(fieldNode)
    edges.push({ id: `${parentId}__has-field__${fieldId}`, from: parentId, to: fieldId, type: 'has-field', state: 'implemented', stability: 'unstable' })
  }
}
