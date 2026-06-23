import type { OperationInterface, MessageInterface, AsyncAPIDocumentInterface } from '@asyncapi/parser'
import type { Node, Edge, Diagnostic } from '../../schema/index.js'
import type { AdapterPackConfig } from '../index.js'
import type { AsyncAPIImportEntry, FieldStrategy, ComponentNameReplacement } from '../../import/config.js'
import { applyComponentNameReplacements } from '../../import/config.js'

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

function unwrapPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const p = payload as Record<string, unknown>
  if (p.schemaFormat !== undefined && p.schema !== undefined && typeof p.schema === 'object') return p.schema
  return payload
}

export function deriveScalarType(
  type: string,
  format: string | undefined,
  scalarTypes: Record<string, string>,
): string | undefined {
  if (format && scalarTypes[`${type}/${format}`]) return scalarTypes[`${type}/${format}`]
  return scalarTypes[type]
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
  return { name: extracted }
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

// Extract the original component schema name from a resolved schema object.
// @asyncapi/parser resolves $refs inline but tags each resolved object with
// x-parser-schema-id equal to the component schema name (non-anonymous schemas
// have a plain name; anonymous ones get "<anonymous-schema-N>").
// Falls back to parsing a literal $ref string for test mocks that don't resolve.
function componentSchemaIdOf(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const o = obj as Record<string, unknown>
  const xId = o['x-parser-schema-id']
  if (typeof xId === 'string' && !xId.startsWith('<')) return xId
  const ref = o['$ref']
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) return ref.slice('#/components/schemas/'.length)
  return undefined
}

export function countMessageSchemaUsage(document: AsyncAPIDocumentInterface): Map<string, number> {
  const rawDoc = document.json() as { components?: { schemas?: Record<string, unknown> } }
  const componentSchemaNames = new Set(Object.keys(rawDoc.components?.schemas ?? {}))
  const schemaToMessages = new Map<string, Set<string>>()

  function register(schemaName: string, msgName: string) {
    if (!componentSchemaNames.has(schemaName)) return
    if (!schemaToMessages.has(schemaName)) schemaToMessages.set(schemaName, new Set())
    schemaToMessages.get(schemaName)!.add(msgName)
  }

  function collectRefs(obj: unknown, msgName: string) {
    if (!obj || typeof obj !== 'object') return
    const id = componentSchemaIdOf(obj)
    if (id) register(id, msgName)
    const o = obj as Record<string, unknown>
    if (o.properties) for (const v of Object.values(o.properties as Record<string, unknown>)) collectRefs(v, msgName)
    if (o.items) collectRefs(o.items, msgName)
  }

  for (const operation of document.allOperations()) {
    for (const message of operation.messages().all()) {
      const msgName = message.name() ?? message.id()
      if (!msgName) continue
      const msgJson = (message as unknown as { json(): Record<string, unknown> }).json()
      if (msgJson.payload) collectRefs(unwrapPayload(msgJson.payload), msgName)
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

  function schemaReferences(schema: unknown, names: Set<string>): Set<string> {
    const refs = new Set<string>()
    function walk(obj: unknown) {
      if (!obj || typeof obj !== 'object') return
      const id = componentSchemaIdOf(obj)
      if (id && names.has(id)) refs.add(id)
      const o = obj as Record<string, unknown>
      if (o.properties) for (const v of Object.values(o.properties as Record<string, unknown>)) walk(v)
      if (o.items) walk(o.items)
    }
    walk(schema)
    return refs
  }

  const candidateNames = new Set(Object.keys(rawDoc.components?.schemas ?? {}))
  let changed = true
  while (changed) {
    changed = false
    for (const [candidateName] of Object.entries(rawDoc.components?.schemas ?? {})) {
      if (shared.has(candidateName)) continue
      for (const sharedName of shared) {
        const sharedSchema = rawDoc.components?.schemas?.[sharedName]
        const refs = schemaReferences(sharedSchema, candidateNames)
        if (refs.has(candidateName)) {
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
  componentNameReplacements: ComponentNameReplacement[] = [],
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
      const rawComponent = extractValue(entry.componentMapping, operation, message)
      if (!rawComponent) continue
      const component = applyComponentNameReplacements(rawComponent, componentNameReplacements)
      const msgName = message.name() ?? message.id()
      if (!msgName) continue
      const msgJson = (message as unknown as { json(): Record<string, unknown> }).json()
      const resolvedComponent = component

      function walkForComponent(obj: unknown) {
        if (!obj || typeof obj !== 'object') return
        const id = componentSchemaIdOf(obj)
        if (id && sourceSchemas.has(id)) {
          const existing = schemaComponents.get(id)
          if (!existing) schemaComponents.set(id, resolvedComponent)
          else if (existing !== resolvedComponent) schemaComponents.set(id, 'shared')
        }
        const o = obj as Record<string, unknown>
        if (o.properties) for (const v of Object.values(o.properties as Record<string, unknown>)) walkForComponent(v)
        if (o.items) walkForComponent(o.items)
      }

      if (msgJson.payload) walkForComponent(unwrapPayload(msgJson.payload))
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
  const allOperations = document.allOperations().all()
  const operations = entry.includeConsumed ? allOperations : allOperations.filter(op => op.action() === 'send')

  for (const operation of operations) {
    const channelAddress = operation.channels().all()[0]?.address() ?? ''

    for (const message of operation.messages().all()) {
      const rawComponent = extractValue(entry.componentMapping, operation, message)
      if (!rawComponent) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for message on channel "${channelAddress}" — skipping` })
        continue
      }
      const component = applyComponentNameReplacements(rawComponent, componentNameReplacements)

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

      const rawPayload = unwrapPayload(msgRaw.payload) as Record<string, unknown> | undefined
      if (rawPayload) {
        const payloadSchemaName = componentSchemaIdOf(rawPayload)
        if (payloadSchemaName) {
          const globalId = sharedSchemas.get(payloadSchemaName)
          if (globalId) {
            emitReadsEdge(eventId, globalId, edges)
            properties.payload = globalId
          } else {
            const sourceSchema = sourceSchemas.get(payloadSchemaName) as { properties?: Record<string, unknown>; required?: string[] } | undefined
            if (sourceSchema) {
              const schemaKey = payloadSchemaName
              const schemaId = deriveNodeId('schema', component, schemaKey, { parentId: eventId, section: 'schemas' })
              nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, entry.spec, schemaId))
              edges.push({ id: `${eventId}__has-field__${schemaId}`, from: eventId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
              emitFields(sourceSchema, schemaId, 'fields', eventId, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
              properties.payload = `#/schemas/${schemaKey}`
            }
          }
        } else if (rawPayload.type === 'object' && rawPayload.properties) {
          const schemaId = deriveNodeId('schema', component, messageName, { parentId: eventId, section: 'schemas' })
          nodes.push(makeNode(packConfig.constructs['payloadSchema']?.template ?? 'Schema', component, entry.spec, schemaId))
          edges.push({ id: `${eventId}__has-field__${schemaId}`, from: eventId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
          emitFields(rawPayload as { properties?: Record<string, unknown>; required?: string[] }, schemaId, 'fields', eventId, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
          properties.payload = `#/schemas/${messageName}`
        } else {
          const primitiveType = Array.isArray(rawPayload.type) ? rawPayload.type.find(t => t !== 'null') : rawPayload.type
          if (primitiveType && primitiveType !== 'object') {
            diagnostics.push({ severity: 'warning', file: entry.spec, message: `Message "${messageName}" has scalar payload (type: ${primitiveType}) — Event created with no schemas section` })
          }
        }
      }

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
    }
  }

  return { nodes, edges, diagnostics }
}

function makeNode(template: string, component: string, specPath: string, id: string): Node {
  return {
    id,
    template,
    component,
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
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

function resolveSchemaRef(
  schemaName: string,
  nullable: boolean,
  collection: 'array' | undefined,
  readsSource: string,
  rootId: string | undefined,
  component: string,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
  sourceSchemas: Map<string, unknown>,
  localSchemas: Map<string, string>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = { nullable }
  if (collection) extra.collection = collection

  const globalId = sharedSchemas.get(schemaName)
  if (globalId) {
    emitReadsEdge(readsSource, globalId, edges)
    return { $ref: globalId, ...extra }
  }

  if (localSchemas.has(schemaName)) return { $ref: localSchemas.get(schemaName)!, ...extra }

  if (rootId) {
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
      return { $ref: localSchemas.get(schemaName) ?? `#/schemas/${schemaName}`, ...extra }
    }
  }

  return { $ref: schemaName, ...extra }
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
    const resolvedSchemaId = componentSchemaIdOf(rawFieldSchema)
    const fieldSchema = resolveAllOfRef(rawFieldSchema)
    const fieldId = deriveNodeId('field', component, fieldName, { parentId, section })
    const fieldNode = makeNode(packConfig.constructs['payloadField']?.template ?? 'Field', component, specPath, fieldId)
    const required = Array.isArray(schema.required) && schema.required.includes(fieldName)

    // Resolve reference: prefer x-parser-schema-id (resolved by @asyncapi/parser), fall back to literal $ref
    const schemaName = (resolvedSchemaId !== undefined && (sharedSchemas.has(resolvedSchemaId) || sourceSchemas.has(resolvedSchemaId)))
      ? resolvedSchemaId
      : (isRefSchema(fieldSchema) ? refName((fieldSchema as { $ref: string }).$ref) : undefined)

    if (schemaName !== undefined) {
      fieldNode.properties = resolveSchemaRef(
        schemaName, !required, undefined, readsSource, rootId, component,
        packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
      )
    } else {
      const fs = fieldSchema as { type?: string | string[]; format?: string; enum?: unknown[]; items?: unknown; properties?: Record<string, unknown> }
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
          fieldNode.properties = resolveSchemaRef(
            refName((items as { $ref: string }).$ref), nullable, 'array', readsSource, rootId, component,
            packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
          )
          if (!fieldNode.properties.$ref) fieldNode.properties = { type: 'string', nullable, collection: 'array' }
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
