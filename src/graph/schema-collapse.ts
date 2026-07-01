import type { Edge, Graph, Node } from '../schema/index.js'
import { STRUCTURAL_EDGE_TYPES, STRUCTURAL_NODE_TEMPLATES } from './index.js'
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
  const schemaNames = new Map<string, true>()                          // localName → exists
  const enumNames = new Map<string, true>()                            // localName → exists
  const fieldsByParentId = new Map<string, Map<string, Node>>()        // parentId → fieldName → Node
  const valuesByEnumId = new Map<string, string[]>()                   // enumId → value names
  const mappingsByParentId = new Map<string, Map<string, Node>>()      // parentSchemaId → mapName → Node
  const semanticDescendants: Node[] = []

  for (const n of cluster.descendants) {
    if (!n.id.startsWith(rootPrefix)) {
      semanticDescendants.push(n)
      continue
    }
    const suffix = n.id.slice(rootPrefix.length)

    if (n.template === 'Schema') {
      const m = /^schemas\.([^.]+)$/.exec(suffix)
      if (m) { schemaNames.set(m[1], true); schemaChildIds.add(n.id); continue }
    }

    if (n.template === 'EnumDefinition') {
      const m = /^enums\.([^.]+)$/.exec(suffix)
      if (m) { enumNames.set(m[1], true); schemaChildIds.add(n.id); continue }
    }

    if (n.template === 'Field') {
      const m = /^(.+)\.fields\.([^.]+)$/.exec(suffix)
      if (m) {
        const parentId = `${rootId}.${m[1]}`
        const existing = fieldsByParentId.get(parentId) ?? new Map<string, Node>()
        existing.set(m[2], n)
        fieldsByParentId.set(parentId, existing)
        schemaChildIds.add(n.id)
        continue
      }
    }

    if (n.template === 'EnumValue') {
      const m = /^enums\.([^.]+)\.values\.([^.]+)$/.exec(suffix)
      if (m) {
        const enumId = `${rootId}.enums.${m[1]}`
        const values = valuesByEnumId.get(enumId) ?? []
        values.push(typeof n.properties.name === 'string' ? n.properties.name : m[2])
        valuesByEnumId.set(enumId, values)
        schemaChildIds.add(n.id)
        continue
      }
    }

    if (n.template === 'Mapping') {
      const m = /^schemas\.([^.]+)\.mappings\.([^.]+)$/.exec(suffix)
      if (m) {
        const parentId = `${rootId}.schemas.${m[1]}`
        const existing = mappingsByParentId.get(parentId) ?? new Map<string, Node>()
        existing.set(m[2], n)
        mappingsByParentId.set(parentId, existing)
        schemaChildIds.add(n.id)
        continue
      }
    }

    semanticDescendants.push(n)
  }

  // Build schemas output
  const schemas: Record<string, Record<string, CollapsedField>> = {}
  for (const localName of schemaNames.keys()) {
    const schemaId = `${rootId}.schemas.${localName}`
    const fields = fieldsByParentId.get(schemaId) ?? new Map()
    const mappings = mappingsByParentId.get(schemaId) ?? new Map()
    const entry: Record<string, CollapsedField> = {}
    for (const [fieldName, fieldNode] of fields) {
      entry[fieldName] = buildField(fieldNode, graph, rootId, mappings)
    }
    schemas[localName] = entry
  }

  // Build enums output
  const enums: Record<string, { values: string[] }> = {}
  for (const localName of enumNames.keys()) {
    const enumId = `${rootId}.enums.${localName}`
    enums[localName] = { values: valuesByEnumId.get(enumId) ?? [] }
  }

  // Filter edges: drop structural edge types and any edge originating from a schema child
  const filteredEdges = cluster.edges.filter(e => !STRUCTURAL_EDGE_TYPES.has(e.type) && !schemaChildIds.has(e.from))

  // Filter includedNodes: drop structural template nodes
  const filteredIncludedNodes = cluster.includedNodes.filter(n => !STRUCTURAL_NODE_TEMPLATES.has(n.template))

  return {
    root: cluster.root,
    schemas,
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

  if (ref?.startsWith('#/mappings/')) {
    const mapName = ref.slice('#/mappings/'.length)
    const mapNode = parentMappings.get(mapName)
    if (mapNode) {
      field = buildMappingField(mapNode, graph)
    } else {
      field = { $ref: ref }
    }
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

function buildMappingField(mapNode: Node, graph: Graph): CollapsedField {
  const props = mapNode.properties
  const key = typeof props['key-type'] === 'string' ? (props['key-type'] as string) : 'string'
  const isArrayValue = props['value-collection'] === 'array'

  let valueField: CollapsedField = {}
  if (typeof props.type === 'string') {
    valueField = { type: props.type as string }
  } else if (typeof props.$ref === 'string') {
    const ref = props.$ref as string
    const refNode = graph.nodesById.get(ref)
    if (refNode?.template === 'Mapping') {
      // Nested mapping — recurse once (no further recursion guard needed for realistic depths)
      valueField = buildMappingField(refNode, graph)
    } else {
      valueField = { $ref: ref }
    }
  }

  const value: CollapsedField = isArrayValue
    ? { type: 'array', items: valueField }
    : valueField

  return { type: 'map', key, value }
}
