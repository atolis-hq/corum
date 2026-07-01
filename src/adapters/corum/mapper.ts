import type { Diagnostic, Edge, EdgeType, Node } from '../../schema/index.js'
import type { CorumInterchangeDocument, CorumInterchangeEdge, CorumInterchangeProvenance } from './parser.js'

const VALID_EDGE_TYPES = new Set<string>([
  'triggers', 'produces', 'reads', 'calls', 'implements',
  'maps-to', 'derived-from', 'renamed-from', 'has-field', 'has-value',
])

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function mapDocument(document: CorumInterchangeDocument, specPath: string): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const allSchemas = (document.components?.schemas ?? {}) as Record<string, unknown>
  // Maps #/components/schemas/X and #/components/schemas/X/properties/Y to materialized node IDs
  const refToNodeId = new Map<string, string>()

  for (const gap of document.gaps ?? []) {
    const msg = gap.nodeId
      ? `[${gap.kind}] ${gap.nodeId}: ${gap.reason ?? ''}`
      : `[${gap.kind}] ${gap.reason ?? ''}`
    diagnostics.push({ severity: 'warning', file: specPath, message: msg })
  }

  for (const [nodeId, entry] of Object.entries(document.nodes)) {
    if (!nodeId || !entry.type) {
      diagnostics.push({ severity: 'warning', file: specPath, message: 'Node missing id or type — skipping' })
      continue
    }

    const component = nodeId.split('.')[0]
    const properties: Record<string, unknown> = {}

    let schemaName: string | undefined
    if (entry.schema?.$ref) {
      schemaName = schemaRefName(entry.schema.$ref)
      if (schemaName) properties.schema = schemaName
    }

    if (entry.title && !schemaName) {
      properties.description = entry.title
    }

    if (entry['x-aka']?.length) {
      properties['x-aka'] = entry['x-aka']
    }

    const node = makeNode(entry.type, component, specPath, nodeId, entry.provenance, properties)
    nodes.push(node)

    if (schemaName) {
      const expanded = new Map<string, string>()
      expandSchema(schemaName, nodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId)
    }
  }

  // Expand schemas referenced in edges that weren't reachable via any node's schema ref.
  // Uses schema name as its own synthetic root so IDs are self-contained and don't collide.
  // Enum schemas register their enum values as field nodes so edge refs to them can resolve.
  const orphanExpanded = new Set<string>()
  for (const raw of document.edges ?? []) {
    for (const endpoint of [raw.from, raw.to]) {
      const schemaName = extractSchemaName(endpoint)
      if (!schemaName) continue
      const schemaRef = `#/components/schemas/${schemaName}`
      if (refToNodeId.has(schemaRef) || orphanExpanded.has(schemaName)) continue
      orphanExpanded.add(schemaName)

      const schemaLocalName = schemaName.includes('.')
        ? schemaName.slice(schemaName.lastIndexOf('.') + 1)
        : schemaName

      const schemaDef = allSchemas[schemaName] as { properties?: Record<string, unknown>; enum?: unknown[] } | undefined
      const isOrphanEnum = Array.isArray(schemaDef?.enum) && !schemaDef?.properties
      const orphanSection = isOrphanEnum ? 'enums' : 'schemas'
      const orphanTemplate = isOrphanEnum ? 'EnumDefinition' : 'Schema'
      const schemaId = `${schemaLocalName}.${orphanSection}.${schemaLocalName}`
      refToNodeId.set(schemaRef, schemaId)
      nodes.push(makeNode(orphanTemplate, '_', specPath, schemaId, undefined, {}))

      for (const fieldName of Object.keys(schemaDef?.properties ?? {})) {
        const fieldId = `${schemaId}.fields.${fieldName}`
        refToNodeId.set(`${schemaRef}/properties/${fieldName}`, fieldId)
        nodes.push(makeNode('Field', '_', specPath, fieldId, undefined, {}))
        edges.push(makeHasFieldEdge(schemaId, fieldId))
      }
      if (isOrphanEnum) {
        for (const value of schemaDef!.enum!) {
          if (typeof value !== 'string') continue
          const valueId = `${schemaId}.values.${value}`
          refToNodeId.set(`${schemaRef}/properties/${value}`, valueId)
          nodes.push(makeNode('EnumValue', '_', specPath, valueId, undefined, { value }))
          edges.push(makeHasValueEdge(schemaId, valueId))
        }
      }
    }
  }

  // Build case-insensitive fallback index to handle PascalCase/camelCase mismatches
  // between edge field refs and actual schema property names
  const refToNodeIdLower = new Map(
    [...refToNodeId.entries()].map(([k, v]) => [k.toLowerCase(), v]),
  )

  for (const raw of document.edges ?? []) {
    if (!VALID_EDGE_TYPES.has(raw.type)) {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        message: `Unknown edge type '${raw.type}' from '${raw.from}' to '${raw.to}' — skipping`,
      })
      continue
    }
    const from = refToNodeId.get(raw.from) ?? refToNodeIdLower.get(raw.from.toLowerCase()) ?? raw.from
    const to = refToNodeId.get(raw.to) ?? refToNodeIdLower.get(raw.to.toLowerCase()) ?? raw.to
    if (from.startsWith('#/') || to.startsWith('#/')) {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        message: `edge references unresolvable node — skipping: ${from} → ${to}`,
      })
      continue
    }
    edges.push(mapEdge({ ...raw, from, to }))
  }

  return { nodes, edges, diagnostics }
}

function schemaRefName(ref: string): string | undefined {
  const prefix = '#/components/schemas/'
  if (!ref.startsWith(prefix)) return undefined
  return ref.slice(prefix.length)
}

function extractSchemaName(endpoint: string): string | undefined {
  const prefix = '#/components/schemas/'
  if (!endpoint.startsWith(prefix)) return undefined
  return endpoint.slice(prefix.length).split('/')[0]
}

function expandSchema(
  schemaName: string,
  rootNodeId: string,
  allSchemas: Record<string, unknown>,
  nodes: Node[],
  edges: Edge[],
  specPath: string,
  component: string,
  expanded: Map<string, string>,
  refToNodeId: Map<string, string>,
): string {
  const existing = expanded.get(schemaName)
  if (existing) return existing

  // Schema names from corum extractors are sometimes prefixed with the component name
  // (e.g. "workers.ReactToPersonCreatedCommand"). Strip the prefix so the local segment
  // in the node ID is a simple identifier — graph serialization rejects local names
  // that contain dots because it uses dots as a hierarchy separator.
  const schemaLocalName = schemaName.includes('.')
    ? schemaName.slice(schemaName.lastIndexOf('.') + 1)
    : schemaName

  const schemaDef = allSchemas[schemaName] as { type?: string; properties?: Record<string, unknown>; required?: string[]; enum?: unknown[] } | undefined
  const isEnumSchema = Array.isArray(schemaDef?.enum) && !schemaDef?.properties

  const schemaRef = `#/components/schemas/${schemaName}`

  if (isEnumSchema) {
    // Enum schemas become standalone EnumDefinition cluster roots, matching the OpenAPI/AsyncAPI
    // adapters. Using refToNodeId as shared dedup so only one node is created per mapDocument call
    // even though `expanded` is scoped per parent node.
    const enumId = `${component}.EnumDefinition.${schemaLocalName}`
    expanded.set(schemaName, enumId)
    if (!refToNodeId.has(schemaRef)) {
      refToNodeId.set(schemaRef, enumId)
      nodes.push(makeNode('EnumDefinition', component, specPath, enumId, undefined, {}))
      for (const value of schemaDef.enum!) {
        if (typeof value !== 'string') continue
        const valueId = `${enumId}.values.${value}`
        refToNodeId.set(`${schemaRef}/properties/${value}`, valueId)
        nodes.push(makeNode('EnumValue', component, specPath, valueId, undefined, { value }))
        edges.push(makeHasValueEdge(enumId, valueId))
      }
    }
    return refToNodeId.get(schemaRef)!
  }

  const schemaId = `${rootNodeId}.schemas.${schemaLocalName}`
  expanded.set(schemaName, schemaId)

  if (!refToNodeId.has(schemaRef)) refToNodeId.set(schemaRef, schemaId)

  nodes.push(makeNode('Schema', component, specPath, schemaId, undefined, {}))
  edges.push(makeHasFieldEdge(rootNodeId, schemaId))

  const localMappings = new Map<string, string>()

  for (const [fieldName, rawProp] of Object.entries(schemaDef?.properties ?? {})) {
    const fieldId = `${schemaId}.fields.${fieldName}`
    const fieldRef = `${schemaRef}/properties/${fieldName}`
    if (!refToNodeId.has(fieldRef)) refToNodeId.set(fieldRef, fieldId)

    const fieldNode = makeNode('Field', component, specPath, fieldId, undefined, {})
    const required = Array.isArray(schemaDef?.required) && schemaDef.required.includes(fieldName)

    fieldNode.properties = resolveFieldProperties(
      fieldName, rawProp as Record<string, unknown>, required,
      schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings, refToNodeId,
    )

    nodes.push(fieldNode)
    edges.push(makeHasFieldEdge(schemaId, fieldId))
  }

  return schemaId
}

function resolveFieldProperties(
  fieldName: string,
  prop: Record<string, unknown>,
  required: boolean,
  schemaId: string,
  rootNodeId: string,
  allSchemas: Record<string, unknown>,
  nodes: Node[],
  edges: Edge[],
  specPath: string,
  component: string,
  expanded: Map<string, string>,
  localMappings: Map<string, string>,
  refToNodeId: Map<string, string>,
): Record<string, unknown> {
  const nullable = !required

  if (typeof prop.$ref === 'string') {
    const refName = schemaRefName(prop.$ref)
    if (refName) {
      const refId = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId)
      return { $ref: refId, nullable, collection: 'one' }
    }
    return { type: 'string', nullable, collection: 'one' }
  }

  const type = prop.type as string | undefined

  if (type === 'array') {
    const items = prop.items as Record<string, unknown> | undefined
    if (items && typeof items.$ref === 'string') {
      const refName = schemaRefName(items.$ref as string)
      if (refName) {
        const refId = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId)
        return { $ref: refId, nullable, collection: 'array' }
      }
    }
    const itemType = mapScalar(
      (items?.type as string | undefined) ?? 'string',
      items?.format as string | undefined,
    )
    return { type: itemType, nullable, collection: 'array' }
  }

  if (type === 'object' && prop.additionalProperties !== undefined) {
    createMapping(fieldName, prop.additionalProperties, schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings, refToNodeId)
    return { $ref: `#/mappings/${fieldName}`, nullable, collection: 'one' }
  }

  const scalarType = mapScalar(type ?? 'string', prop.format as string | undefined)
  return { type: scalarType, nullable, collection: 'one' }
}

function createMapping(
  mappingName: string,
  addlDef: unknown,
  schemaId: string,
  rootNodeId: string,
  allSchemas: Record<string, unknown>,
  nodes: Node[],
  edges: Edge[],
  specPath: string,
  component: string,
  expanded: Map<string, string>,
  localMappings: Map<string, string>,
  refToNodeId: Map<string, string>,
): string {
  const existing = localMappings.get(mappingName)
  if (existing) return existing

  const mappingId = `${schemaId}.mappings.${mappingName}`
  localMappings.set(mappingName, mappingId)

  const mappingNode = makeNode('Mapping', component, specPath, mappingId, undefined, {})
  const props: Record<string, unknown> = {}

  if (!addlDef || typeof addlDef === 'boolean') {
    props.type = 'string'
  } else {
    const addl = addlDef as Record<string, unknown>
    if (typeof addl.$ref === 'string') {
      const refName = schemaRefName(addl.$ref)
      if (refName) {
        props.$ref = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId)
      } else {
        props.type = 'string'
      }
    } else if (addl.type === 'array') {
      props['value-collection'] = 'array'
      const items = addl.items as Record<string, unknown> | undefined
      if (items && typeof items.$ref === 'string') {
        const refName = schemaRefName(items.$ref as string)
        if (refName) {
          props.$ref = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId)
        } else {
          props.type = 'string'
        }
      } else {
        props.type = mapScalar((items?.type as string) ?? 'string', items?.format as string | undefined)
      }
    } else if (addl.type === 'object' && addl.additionalProperties !== undefined) {
      const innerName = `${mappingName}-values`
      props.$ref = createMapping(innerName, addl.additionalProperties, schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings, refToNodeId)
    } else {
      props.type = mapScalar((addl.type as string) ?? 'string', addl.format as string | undefined)
    }
  }

  mappingNode.properties = props
  nodes.push(mappingNode)
  return mappingId
}

function mapScalar(type: string, format: string | undefined): string {
  if (type === 'string') {
    if (format === 'uuid') return 'uuid'
    if (format === 'date-time') return 'datetime'
    if (format === 'date') return 'date'
    return 'string'
  }
  if (type === 'integer') return 'integer'
  if (type === 'number') return 'decimal'
  if (type === 'boolean') return 'boolean'
  return 'string'
}

function makeNode(
  template: string,
  component: string,
  specPath: string,
  id: string,
  provenance: CorumInterchangeProvenance | undefined,
  properties: Record<string, unknown>,
): Node {
  return {
    id,
    template,
    component,
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: new Date().toISOString().split('T')[0],
    extractedFrom: specPath,
    derivation: provenance?.derivation === 'inferred' ? 'inferred' : 'determined',
    derivedBy: provenance?.derivedBy ?? 'adapter:corum',
    properties,
  }
}

function makeHasFieldEdge(from: string, to: string): Edge {
  return {
    id: `${from}__has-field__${to}`,
    from,
    to,
    type: 'has-field',
    state: 'implemented',
    stability: 'unstable',
    derivation: 'determined',
    derivedBy: 'adapter:corum',
  }
}

function makeHasValueEdge(from: string, to: string): Edge {
  return {
    id: `${from}__has-value__${to}`,
    from,
    to,
    type: 'has-value',
    state: 'implemented',
    stability: 'unstable',
    derivation: 'determined',
    derivedBy: 'adapter:corum',
  }
}

function mapEdge(raw: CorumInterchangeEdge): Edge {
  return {
    id: `${raw.from}__${raw.type}__${raw.to}`,
    from: raw.from,
    to: raw.to,
    type: raw.type as EdgeType,
    state: 'implemented',
    stability: 'unstable',
    derivation: raw.provenance?.derivation === 'inferred' ? 'inferred' : 'determined',
    derivedBy: raw.provenance?.derivedBy ?? 'adapter:corum',
  }
}
