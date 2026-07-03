import type { Edge, Graph, Node } from '../schema/index.js'
import { getStructuralNodeTemplates, isVisibleEdgeType } from './index.js'
import { getTemplateRole } from './roles.js'
import type { ClusterViewResult } from './index.js'

export type CollapsedField = {
  type?: string
  $ref?: string
  collection?: 'array'
  nullable?: boolean
  items?: CollapsedField       // for type: array
  key?: string                 // for type: map — key primitive type
  value?: CollapsedField       // for type: map — value type
  edges?: Record<string, string[]>
}

export type CollapsedClusterResult = {
  root: Node
  schemas: Record<string, Record<string, CollapsedField>>
  schemaEnums: Record<string, { values: string[] }>
  enums: Record<string, { values: string[] }>
  descendants: Node[]
  edges: Edge[]
  includedNodes: Node[]
}

const FIELD_EDGE_TYPES = new Set(['maps-to', 'derived-from'])

export function collapseClusterSchemas(graph: Graph, cluster: ClusterViewResult): CollapsedClusterResult {
  const rootId = cluster.root.id
  const rootPrefix = `${rootId}.`

  // Indexes keyed by local name or parent ID
  const schemaChildIds = new Set<string>()
  const schemaNames = new Map<string, string>()                        // localName → nodeId
  const enumNames = new Map<string, string>()                          // localName → nodeId
  const fieldsByParentId = new Map<string, Map<string, Node>>()        // parentId → fieldName → Node
  const valuesByEnumId = new Map<string, string[]>()                   // enumId → value names
  const valuesBySchemaId = new Map<string, string[]>()                 // schemaId → value names (enum-like schemas)
  const mappingsByParentId = new Map<string, Map<string, Node>>()      // parentSchemaId → mapName → Node
  const semanticDescendants: Node[] = []

  // Classification is role- and ownership-driven: a node's template role
  // (resolved through the extends chain) decides how it collapses, and its
  // materialised parentId decides where. Section names never matter here, so
  // packs may own schemas/fields under any section name.
  const localName = (n: Node): string => n.id.slice(n.id.lastIndexOf('.') + 1)
  const parentRole = (n: Node): string | undefined => {
    const parent = n.parentId !== undefined ? graph.nodesById.get(n.parentId) : undefined
    return parent ? getTemplateRole(graph.templates, parent.template) : undefined
  }

  for (const n of cluster.descendants) {
    if (!n.id.startsWith(rootPrefix)) {
      semanticDescendants.push(n)
      continue
    }
    const role = getTemplateRole(graph.templates, n.template)

    if (role === 'type-container' && n.parentId === rootId) {
      schemaNames.set(localName(n), n.id)
      schemaChildIds.add(n.id)
      continue
    }

    if (role === 'enum-container' && n.parentId === rootId) {
      enumNames.set(localName(n), n.id)
      schemaChildIds.add(n.id)
      continue
    }

    if (role === 'field' && n.parentId !== undefined) {
      const existing = fieldsByParentId.get(n.parentId) ?? new Map<string, Node>()
      existing.set(localName(n), n)
      fieldsByParentId.set(n.parentId, existing)
      schemaChildIds.add(n.id)
      continue
    }

    if (role === 'value' && n.parentId !== undefined) {
      const owner = parentRole(n)
      if (owner === 'enum-container') {
        const values = valuesByEnumId.get(n.parentId) ?? []
        values.push(typeof n.properties.name === 'string' ? n.properties.name : localName(n))
        valuesByEnumId.set(n.parentId, values)
        schemaChildIds.add(n.id)
        continue
      }
      // Enum-like schemas: value nodes owned directly by a type-container
      if (owner === 'type-container') {
        const values = valuesBySchemaId.get(n.parentId) ?? []
        values.push(typeof n.properties.name === 'string' ? n.properties.name : localName(n))
        valuesBySchemaId.set(n.parentId, values)
        schemaChildIds.add(n.id)
        continue
      }
    }

    if (role === 'mapping' && n.parentId !== undefined && parentRole(n) === 'type-container') {
      const existing = mappingsByParentId.get(n.parentId) ?? new Map<string, Node>()
      existing.set(localName(n), n)
      mappingsByParentId.set(n.parentId, existing)
      schemaChildIds.add(n.id)
      continue
    }

    semanticDescendants.push(n)
  }

  // Build schemas output
  const schemas: Record<string, Record<string, CollapsedField>> = {}
  const schemaEnums: Record<string, { values: string[] }> = {}
  for (const [localName, schemaId] of schemaNames) {
    const fields = fieldsByParentId.get(schemaId) ?? new Map()

    // Enum-like schema: has EnumValue children but no Field children
    const schemaValues = valuesBySchemaId.get(schemaId)
    if (schemaValues && fields.size === 0) {
      schemaEnums[localName] = { values: schemaValues }
      continue
    }

    const mappings = mappingsByParentId.get(schemaId) ?? new Map()
    const entry: Record<string, CollapsedField> = {}
    for (const [fieldName, fieldNode] of fields) {
      entry[fieldName] = buildField(fieldNode, graph, rootId, mappings)
    }
    schemas[localName] = entry
  }

  // Build enums output
  const enums: Record<string, { values: string[] }> = {}
  for (const [localName, enumId] of enumNames) {
    enums[localName] = { values: valuesByEnumId.get(enumId) ?? [] }
  }

  // Filter edges: drop structural/hidden edge types and any edge originating from a schema child
  const filteredEdges = cluster.edges.filter(e => isVisibleEdgeType(graph, e.type) && !schemaChildIds.has(e.from))

  // Filter includedNodes: drop structural template nodes
  const structuralTemplates = getStructuralNodeTemplates(graph)
  const filteredIncludedNodes = cluster.includedNodes.filter(n => !structuralTemplates.has(n.template))

  return {
    root: cluster.root,
    schemas,
    schemaEnums,
    enums,
    descendants: semanticDescendants,
    edges: filteredEdges,
    includedNodes: filteredIncludedNodes,
  }
}

function buildField(
  fieldNode: Node,
  graph: Graph,
  rootId: string,
  parentMappings: Map<string, Node>,
): CollapsedField {
  const props = fieldNode.properties
  const isArray = props.collection === 'array'
  const isNullable = props.nullable === true

  let field: CollapsedField = {}

  const ref = typeof props.$ref === 'string' ? props.$ref : undefined

  // Local refs (#/{section}/{name}) to a sibling mapping node collapse inline.
  // Mapping-ness comes from the collected role-mapping siblings, not from the
  // section name in the ref.
  const localRefMatch = ref !== undefined ? /^#\/[^/]+\/(.+)$/.exec(ref) : null
  const mapNode = localRefMatch ? parentMappings.get(localRefMatch[1]) : undefined
  if (ref !== undefined && mapNode) {
    field = buildMappingField(mapNode, graph, new Set([mapNode.id]))
  } else if (ref) {
    field = { $ref: ref }
    if (isArray) field.collection = 'array'
  } else if (typeof props.type === 'string') {
    field = { type: props.type as string }
    if (isArray) field.collection = 'array'
  }

  if (isNullable) field.nullable = true

  // Gather outbound field edges that cross the cluster boundary
  const clusterPrefix = `${rootId}.`
  const fieldEdges: Record<string, string[]> = {}
  for (const e of graph.edgesByFrom.get(fieldNode.id) ?? []) {
    if (!FIELD_EDGE_TYPES.has(e.type)) continue
    if (e.to.startsWith(clusterPrefix)) continue
    const targets = fieldEdges[e.type] ?? []
    targets.push(e.to)
    fieldEdges[e.type] = targets
  }
  if (Object.keys(fieldEdges).length > 0) field.edges = fieldEdges

  return field
}

function buildMappingField(mapNode: Node, graph: Graph, seen: Set<string>): CollapsedField {
  const props = mapNode.properties
  const key = typeof props['key-type'] === 'string' ? (props['key-type'] as string) : 'string'
  const isArrayValue = props['value-collection'] === 'array'

  let valueField: CollapsedField = {}
  if (typeof props.type === 'string') {
    valueField = { type: props.type as string }
  } else if (typeof props.$ref === 'string') {
    const ref = props.$ref as string
    const refNode = graph.nodesById.get(ref)
    if (refNode && getTemplateRole(graph.templates, refNode.template) === 'mapping' && !seen.has(refNode.id)) {
      seen.add(refNode.id)
      valueField = buildMappingField(refNode, graph, seen)
    } else {
      valueField = { $ref: ref }
    }
  }

  const value: CollapsedField = isArrayValue
    ? { type: 'array', items: valueField }
    : valueField

  return { type: 'map', key, value }
}
