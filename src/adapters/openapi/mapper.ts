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

export function mapDocument(
  document: OpenAPIV3.Document,
  entry: OpenAPIImportEntry,
  packConfig: AdapterPackConfig,
): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const sharedSchemas = new Map<string, string>()

  if (document.components?.schemas) {
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      if (isRefSchema(schema)) continue
      const s = schema as OpenAPIV3.SchemaObject

      if (s.type !== 'object' && s.enum) {
        const component = deriveComponentForSchema(name, document, entry)
        if (!component) continue
        const enumId = `${component}.EnumDefinition.${name}`
        const enumNode = makeNode(packConfig.constructs.enumDefinition?.template ?? 'EnumDefinition', component, entry.spec, enumId)
        nodes.push(enumNode)
        sharedSchemas.set(name, enumId)

        s.enum.forEach((value) => {
          const valueId = deriveNodeId('enumValue', undefined, String(value), enumId, 'values')
          const valueNode = makeNode(packConfig.constructs.enumValue?.template ?? 'EnumValue', component, entry.spec, valueId)
          valueNode.properties = { name: String(value) }
          nodes.push(valueNode)
          edges.push({ id: `${enumId}__has-value__${valueId}`, from: enumId, to: valueId, type: 'has-value', state: 'implemented', stability: 'unstable' })
        })
        continue
      }

      const component = deriveComponentForSchema(name, document, entry)
      if (!component) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for schema ${name}, skipping` })
        continue
      }
      const schemaId = `${component}.Schema.${name}`
      sharedSchemas.set(name, schemaId)
      const node = makeNode(packConfig.constructs.requestSchema?.template ?? 'Schema', component, entry.spec, schemaId)
      nodes.push(node)
      emitFields(s, schemaId, 'fields', packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas)
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
        ...(operation.operationId && { operationId: operation.operationId }),
        ...(operation.summary && { description: operation.summary }),
      }
      nodes.push(endpointNode)

      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined
      if (requestBody?.content) {
        const jsonContent = requestBody.content['application/json']
        if (jsonContent?.schema) {
          emitSchemaNode(jsonContent.schema, `${operationId}-request`, endpointId, 'schemas', packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas)
        }
      }

      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        const responseObj = response as OpenAPIV3.ResponseObject
        const jsonContent = responseObj.content?.['application/json']
        if (jsonContent?.schema) {
          emitSchemaNode(jsonContent.schema, `${operationId}-response-${status}`, endpointId, 'schemas', packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas)
        }
      }
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
    derivedBy: 'adapter:openapi',
    properties: {},
  }
}

function emitSchemaNode(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  name: string,
  parentId: string,
  section: string,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
): void {
  if (isRefSchema(schema)) {
    const refId = sharedSchemas.get(refName(schema.$ref))
    if (refId) {
      const parent = nodes.find(n => n.id === parentId)
      if (parent) parent.properties[`${section}.${name}`] = refId
    }
    return
  }
  const schemaId = deriveNodeId('schema', undefined, name, parentId, section)
  const [component] = parentId.split('.')
  const node = makeNode(packConfig.constructs.requestSchema?.template ?? 'Schema', component, specPath, schemaId)
  nodes.push(node)
  edges.push({ id: `${parentId}__has-field__${schemaId}`, from: parentId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
  emitFields(schema as OpenAPIV3.SchemaObject, schemaId, 'fields', packConfig, specPath, nodes, edges, diagnostics, sharedSchemas)
}

function emitFields(
  schema: OpenAPIV3.SchemaObject,
  parentId: string,
  section: string,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
): void {
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties ?? {})) {
    const fieldId = deriveNodeId('field', undefined, fieldName, parentId, section)
    const [component] = parentId.split('.')
    const fieldNode = makeNode(packConfig.constructs.schemaProperty?.template ?? 'Field', component, specPath, fieldId)
    const required = Array.isArray(schema.required) && schema.required.includes(fieldName)

    if (isRefSchema(fieldSchema)) {
      const ref = refName(fieldSchema.$ref)
      fieldNode.properties = { objectRef: sharedSchemas.get(ref) ?? ref, nullable: !required, cardinality: 'one' }
    } else {
      const fs = fieldSchema as OpenAPIV3.SchemaObject
      if (fs.enum && fs.type !== 'object') {
        const enumRef = sharedSchemas.get(fieldName)
        fieldNode.properties = { ...(enumRef ? { objectRef: enumRef } : { type: 'string' }), nullable: !required, cardinality: 'one' }
      } else if (fs.type === 'array') {
        const items = fs.items
        if (isRefSchema(items)) {
          fieldNode.properties = { objectRef: refName(items.$ref), nullable: !required, cardinality: 'many' }
        } else {
          const itemType = deriveScalarType((items as OpenAPIV3.SchemaObject)?.type ?? 'string', (items as OpenAPIV3.SchemaObject)?.format, packConfig.scalarTypes)
          fieldNode.properties = { type: itemType ?? 'string', nullable: !required, cardinality: 'many' }
        }
      } else {
        const scalarType = deriveScalarType(fs.type ?? 'string', fs.format, packConfig.scalarTypes)
        if (scalarType) {
          fieldNode.properties = { type: scalarType, nullable: !required, cardinality: 'one' }
        } else {
          diagnostics.push({ severity: 'warning', file: specPath, message: `Unknown type for field ${fieldId}: ${fs.type}/${fs.format}` })
          fieldNode.properties = { type: 'string', nullable: !required, cardinality: 'one' }
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
  // Direct: find an operation that references this schema
  for (const [urlPath, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined
      if (!operation) continue
      if (referencesSchema(operation, name)) {
        return entry.componentMapping.strategy === 'tag'
          ? operation.tags?.[0]
          : deriveComponent(urlPath, entry.componentMapping)
      }
    }
  }
  // Indirect: find another component schema that references this one and use its component
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
