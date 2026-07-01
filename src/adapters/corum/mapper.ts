import type { Diagnostic, Edge, EdgeType, Node } from '../../schema/index.js'
import type { CorumInterchangeDocument, CorumInterchangeEdge, CorumInterchangeProvenance } from './parser.js'

const VALID_EDGE_TYPES = new Set<string>([
  'triggers', 'produces', 'reads', 'calls', 'implements',
  'maps-to', 'derived-from', 'renamed-from', 'has-field', 'has-value',
])
const UNRESOLVED_COMPONENT = '_unresolved'

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

type SchemaUsage = {
  rootsBySchema: Map<string, Set<string>>
  directEdgeSchemas: Set<string>
}

type SchemaOwnership =
  | { kind: 'inline'; rootNodeId: string; component: string }
  | { kind: 'shared'; component: string }
  | { kind: 'unused' }
  | { kind: 'unresolved' }

export function mapDocument(document: CorumInterchangeDocument, specPath: string): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const allSchemas = (document.components?.schemas ?? {}) as Record<string, unknown>
  // Maps #/components/schemas/X and #/components/schemas/X/properties/Y to materialized node IDs
  const refToNodeId = new Map<string, string>()
  const rootNodeIds = getRootNodeIds(document.nodes)
  // Pre-pass: determine canonical component for each schema (shared if referenced by 2+ components)
  const schemaComponents = computeSchemaComponents(document, allSchemas)
  const schemaUsage = computeSchemaUsage(document, allSchemas, rootNodeIds)

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

    const normalizedNodeId = normalizeNodeId(nodeId)
    const component = componentFromNodeId(normalizedNodeId)
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

    const node = makeNode(entry.type, component, specPath, normalizedNodeId, entry.provenance, properties)
    nodes.push(node)

    if (schemaName) {
      const expanded = new Map<string, string>()
      expandSchema(schemaName, normalizedNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId, schemaComponents)
    }
  }

  for (const schemaName of Object.keys(allSchemas)) {
    const schemaRef = `#/components/schemas/${schemaName}`
    if (refToNodeId.has(schemaRef)) continue

    const ownership = determineSchemaOwnership(schemaName, schemaUsage)
    if (ownership.kind === 'unused') {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        message: `Skipping unused schema '${schemaName}' because no node or edge refers to it`,
      })
      continue
    }

    if (ownership.kind === 'unresolved') {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        message: `Schema '${schemaName}' is only referenced by unresolved schema edges; keeping it under ${UNRESOLVED_COMPONENT}`,
      })
      materializeStandaloneSchema(schemaName, UNRESOLVED_COMPONENT, allSchemas, nodes, edges, specPath, refToNodeId, schemaComponents)
      continue
    }

    if (ownership.kind === 'inline') {
      expandSchema(schemaName, ownership.rootNodeId, allSchemas, nodes, edges, specPath, ownership.component, new Map(), refToNodeId, schemaComponents)
      continue
    }

    materializeStandaloneSchema(schemaName, ownership.component, allSchemas, nodes, edges, specPath, refToNodeId, schemaComponents)
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
    const from = refToNodeId.get(raw.from) ?? refToNodeIdLower.get(raw.from.toLowerCase()) ?? normalizeNodeId(raw.from)
    const to = refToNodeId.get(raw.to) ?? refToNodeIdLower.get(raw.to.toLowerCase()) ?? normalizeNodeId(raw.to)
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

// Pre-pass: walk every node's schema tree to determine which component each schema belongs to.
// If a schema is referenced by nodes in 2+ different components it is assigned 'shared'.
function computeSchemaComponents(
  document: CorumInterchangeDocument,
  allSchemas: Record<string, unknown>,
): Map<string, string> {
  const result = new Map<string, string>()

  for (const [nodeId, entry] of Object.entries(document.nodes)) {
    const rootName = entry.schema?.$ref ? schemaRefName(entry.schema.$ref) : undefined
    if (!rootName) continue
    const component = componentFromNodeId(normalizeNodeId(nodeId))
    const visited = new Set<string>()
    collectSchemaRefNames(rootName, allSchemas, visited)
    for (const name of visited) {
      const existing = result.get(name)
      if (!existing) result.set(name, component)
      else if (existing !== component) result.set(name, 'shared')
    }
  }

  return result
}

function getRootNodeIds(nodes: Record<string, CorumInterchangeDocument['nodes'][string]>): string[] {
  const nodeIds = Object.keys(nodes).map(normalizeNodeId)
  return nodeIds
    .filter(nodeId => !nodeIds.some(other => other !== nodeId && nodeId.startsWith(`${other}.`)))
    .sort((a, b) => b.length - a.length)
}

function computeSchemaUsage(
  document: CorumInterchangeDocument,
  allSchemas: Record<string, unknown>,
  rootNodeIds: string[],
): SchemaUsage {
  const usage: SchemaUsage = {
    rootsBySchema: new Map(),
    directEdgeSchemas: new Set(),
  }
  const schemaLinks = new Map<string, Set<string>>()

  for (const [nodeId, entry] of Object.entries(document.nodes)) {
    const rootName = entry.schema?.$ref ? schemaRefName(entry.schema.$ref) : undefined
    if (!rootName) continue
    const normalizedNodeId = normalizeNodeId(nodeId)
    const visited = new Set<string>()
    collectSchemaRefNames(rootName, allSchemas, visited)
    for (const name of visited) addSchemaUsage(usage, name, normalizedNodeId)
  }

  for (const [schemaName, rawSchema] of Object.entries(allSchemas)) {
    for (const refName of collectDirectSchemaRefs(rawSchema)) {
      addSchemaLink(schemaLinks, schemaName, refName)
    }
  }

  for (const edge of document.edges ?? []) {
    const fromSchema = extractSchemaName(edge.from)
    const toSchema = extractSchemaName(edge.to)

    if (fromSchema && toSchema) {
      usage.directEdgeSchemas.add(fromSchema)
      usage.directEdgeSchemas.add(toSchema)
      addSchemaLink(schemaLinks, fromSchema, toSchema)
      continue
    }

    if (fromSchema) {
      usage.directEdgeSchemas.add(fromSchema)
      const owner = resolveOwningRootNodeId(normalizeNodeId(edge.to), rootNodeIds)
      if (owner) addSchemaUsage(usage, fromSchema, owner)
    }

    if (toSchema) {
      usage.directEdgeSchemas.add(toSchema)
      const owner = resolveOwningRootNodeId(normalizeNodeId(edge.from), rootNodeIds)
      if (owner) addSchemaUsage(usage, toSchema, owner)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [schemaName, linkedNames] of schemaLinks) {
      const ownUsage = usage.rootsBySchema.get(schemaName)
      if (!ownUsage) continue
      for (const linkedName of linkedNames) {
        const beforeSize = usage.rootsBySchema.get(linkedName)?.size ?? 0
        for (const rootNodeId of ownUsage) addSchemaUsage(usage, linkedName, rootNodeId)
        if ((usage.rootsBySchema.get(linkedName)?.size ?? 0) !== beforeSize) changed = true
      }
    }
  }

  return usage
}

function collectSchemaRefNames(
  schemaName: string,
  allSchemas: Record<string, unknown>,
  visited: Set<string>,
): void {
  if (visited.has(schemaName)) return
  visited.add(schemaName)
  const def = allSchemas[schemaName] as { properties?: Record<string, unknown>; items?: unknown } | undefined
  for (const prop of Object.values(def?.properties ?? {})) {
    const p = prop as Record<string, unknown>
    const ref = typeof p.$ref === 'string' ? schemaRefName(p.$ref) : undefined
    if (ref) collectSchemaRefNames(ref, allSchemas, visited)
    if (p.type === 'array') {
      const items = p.items as Record<string, unknown> | undefined
      const itemRef = items && typeof items.$ref === 'string' ? schemaRefName(items.$ref) : undefined
      if (itemRef) collectSchemaRefNames(itemRef, allSchemas, visited)
    }
  }
}

function collectDirectSchemaRefs(value: unknown): Set<string> {
  const refs = new Set<string>()
  collectDirectSchemaRefsInto(value, refs)
  return refs
}

function collectDirectSchemaRefsInto(value: unknown, refs: Set<string>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectDirectSchemaRefsInto(item, refs)
    return
  }

  const record = value as Record<string, unknown>
  const refName = typeof record.$ref === 'string' ? schemaRefName(record.$ref) : undefined
  if (refName) refs.add(refName)

  collectDirectSchemaRefsInto(record.properties, refs)
  collectDirectSchemaRefsInto(record.items, refs)
  collectDirectSchemaRefsInto(record.additionalProperties, refs)
  collectDirectSchemaRefsInto(record.allOf, refs)
  collectDirectSchemaRefsInto(record.anyOf, refs)
  collectDirectSchemaRefsInto(record.oneOf, refs)
}

function addSchemaUsage(usage: SchemaUsage, schemaName: string, rootNodeId: string): void {
  const roots = usage.rootsBySchema.get(schemaName) ?? new Set<string>()
  roots.add(rootNodeId)
  usage.rootsBySchema.set(schemaName, roots)
}

function addSchemaLink(schemaLinks: Map<string, Set<string>>, from: string, to: string): void {
  if (from === to) return
  const fromSet = schemaLinks.get(from) ?? new Set<string>()
  fromSet.add(to)
  schemaLinks.set(from, fromSet)
}

function resolveOwningRootNodeId(nodeId: string, rootNodeIds: string[]): string | undefined {
  if (nodeId.startsWith('#/')) return undefined
  return rootNodeIds.find(rootNodeId => nodeId === rootNodeId || nodeId.startsWith(`${rootNodeId}.`))
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

function normalizeNodeId(nodeId: string): string {
  if (nodeId.startsWith('#/')) return nodeId
  const parts = nodeId.split('.')
  if (parts.length === 0) return nodeId
  parts[0] = normalizeComponent(parts[0])
  return parts.join('.')
}

function componentFromNodeId(nodeId: string): string {
  return normalizeComponent(nodeId.split('.')[0] ?? '')
}

function normalizeComponent(component: string): string {
  return component === '_' || component.trim() === '' ? UNRESOLVED_COMPONENT : component
}

function determineSchemaOwnership(schemaName: string, usage: SchemaUsage): SchemaOwnership {
  const rootNodeIds = [...(usage.rootsBySchema.get(schemaName) ?? [])]
  if (rootNodeIds.length === 0) {
    return usage.directEdgeSchemas.has(schemaName) ? { kind: 'unresolved' } : { kind: 'unused' }
  }
  if (rootNodeIds.length === 1) {
    return {
      kind: 'inline',
      rootNodeId: rootNodeIds[0],
      component: componentFromNodeId(rootNodeIds[0]),
    }
  }

  const components = new Set(rootNodeIds.map(componentFromNodeId))
  return {
    kind: 'shared',
    component: components.size === 1 ? [...components][0] : 'shared',
  }
}

function localSchemaName(schemaName: string): string {
  return schemaName.includes('.')
    ? schemaName.slice(schemaName.lastIndexOf('.') + 1)
    : schemaName
}

function materializeStandaloneSchema(
  schemaName: string,
  component: string,
  allSchemas: Record<string, unknown>,
  nodes: Node[],
  edges: Edge[],
  specPath: string,
  refToNodeId: Map<string, string>,
  schemaComponents: Map<string, string>,
): string {
  const schemaLocalName = localSchemaName(schemaName)
  const schemaDef = allSchemas[schemaName] as { type?: string; properties?: Record<string, unknown>; required?: string[]; enum?: unknown[] } | undefined
  const isEnumSchema = Array.isArray(schemaDef?.enum) && !schemaDef?.properties
  const template = isEnumSchema ? 'EnumDefinition' : 'Schema'
  const schemaId = `${component}.${template}.${schemaLocalName}`
  const schemaRef = `#/components/schemas/${schemaName}`

  if (refToNodeId.has(schemaRef)) return refToNodeId.get(schemaRef)!
  refToNodeId.set(schemaRef, schemaId)

  nodes.push(makeNode(template, component, specPath, schemaId, undefined, {}))

  if (isEnumSchema) {
    for (const value of schemaDef.enum!) {
      if (typeof value !== 'string') continue
      const valueId = `${schemaId}.values.${value}`
      refToNodeId.set(`${schemaRef}/properties/${value}`, valueId)
      nodes.push(makeNode('EnumValue', component, specPath, valueId, undefined, { value }))
      edges.push(makeHasValueEdge(schemaId, valueId))
    }
    return schemaId
  }

  const expanded = new Map<string, string>([[schemaName, schemaId]])
  const localMappings = new Map<string, string>()
  for (const [fieldName, rawProp] of Object.entries(schemaDef?.properties ?? {})) {
    const fieldId = `${schemaId}.fields.${fieldName}`
    const fieldRef = `${schemaRef}/properties/${fieldName}`
    if (!refToNodeId.has(fieldRef)) refToNodeId.set(fieldRef, fieldId)

    const fieldNode = makeNode('Field', component, specPath, fieldId, undefined, {})
    const required = Array.isArray(schemaDef?.required) && schemaDef.required.includes(fieldName)
    fieldNode.properties = resolveFieldProperties(
      fieldName, rawProp as Record<string, unknown>, required,
      schemaId, schemaId, allSchemas, nodes, edges, specPath, component, expanded, localMappings, refToNodeId, schemaComponents,
    )

    nodes.push(fieldNode)
    edges.push(makeHasFieldEdge(schemaId, fieldId))
  }

  return schemaId
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
  schemaComponents: Map<string, string> = new Map(),
): string {
  const existing = expanded.get(schemaName)
  if (existing) return existing

  // Schema names from corum extractors are sometimes prefixed with the component name
  // (e.g. "workers.ReactToPersonCreatedCommand"). Strip the prefix so the local segment
  // in the node ID is a simple identifier — graph serialization rejects local names
  // that contain dots because it uses dots as a hierarchy separator.
  const schemaLocalName = localSchemaName(schemaName)

  const schemaDef = allSchemas[schemaName] as { type?: string; properties?: Record<string, unknown>; required?: string[]; enum?: unknown[] } | undefined
  const isEnumSchema = Array.isArray(schemaDef?.enum) && !schemaDef?.properties

  const schemaRef = `#/components/schemas/${schemaName}`

  if (isEnumSchema) {
    // Enum schemas become standalone EnumDefinition cluster roots, matching the OpenAPI/AsyncAPI
    // adapters. Using refToNodeId as shared dedup so only one node is created per mapDocument call
    // even though `expanded` is scoped per parent node.
    const enumComponent = schemaComponents.get(schemaName) ?? component
    const enumId = `${enumComponent}.EnumDefinition.${schemaLocalName}`
    expanded.set(schemaName, enumId)
    if (!refToNodeId.has(schemaRef)) {
      refToNodeId.set(schemaRef, enumId)
      nodes.push(makeNode('EnumDefinition', enumComponent, specPath, enumId, undefined, {}))
      for (const value of schemaDef.enum!) {
        if (typeof value !== 'string') continue
        const valueId = `${enumId}.values.${value}`
        refToNodeId.set(`${schemaRef}/properties/${value}`, valueId)
        nodes.push(makeNode('EnumValue', enumComponent, specPath, valueId, undefined, { value }))
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
      schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings, refToNodeId, schemaComponents,
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
  schemaComponents: Map<string, string>,
): Record<string, unknown> {
  const nullable = !required

  if (typeof prop.$ref === 'string') {
    const refName = schemaRefName(prop.$ref)
    if (refName) {
      const refId = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId, schemaComponents)
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
        const refId = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId, schemaComponents)
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
    createMapping(fieldName, prop.additionalProperties, schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings, refToNodeId, schemaComponents)
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
  schemaComponents: Map<string, string>,
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
        props.$ref = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId, schemaComponents)
      } else {
        props.type = 'string'
      }
    } else if (addl.type === 'array') {
      props['value-collection'] = 'array'
      const items = addl.items as Record<string, unknown> | undefined
      if (items && typeof items.$ref === 'string') {
        const refName = schemaRefName(items.$ref as string)
        if (refName) {
          props.$ref = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, refToNodeId, schemaComponents)
        } else {
          props.type = 'string'
        }
      } else {
        props.type = mapScalar((items?.type as string) ?? 'string', items?.format as string | undefined)
      }
    } else if (addl.type === 'object' && addl.additionalProperties !== undefined) {
      const innerName = `${mappingName}-values`
      props.$ref = createMapping(innerName, addl.additionalProperties, schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings, refToNodeId, schemaComponents)
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
