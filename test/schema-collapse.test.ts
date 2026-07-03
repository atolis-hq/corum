import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { collapseClusterSchemas } from '../src/graph/schema-collapse.js'
import type { Edge, Graph, Node, Template } from '../src/schema/index.js'
import type { ClusterViewResult } from '../src/graph/index.js'

// Collapse is role-driven: templates declare capability roles, and loaded
// nodes carry parentId. Mirror what the loader produces.
const TEMPLATES = new Map<string, Template>([
  ['DomainModel', { name: 'DomainModel', info: { version: '1' } }],
  ['Schema', { name: 'Schema', info: { version: '1', role: 'type-container' } }],
  ['EnumDefinition', { name: 'EnumDefinition', info: { version: '1', role: 'enum-container' } }],
  ['Field', { name: 'Field', info: { version: '1', role: 'field' } }],
  ['EnumValue', { name: 'EnumValue', info: { version: '1', role: 'value' } }],
  ['Mapping', { name: 'Mapping', info: { version: '1', role: 'mapping' } }],
  ['APIEndpoint', { name: 'APIEndpoint', info: { version: '1' } }],
])

function node(id: string, template: string, properties: Record<string, unknown> = {}): Node {
  const parts = id.split('.')
  const parentId = parts.length > 3 ? parts.slice(0, -2).join('.') : undefined
  return { id, ...(parentId !== undefined && { parentId }), template, component: 'test', state: 'agreed', stability: 'stable', schemaVersion: '1', lastModifiedAt: '2026-07-01', properties }
}

function edge(from: string, to: string, type: Edge['type']): Edge {
  return { id: `${from}__${type}__${to}`, from, to, type, state: 'agreed', stability: 'stable' }
}

function graph(nodes: Node[], edges: Edge[] = []): Graph {
  const nodesById = new Map(nodes.map(n => [n.id, n]))
  const edgesByFrom = new Map<string, Edge[]>()
  const edgesByTo = new Map<string, Edge[]>()
  for (const e of edges) {
    const f = edgesByFrom.get(e.from) ?? []; f.push(e); edgesByFrom.set(e.from, f)
    const t = edgesByTo.get(e.to) ?? []; t.push(e); edgesByTo.set(e.to, t)
  }
  return { nodesById, edgesByFrom, edgesByTo, templates: TEMPLATES, diagnostics: [] }
}

function cluster(root: Node, descendants: Node[], edges: Edge[] = [], includedNodes: Node[] = []): ClusterViewResult {
  return { root, descendants, includedNodes, edges }
}

const ROOT = 'test.DomainModel.Order'

describe('collapseClusterSchemas', () => {
  describe('schemas block', () => {
    it('collapses schema node and its fields into schemas block', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.order`, 'Schema')
      const field = node(`${ROOT}.schemas.order.fields.id`, 'Field', { type: 'uuid', nullable: false })
      const g = graph([root, schema, field])
      const c = cluster(root, [schema, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas, { order: { id: { type: 'uuid' } } })
    })

    it('includes nullable: true only when field is nullable', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const f1 = node(`${ROOT}.schemas.s.fields.id`, 'Field', { type: 'uuid', nullable: false })
      const f2 = node(`${ROOT}.schemas.s.fields.notes`, 'Field', { type: 'string', nullable: true })
      const g = graph([root, schema, f1, f2])
      const c = cluster(root, [schema, f1, f2])

      const result = collapseClusterSchemas(g, c)

      assert.ok(!('nullable' in result.schemas['s']['id']))
      assert.equal(result.schemas['s']['notes'].nullable, true)
    })

    it('preserves local schema $ref on field', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const field = node(`${ROOT}.schemas.s.fields.item`, 'Field', { $ref: '#/schemas/item', nullable: false })
      const g = graph([root, schema, field])
      const c = cluster(root, [schema, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['item'], { $ref: '#/schemas/item' })
    })

    it('preserves local enum $ref on field', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const field = node(`${ROOT}.schemas.s.fields.status`, 'Field', { $ref: '#/enums/status', nullable: false })
      const g = graph([root, schema, field])
      const c = cluster(root, [schema, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['status'], { $ref: '#/enums/status' })
    })

    it('includes collection: array only when field is an array', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const f1 = node(`${ROOT}.schemas.s.fields.items`, 'Field', { $ref: '#/schemas/item', nullable: false, collection: 'array' })
      const f2 = node(`${ROOT}.schemas.s.fields.single`, 'Field', { $ref: '#/schemas/item', nullable: false, collection: 'one' })
      const g = graph([root, schema, f1, f2])
      const c = cluster(root, [schema, f1, f2])

      const result = collapseClusterSchemas(g, c)

      assert.equal(result.schemas['s']['items'].collection, 'array')
      assert.ok(!('collection' in result.schemas['s']['single']))
    })

    it('preserves global node $ref on field', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const field = node(`${ROOT}.schemas.s.fields.address`, 'Field', { $ref: 'shared.DomainModel.Address', nullable: false })
      const g = graph([root, schema, field])
      const c = cluster(root, [schema, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['address'], { $ref: 'shared.DomainModel.Address' })
    })

    it('emits multiple schemas as named entries', () => {
      const root = node(ROOT, 'DomainModel')
      const s1 = node(`${ROOT}.schemas.request`, 'Schema')
      const s2 = node(`${ROOT}.schemas.response`, 'Schema')
      const f1 = node(`${ROOT}.schemas.request.fields.name`, 'Field', { type: 'string', nullable: false })
      const f2 = node(`${ROOT}.schemas.response.fields.id`, 'Field', { type: 'uuid', nullable: false })
      const g = graph([root, s1, s2, f1, f2])
      const c = cluster(root, [s1, s2, f1, f2])

      const result = collapseClusterSchemas(g, c)

      assert.ok('request' in result.schemas)
      assert.ok('response' in result.schemas)
      assert.ok('name' in result.schemas['request'])
      assert.ok('id' in result.schemas['response'])
    })
  })

  describe('enums block', () => {
    it('collapses enum definition and values into enums block', () => {
      const root = node(ROOT, 'DomainModel')
      const enumDef = node(`${ROOT}.enums.status`, 'EnumDefinition')
      const v1 = node(`${ROOT}.enums.status.values.active`, 'EnumValue', { name: 'ACTIVE' })
      const v2 = node(`${ROOT}.enums.status.values.inactive`, 'EnumValue', { name: 'INACTIVE' })
      const g = graph([root, enumDef, v1, v2])
      const c = cluster(root, [enumDef, v1, v2])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.enums, { status: { values: ['ACTIVE', 'INACTIVE'] } })
    })

    it('falls back to the value key when name property is absent', () => {
      const root = node(ROOT, 'DomainModel')
      const enumDef = node(`${ROOT}.enums.status`, 'EnumDefinition')
      const v = node(`${ROOT}.enums.status.values.active`, 'EnumValue', {})
      const g = graph([root, enumDef, v])
      const c = cluster(root, [enumDef, v])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.enums['status'].values, ['active'])
    })

    it('produces empty enums block when no enums present', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const g = graph([root, schema])
      const c = cluster(root, [schema])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.enums, {})
    })

    it('inlines enum values into schemaEnums block when EnumValue nodes appear under schemas path', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.PayRunStatus`, 'Schema')
      const v1 = node(`${ROOT}.schemas.PayRunStatus.values.draft`, 'EnumValue', { name: 'Draft' })
      const v2 = node(`${ROOT}.schemas.PayRunStatus.values.finalised`, 'EnumValue', { name: 'Finalised' })
      const g = graph([root, schema, v1, v2])
      const c = cluster(root, [schema, v1, v2])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemaEnums['PayRunStatus'], { values: ['Draft', 'Finalised'] })
      assert.ok(!('PayRunStatus' in result.schemas))
      assert.deepEqual(result.enums, {})
    })

    it('falls back to value key for enum-like schema when name property is absent', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.Status`, 'Schema')
      const v = node(`${ROOT}.schemas.Status.values.active`, 'EnumValue', {})
      const g = graph([root, schema, v])
      const c = cluster(root, [schema, v])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemaEnums['Status'], { values: ['active'] })
    })
  })

  describe('descendants and edges', () => {
    it('removes schema children from descendants', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const field = node(`${ROOT}.schemas.s.fields.id`, 'Field', { type: 'uuid', nullable: false })
      const enumDef = node(`${ROOT}.enums.status`, 'EnumDefinition')
      const enumVal = node(`${ROOT}.enums.status.values.active`, 'EnumValue', { name: 'ACTIVE' })
      const op = node(`${ROOT}.operations.create`, 'DomainOperation')
      const g = graph([root, schema, field, enumDef, enumVal, op])
      const c = cluster(root, [schema, field, enumDef, enumVal, op])

      const result = collapseClusterSchemas(g, c)

      assert.equal(result.descendants.length, 1)
      assert.equal(result.descendants[0].id, op.id)
    })

    it('removes edges where from is a schema child', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const field = node(`${ROOT}.schemas.s.fields.id`, 'Field', { type: 'uuid', nullable: false })
      const hasFieldEdge = edge(root.id, schema.id, 'has-field')
      const fieldEdge = edge(schema.id, field.id, 'has-field')
      const g = graph([root, schema, field], [hasFieldEdge, fieldEdge])
      const c = cluster(root, [schema, field], [hasFieldEdge, fieldEdge])

      const result = collapseClusterSchemas(g, c)

      assert.equal(result.edges.length, 0)
    })

    it('keeps edges where from is the root or a semantic descendant', () => {
      const root = node(ROOT, 'DomainModel')
      const op = node(`${ROOT}.operations.place`, 'DomainOperation')
      const event = node('test.DomainEvent.OrderPlaced', 'DomainEvent')
      const producesEdge = edge(op.id, event.id, 'produces')
      const g = graph([root, op, event], [producesEdge])
      const c = cluster(root, [op], [producesEdge])

      const result = collapseClusterSchemas(g, c)

      assert.equal(result.edges.length, 1)
      assert.equal(result.edges[0].id, producesEdge.id)
    })

    it('removes structural template nodes from includedNodes', () => {
      const root = node(ROOT, 'DomainModel')
      const externalField = node('other.DomainModel.X.schemas.x.fields.id', 'Field', { type: 'uuid', nullable: false })
      const externalModel = node('other.DomainModel.X', 'DomainModel')
      const g = graph([root, externalField, externalModel])
      const c = cluster(root, [], [], [externalField, externalModel])

      const result = collapseClusterSchemas(g, c)

      assert.equal(result.includedNodes.length, 1)
      assert.equal(result.includedNodes[0].id, externalModel.id)
    })
  })

  describe('field edges', () => {
    it('annotates outbound maps-to edges from graph on collapsed field', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const field = node(`${ROOT}.schemas.s.fields.id`, 'Field', { type: 'uuid', nullable: false })
      const externalFieldId = 'other.DomainModel.Y.schemas.y.fields.xId'
      const mapsToEdge = edge(field.id, externalFieldId, 'maps-to')
      const g = graph([root, schema, field], [mapsToEdge])
      const c = cluster(root, [schema, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['id'].edges, { 'maps-to': [externalFieldId] })
    })

    it('annotates derived-from edges on collapsed field', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const field = node(`${ROOT}.schemas.s.fields.name`, 'Field', { type: 'string', nullable: false })
      const externalFieldId = 'other.DomainModel.Y.schemas.y.fields.displayName'
      const derivedEdge = edge(field.id, externalFieldId, 'derived-from')
      const g = graph([root, schema, field], [derivedEdge])
      const c = cluster(root, [schema, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['name'].edges, { 'derived-from': [externalFieldId] })
    })

    it('omits field edges where target is within the same cluster', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const f1 = node(`${ROOT}.schemas.s.fields.id`, 'Field', { type: 'uuid', nullable: false })
      const f2 = node(`${ROOT}.schemas.t.fields.refId`, 'Field', { type: 'uuid', nullable: false })
      const intraEdge = edge(f1.id, f2.id, 'maps-to')
      const g = graph([root, schema, f1, f2], [intraEdge])
      const c = cluster(root, [schema, f1, f2])

      const result = collapseClusterSchemas(g, c)

      assert.ok(!result.schemas['s']['id'].edges)
    })
  })

  describe('mapping fields', () => {
    it('renders a schema-owned mapping as type: map with key and value', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const mapNode = node(`${ROOT}.schemas.s.mappings.metadata`, 'Mapping', { type: 'string' })
      const field = node(`${ROOT}.schemas.s.fields.metadata`, 'Field', { $ref: '#/mappings/metadata', nullable: false })
      const g = graph([root, schema, mapNode, field])
      const c = cluster(root, [schema, mapNode, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['metadata'], {
        type: 'map',
        key: 'string',
        value: { type: 'string' },
      })
    })

    it('renders a mapping with explicit key-type', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const mapNode = node(`${ROOT}.schemas.s.mappings.byId`, 'Mapping', { 'key-type': 'uuid', type: 'integer' })
      const field = node(`${ROOT}.schemas.s.fields.byId`, 'Field', { $ref: '#/mappings/byId', nullable: false })
      const g = graph([root, schema, mapNode, field])
      const c = cluster(root, [schema, mapNode, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['byId'], {
        type: 'map',
        key: 'uuid',
        value: { type: 'integer' },
      })
    })

    it('renders a mapping with value-collection: array as map with array value', () => {
      const root = node(ROOT, 'DomainModel')
      const schema = node(`${ROOT}.schemas.s`, 'Schema')
      const mapNode = node(`${ROOT}.schemas.s.mappings.grouped`, 'Mapping', { 'value-collection': 'array', $ref: 'other.Schema.Item' })
      const field = node(`${ROOT}.schemas.s.fields.grouped`, 'Field', { $ref: '#/mappings/grouped', nullable: false })
      const g = graph([root, schema, mapNode, field])
      const c = cluster(root, [schema, mapNode, field])

      const result = collapseClusterSchemas(g, c)

      assert.deepEqual(result.schemas['s']['grouped'], {
        type: 'map',
        key: 'string',
        value: { type: 'array', items: { $ref: 'other.Schema.Item' } },
      })
    })
  })
})
