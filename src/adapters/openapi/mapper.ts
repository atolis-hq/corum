import type { OpenAPIV3 } from 'openapi-types'
import type { Node, Edge, Diagnostic } from '../../schema/index.js'
import type { AdapterPackConfig } from '../index.js'
import type { ComponentMapping, OpenAPIImportEntry } from '../../import/config.js'

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function deriveComponent(path: string, mapping: ComponentMapping): string | undefined {
  if (mapping.strategy === 'hardcoded') return mapping.component
  if (mapping.strategy === 'tag') return undefined
  const segments = path.split('/').filter(Boolean)
  if ('pattern' in mapping) {
    const match = path.match(mapping.pattern)
    return match?.[1]
  }
  return segments[mapping.segment]
}

export function deriveScalarType(
  type: string,
  format: string | undefined,
  scalarTypes: Record<string, string>,
): string | undefined {
  if (format && scalarTypes[`${type}/${format}`]) return scalarTypes[`${type}/${format}`]
  return scalarTypes[type]
}

export function isRefSchema(schema: unknown): schema is OpenAPIV3.ReferenceObject {
  return typeof schema === 'object' && schema !== null && '$ref' in schema
}

// Unwrap allOf: [{$ref}] — the OpenAPI 3.0 pattern for nullable/described refs
function resolveAllOfRef(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject {
  if (isRefSchema(schema)) return schema
  const s = schema as OpenAPIV3.SchemaObject
  if (Array.isArray(s.allOf) && s.allOf.length === 1 && isRefSchema(s.allOf[0])) {
    return s.allOf[0] as OpenAPIV3.ReferenceObject
  }
  return schema
}

export function deriveNodeId(
  kind: 'operation' | 'schema' | 'field' | 'enum' | 'enumValue',
  component: string | undefined,
  name: string,
  parentId?: string,
  section?: string,
): string {
  if (kind === 'operation') return `${component}.APIEndpoint.${name}`
  return `${parentId}.${section}.${name}`
}

export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref
}

function emitReadsEdge(from: string, to: string, edges: Edge[]): void {
  const id = `${from}__reads__${to}`
  if (!edges.some(e => e.id === id)) {
    edges.push({ id, from, to, type: 'reads', state: 'implemented', stability: 'unstable' })
  }
}

export function mapDocument(
  document: OpenAPIV3.Document,
  entry: OpenAPIImportEntry,
  packConfig: AdapterPackConfig,
): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const sharedSchemas = new Map<string, string>()
  const sourceSchemas = new Map<string, OpenAPIV3.SchemaObject>()

  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    if (!isRefSchema(schema)) sourceSchemas.set(name, schema as OpenAPIV3.SchemaObject)
  }

  // Schemas referenced by 2+ operations become shared files; single-use schemas are inlined
  const opCounts = countSchemaOperationUsage(document)
  const sharedSchemaNames = collectAllSharedSchemaNames(document, opCounts)

  // Pass 1: register all enum and shared-schema IDs upfront so cross-references
  // resolve correctly regardless of definition order in the spec.
  if (document.components?.schemas) {
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      if (isRefSchema(schema)) continue
      const s = schema as OpenAPIV3.SchemaObject
      const component = deriveComponentForSchema(name, document, entry)
      if (!component) continue
      if (s.type !== 'object' && s.enum) {
        sharedSchemas.set(name, `${component}.EnumDefinition.${name}`)
      } else if (sharedSchemaNames.has(name)) {
        sharedSchemas.set(name, `${component}.Schema.${name}`)
      }
    }
  }

  // Pass 2: emit nodes and fields now that all IDs are registered.
  if (document.components?.schemas) {
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      if (isRefSchema(schema)) continue
      const s = schema as OpenAPIV3.SchemaObject

      if (s.type !== 'object' && s.enum) {
        const enumId = sharedSchemas.get(name)
        if (!enumId) continue
        const [component] = enumId.split('.')
        const enumNode = makeNode(packConfig.constructs.enumDefinition?.template ?? 'EnumDefinition', component, entry.spec, enumId)
        nodes.push(enumNode)
        s.enum.forEach((value) => {
          const valueId = deriveNodeId('enumValue', undefined, String(value), enumId, 'values')
          const valueNode = makeNode(packConfig.constructs.enumValue?.template ?? 'EnumValue', component, entry.spec, valueId)
          valueNode.properties = { name: String(value) }
          nodes.push(valueNode)
          edges.push({ id: `${enumId}__has-value__${valueId}`, from: enumId, to: valueId, type: 'has-value', state: 'implemented', stability: 'unstable' })
        })
        continue
      }

      if (!sharedSchemaNames.has(name)) continue

      const schemaId = sharedSchemas.get(name)
      if (!schemaId) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for schema ${name}, skipping` })
        continue
      }
      const [component] = schemaId.split('.')
      const node = makeNode(packConfig.constructs.requestSchema?.template ?? 'Schema', component, entry.spec, schemaId)
      nodes.push(node)
      emitFields(s, schemaId, 'fields', undefined, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
    }
  }

  for (const [urlPath, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined
      if (!operation) continue

      const operationId = operation.operationId ?? `${method}-${urlPath.replace(/\//g, '-').replace(/^-/, '')}`
      const component = entry.componentMapping.strategy === 'tag'
        ? operation.tags?.[0]
        : deriveComponent(urlPath, entry.componentMapping)

      if (!component) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for ${method.toUpperCase()} ${urlPath}, skipping` })
        continue
      }

      const endpointId = deriveNodeId('operation', component, operationId)
      const endpointNode = makeNode(packConfig.constructs.operation.template, component, entry.spec, endpointId)
      endpointNode.properties = {
        method: method.toUpperCase(),
        path: urlPath,
        ...(operation.summary && { description: operation.summary }),
      }
      nodes.push(endpointNode)

      const parameters = extractParameters(pathItem, operation, packConfig, entry.spec, diagnostics)
      if (parameters) endpointNode.properties.parameters = parameters

      const localSchemas = new Map<string, string>()

      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined
      if (requestBody?.content) {
        const jsonContent = requestBody.content['application/json']
        if (jsonContent?.schema) {
          const ref = emitSchemaNode(
            jsonContent.schema, `${operationId}-request`, endpointId, 'schemas', endpointId,
            packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
          )
          if (ref) endpointNode.properties.request = ref
        }
      }

      const responses: Record<string, string> = {}
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        const responseObj = response as OpenAPIV3.ResponseObject
        const jsonContent = responseObj.content?.['application/json']
        if (jsonContent?.schema) {
          const ref = emitSchemaNode(
            jsonContent.schema, `${operationId}-response-${status}`, endpointId, 'schemas', endpointId,
            packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
          )
          if (ref) responses[status] = ref
        }
      }
      if (Object.keys(responses).length > 0) endpointNode.properties.responses = responses
    }
  }

  return { nodes, edges, diagnostics }
}

function countSchemaOperationUsage(document: OpenAPIV3.Document): Map<string, number> {
  const counts = new Map<string, number>()
  const schemaNames = Object.keys(document.components?.schemas ?? {})
  for (const [, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined
      if (!operation) continue
      const opJson = JSON.stringify(operation)
      for (const name of schemaNames) {
        if (opJson.includes(`"#/components/schemas/${name}"`)) {
          counts.set(name, (counts.get(name) ?? 0) + 1)
        }
      }
    }
  }
  return counts
}

// Schemas referenced by 2+ operations are shared. Schemas referenced by shared schemas are also shared.
function collectAllSharedSchemaNames(document: OpenAPIV3.Document, opCounts: Map<string, number>): Set<string> {
  const shared = new Set<string>()
  for (const [name, count] of opCounts) {
    if (count > 1) shared.add(name)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [candidateName] of Object.entries(document.components?.schemas ?? {})) {
      if (shared.has(candidateName)) continue
      for (const sharedName of shared) {
        const sharedSchema = document.components?.schemas?.[sharedName]
        if (isRefSchema(sharedSchema)) continue
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

function extractParameters(
  pathItem: OpenAPIV3.PathItemObject,
  operation: OpenAPIV3.OperationObject,
  packConfig: AdapterPackConfig,
  specPath: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  const pathItemParams = (pathItem.parameters ?? []) as (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[]
  const operationParams = (operation.parameters ?? []) as (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[]

  const merged = new Map<string, OpenAPIV3.ParameterObject>()
  for (const param of [...pathItemParams, ...operationParams]) {
    if (isRefSchema(param)) continue
    const p = param as OpenAPIV3.ParameterObject
    if (p.in === 'cookie') continue
    merged.set(p.name, p)
  }

  if (merged.size === 0) return undefined

  const parameters: Record<string, unknown> = {}
  for (const [name, param] of merged) {
    const schema = param.schema as OpenAPIV3.SchemaObject | undefined
    if (!schema) continue

    let type: string
    let collection: 'one' | 'array' | undefined

    if (schema.type === 'array') {
      collection = 'array'
      const items = schema.items as OpenAPIV3.SchemaObject | undefined
      type = deriveScalarType(items?.type ?? 'string', items?.format, packConfig.scalarTypes) ?? 'string'
    } else if (schema.enum) {
      type = 'string'
    } else {
      const derived = deriveScalarType(schema.type ?? 'string', schema.format, packConfig.scalarTypes)
      if (!derived) {
        diagnostics.push({ severity: 'warning', file: specPath, message: `Unknown type for parameter ${name}: ${schema.type}/${schema.format}, defaulting to string` })
        type = 'string'
      } else {
        type = derived
      }
    }

    parameters[name] = {
      location: param.in as 'path' | 'query' | 'header',
      type,
      required: param.required ?? false,
      ...(collection ? { collection } : {}),
    }
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined
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
    derivedBy: 'adapter:openapi',
    properties: {},
  }
}

function emitSchemaNode(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  name: string,
  parentId: string,
  section: string,
  rootId: string | undefined,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
  sourceSchemas: Map<string, OpenAPIV3.SchemaObject>,
  localSchemas: Map<string, string>,
): string | undefined {
  schema = resolveAllOfRef(schema)

  if (isRefSchema(schema)) {
    const schemaName = refName(schema.$ref)

    const globalId = sharedSchemas.get(schemaName)
    if (globalId) {
      if (rootId) emitReadsEdge(rootId, globalId, edges)
      return globalId
    }

    if (localSchemas.has(schemaName)) return localSchemas.get(schemaName)

    const sourceSchema = sourceSchemas.get(schemaName)
    if (sourceSchema) {
      const effectiveParent = rootId ?? parentId
      return createInlineSchema(sourceSchema, schemaName, effectiveParent, section, rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
    }

    return undefined
  }

  if (localSchemas.has(name)) return localSchemas.get(name)
  return createInlineSchema(schema as OpenAPIV3.SchemaObject, name, parentId, section, rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
}

function createInlineSchema(
  schema: OpenAPIV3.SchemaObject,
  name: string,
  parentId: string,
  section: string,
  rootId: string | undefined,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
  sourceSchemas: Map<string, OpenAPIV3.SchemaObject>,
  localSchemas: Map<string, string>,
): string {
  const schemaId = deriveNodeId('schema', undefined, name, parentId, section)
  const [component] = parentId.split('.')
  const node = makeNode(packConfig.constructs.requestSchema?.template ?? 'Schema', component, specPath, schemaId)
  nodes.push(node)
  edges.push({ id: `${parentId}__has-field__${schemaId}`, from: parentId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
  const localRef = `#/${section}/${name}`
  localSchemas.set(name, localRef)
  emitFields(schema, schemaId, 'fields', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
  return localRef
}

function resolveFieldRef(
  schemaName: string,
  collection: 'one' | 'array' | 'map' | 'map-of-map' | 'map-of-array',
  required: boolean,
  rootId: string | undefined,
  readsSource: string,
  refSchema: OpenAPIV3.ReferenceObject,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
  sourceSchemas: Map<string, OpenAPIV3.SchemaObject>,
  localSchemas: Map<string, string>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = { nullable: !required }
  if (collection !== 'one') extra.collection = collection

  const globalId = sharedSchemas.get(schemaName)
  if (globalId) {
    emitReadsEdge(readsSource, globalId, edges)
    return { $ref: globalId, ...extra }
  }

  if (localSchemas.has(schemaName)) return { $ref: localSchemas.get(schemaName)!, ...extra }

  if (rootId) {
    const localRef = emitSchemaNode(refSchema, schemaName, rootId, 'schemas', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
    if (localRef) return { $ref: localRef, ...extra }
  }

  return { $ref: schemaName, ...extra }
}

function emitFields(
  schema: OpenAPIV3.SchemaObject,
  parentId: string,
  section: string,
  rootId: string | undefined,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
  sourceSchemas: Map<string, OpenAPIV3.SchemaObject>,
  localSchemas: Map<string, string>,
): void {
  // readsSource: when in endpoint context use rootId, otherwise use the schema itself
  const readsSource = rootId ?? parentId
  for (const [fieldName, rawFieldSchema] of Object.entries(schema.properties ?? {})) {
    const fieldSchema = resolveAllOfRef(rawFieldSchema as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject)
    const fieldId = deriveNodeId('field', undefined, fieldName, parentId, section)
    const [component] = parentId.split('.')
    const fieldNode = makeNode(packConfig.constructs.schemaProperty?.template ?? 'Field', component, specPath, fieldId)
    const required = Array.isArray(schema.required) && schema.required.includes(fieldName)

    if (isRefSchema(fieldSchema)) {
      fieldNode.properties = resolveFieldRef(
        refName(fieldSchema.$ref), 'one', required, rootId, readsSource,
        fieldSchema as OpenAPIV3.ReferenceObject,
        packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
      )
    } else {
      const fs = fieldSchema as OpenAPIV3.SchemaObject

      if (fs.enum && fs.type !== 'object') {
        const enumRef = sharedSchemas.get(fieldName)
        fieldNode.properties = { ...(enumRef ? { $ref: enumRef } : { type: 'string' }), nullable: !required }
      } else if (fs.type === 'array') {
        const rawItems = fs.items as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
        const items = rawItems ? resolveAllOfRef(rawItems) : undefined

        if (!items) {
          fieldNode.properties = { type: 'string', nullable: !required, collection: 'array' }
        } else if (isRefSchema(items)) {
          fieldNode.properties = resolveFieldRef(
            refName(items.$ref), 'array', required, rootId, readsSource,
            items as OpenAPIV3.ReferenceObject,
            packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
          )
        } else {
          const itemType = deriveScalarType((items as OpenAPIV3.SchemaObject).type ?? 'string', (items as OpenAPIV3.SchemaObject).format, packConfig.scalarTypes)
          fieldNode.properties = { type: itemType ?? 'string', nullable: !required, collection: 'array' }
        }
      } else if (fs.type === 'object' && fs.properties) {
        // Anonymous object with named properties → inline as sibling schema
        if (rootId) {
          const localRef = emitSchemaNode(fs, fieldName, rootId, 'schemas', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
          fieldNode.properties = localRef
            ? { $ref: localRef, nullable: !required }
            : { type: 'string', nullable: !required }
        } else {
          diagnostics.push({ severity: 'warning', file: specPath, message: `Inline object for field ${fieldId} has no endpoint context; treating as string` })
          fieldNode.properties = { type: 'string', nullable: !required }
        }
      } else if (fs.type === 'object' && fs.additionalProperties) {
        // Map/dictionary: keyed collection
        const addlRaw = fs.additionalProperties
        if (typeof addlRaw === 'boolean') {
          fieldNode.properties = { type: 'string', nullable: !required, collection: 'map' }
        } else {
          const addlSchema = resolveAllOfRef(addlRaw as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject)
          if (isRefSchema(addlSchema)) {
            fieldNode.properties = resolveFieldRef(
              refName(addlSchema.$ref), 'map', required, rootId, readsSource,
              addlSchema as OpenAPIV3.ReferenceObject,
              packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
            )
          } else {
            const addlObj = addlSchema as OpenAPIV3.SchemaObject
            if (addlObj.type === 'object') {
              const innerAddl = addlObj.additionalProperties
              if (!innerAddl || typeof innerAddl === 'boolean') {
                fieldNode.properties = { type: 'string', nullable: !required, collection: 'map-of-map' }
              } else {
                const innerSchema = resolveAllOfRef(innerAddl as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject)
                if (isRefSchema(innerSchema)) {
                  fieldNode.properties = resolveFieldRef(
                    refName(innerSchema.$ref), 'map-of-map', required, rootId, readsSource,
                    innerSchema as OpenAPIV3.ReferenceObject,
                    packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
                  )
                } else {
                  const inner = innerSchema as OpenAPIV3.SchemaObject
                  const scalarType = deriveScalarType(inner.type ?? 'string', inner.format, packConfig.scalarTypes)
                  if (scalarType) {
                    fieldNode.properties = { type: scalarType, nullable: !required, collection: 'map-of-map' }
                  } else {
                    diagnostics.push({ severity: 'warning', file: specPath, message: `[WARN] Double-nested map for field ${fieldId}; inner value type not representable, using string` })
                    fieldNode.properties = { type: 'string', nullable: !required, collection: 'map-of-map' }
                  }
                }
              }
            } else if (addlObj.type === 'array') {
              const rawItems = addlObj.items as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
              const items = rawItems ? resolveAllOfRef(rawItems) : undefined
              if (items && isRefSchema(items)) {
                fieldNode.properties = resolveFieldRef(
                  refName(items.$ref), 'map-of-array', required, rootId, readsSource,
                  items as OpenAPIV3.ReferenceObject,
                  packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas,
                )
              } else {
                const scalarType = items ? deriveScalarType((items as OpenAPIV3.SchemaObject).type ?? 'string', (items as OpenAPIV3.SchemaObject).format, packConfig.scalarTypes) : undefined
                fieldNode.properties = { type: scalarType ?? 'string', nullable: !required, collection: 'map-of-array' }
              }
            } else {
              const scalarType = deriveScalarType(addlObj.type ?? 'string', addlObj.format, packConfig.scalarTypes)
              fieldNode.properties = { type: scalarType ?? 'string', nullable: !required, collection: 'map' }
            }
          }
        }
      } else {
        const scalarType = deriveScalarType(fs.type ?? 'string', fs.format, packConfig.scalarTypes)
        if (scalarType) {
          fieldNode.properties = { type: scalarType, nullable: !required }
        } else {
          diagnostics.push({ severity: 'warning', file: specPath, message: `Unknown type for field ${fieldId}: ${fs.type}/${fs.format}` })
          fieldNode.properties = { type: 'string', nullable: !required }
        }
      }
    }

    nodes.push(fieldNode)
    edges.push({ id: `${parentId}__has-field__${fieldId}`, from: parentId, to: fieldId, type: 'has-field', state: 'implemented', stability: 'unstable' })
  }
}

function deriveComponentForSchema(name: string, document: OpenAPIV3.Document, entry: OpenAPIImportEntry, visited: Set<string> = new Set()): string | undefined {
  if (visited.has(name)) return undefined
  visited.add(name)
  const directComponents = new Set<string>()
  for (const [urlPath, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined
      if (!operation) continue
      if (referencesSchema(operation, name)) {
        const component = entry.componentMapping.strategy === 'tag'
          ? operation.tags?.[0]
          : deriveComponent(urlPath, entry.componentMapping)
        if (component) directComponents.add(component)
      }
    }
  }
  if (directComponents.size > 1) return 'shared'
  if (directComponents.size === 1) return [...directComponents][0]
  for (const [schemaName, schema] of Object.entries(document.components?.schemas ?? {})) {
    if (schemaName === name || isRefSchema(schema)) continue
    if (JSON.stringify(schema).includes(`"#/components/schemas/${name}"`)) {
      const comp = deriveComponentForSchema(schemaName, document, entry, visited)
      if (comp) return comp
    }
  }
  return undefined
}

function referencesSchema(operation: OpenAPIV3.OperationObject, schemaName: string): boolean {
  return JSON.stringify(operation).includes(`"#/components/schemas/${schemaName}"`)
}
