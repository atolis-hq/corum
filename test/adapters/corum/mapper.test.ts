import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapDocument } from '../../../src/adapters/corum/mapper.js'
import type { CorumInterchangeDocument } from '../../../src/adapters/corum/parser.js'

const SPEC_PATH = '/fake/output.corum.yaml'

function makeDoc(overrides: Partial<CorumInterchangeDocument> = {}): CorumInterchangeDocument {
  return {
    corum: '1.0',
    nodes: {},
    ...overrides,
  }
}

describe('mapDocument — nodes (basic)', () => {
  it('maps a determined node', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          title: 'OrderPlaced',
          provenance: { derivation: 'determined', derivedBy: 'extractor:treesitter' },
        },
      },
    })
    const { nodes, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 1)
    const n = nodes[0]
    assert.equal(n.id, 'orders.DomainEvent.OrderPlaced')
    assert.equal(n.template, 'DomainEvent')
    assert.equal(n.component, 'orders')
    assert.equal(n.state, 'implemented')
    assert.equal(n.stability, 'unstable')
    assert.equal(n.schemaVersion, '1')
    assert.equal(n.derivation, 'determined')
    assert.equal(n.derivedBy, 'extractor:treesitter')
    assert.equal(n.extractedFrom, SPEC_PATH)
    assert.deepEqual(n.properties, { description: 'OrderPlaced' })
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('maps an inferred node', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainModel.OrderAggregate.operations.Place': {
          type: 'DomainOperation',
          title: 'Place',
          provenance: { derivation: 'inferred', derivedBy: 'extractor:treesitter' },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'inferred')
  })

  it('defaults derivation to determined and derivedBy to adapter:corum when provenance absent', () => {
    const doc = makeDoc({
      nodes: { 'orders.DomainEvent.OrderPlaced': { type: 'DomainEvent' } },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'determined')
    assert.equal(nodes[0].derivedBy, 'adapter:corum')
  })

  it('sets description from title when no schema ref', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainModel.OrderAggregate': {
          type: 'DomainModel',
          title: 'OrderAggregate',
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.deepEqual(nodes[0].properties, { description: 'OrderAggregate' })
  })

  it('does not set description when schema ref is present', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          title: 'OrderPlaced',
          schema: { $ref: '#/components/schemas/OrderPlaced' },
        },
      },
      components: {
        schemas: {
          OrderPlaced: { type: 'object', properties: {} },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const root = nodes.find(n => n.id === 'orders.DomainEvent.OrderPlaced')!
    assert.ok(!('description' in root.properties))
    assert.equal(root.properties.schema, 'OrderPlaced')
  })

  it('emits a warning and skips nodes missing type', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': { type: '' },
      },
    })
    const { nodes, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning'))
  })

  it('passes x-aka through to node properties', () => {
    const doc = makeDoc({
      nodes: {
        'billing.APIEndpoint.GetInvoiceController': {
          type: 'APIEndpoint',
          'x-aka': ['GetInvoice'],
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.deepEqual(nodes[0].properties['x-aka'], ['GetInvoice'])
  })

  it('does not set x-aka property when absent', () => {
    const doc = makeDoc({
      nodes: {
        'billing.APIEndpoint.GetInvoiceController': {
          type: 'APIEndpoint',
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.ok(!('x-aka' in nodes[0].properties))
  })
})

describe('mapDocument — schema expansion', () => {
  it('creates Schema and Field nodes from components.schemas', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          schema: { $ref: '#/components/schemas/OrderPlaced' },
        },
      },
      components: {
        schemas: {
          OrderPlaced: {
            type: 'object',
            required: ['OrderId'],
            properties: {
              OrderId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    })
    const { nodes, edges } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 3)

    const rootNode = nodes[0]
    assert.equal(rootNode.id, 'orders.DomainEvent.OrderPlaced')
    assert.equal(rootNode.template, 'DomainEvent')
    assert.deepEqual(rootNode.properties, { schema: 'OrderPlaced' })

    const schemaNode = nodes[1]
    assert.equal(schemaNode.id, 'orders.DomainEvent.OrderPlaced.schemas.OrderPlaced')
    assert.equal(schemaNode.template, 'Schema')

    const fieldNode = nodes[2]
    assert.equal(fieldNode.id, 'orders.DomainEvent.OrderPlaced.schemas.OrderPlaced.fields.OrderId')
    assert.equal(fieldNode.template, 'Field')
    assert.deepEqual(fieldNode.properties, { type: 'uuid', nullable: false, collection: 'one' })

    const hasFieldEdge = edges.find(e => e.from === 'orders.DomainEvent.OrderPlaced.schemas.OrderPlaced' && e.to === fieldNode.id)
    assert.ok(hasFieldEdge)
    assert.equal(hasFieldEdge!.type, 'has-field')
  })

  it('marks fields nullable when not in required', () => {
    const doc = makeDoc({
      nodes: {
        'orders.Command.PlaceOrderCommand': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/PlaceOrderCommand' },
        },
      },
      components: {
        schemas: {
          PlaceOrderCommand: {
            type: 'object',
            properties: {
              OptionalNote: { type: 'string' },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const field = nodes.find(n => n.id.endsWith('.fields.OptionalNote'))!
    assert.equal(field.properties.nullable, true)
  })

  it('maps scalar types correctly', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              UuidField:     { type: 'string', format: 'uuid' },
              DateTimeField: { type: 'string', format: 'date-time' },
              DateField:     { type: 'string', format: 'date' },
              StrField:      { type: 'string' },
              IntField:      { type: 'integer' },
              NumField:      { type: 'number' },
              BoolField:     { type: 'boolean' },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const field = (name: string) => nodes.find(n => n.id.endsWith(`.fields.${name}`))!
    assert.equal(field('UuidField').properties.type, 'uuid')
    assert.equal(field('DateTimeField').properties.type, 'datetime')
    assert.equal(field('DateField').properties.type, 'date')
    assert.equal(field('StrField').properties.type, 'string')
    assert.equal(field('IntField').properties.type, 'integer')
    assert.equal(field('NumField').properties.type, 'decimal')
    assert.equal(field('BoolField').properties.type, 'boolean')
  })

  it('expands $ref field as sibling schema and uses schema node ID as $ref', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.MyCommand': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/MyCommand' },
        },
      },
      components: {
        schemas: {
          MyCommand: {
            type: 'object',
            properties: {
              Period: { $ref: '#/components/schemas/TaxPeriod' },
            },
          },
          TaxPeriod: {
            type: 'object',
            properties: {
              Year: { type: 'integer' },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const periodField = nodes.find(n => n.id.endsWith('.fields.Period'))!
    assert.equal(periodField.properties.$ref, 'x.Command.MyCommand.schemas.TaxPeriod')
    assert.ok(nodes.some(n => n.id === 'x.Command.MyCommand.schemas.TaxPeriod'))
    const taxYearField = nodes.find(n => n.id.endsWith('TaxPeriod.fields.Year'))!
    assert.ok(taxYearField)
    assert.equal(taxYearField.properties.type, 'integer')
  })

  it('expands array field with $ref items', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Items: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
            },
          },
          Item: {
            type: 'object',
            properties: { Id: { type: 'string', format: 'uuid' } },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const itemsField = nodes.find(n => n.id.endsWith('.fields.Items'))!
    assert.equal(itemsField.properties.collection, 'array')
    assert.equal(itemsField.properties.$ref, 'x.Command.C.schemas.Item')
  })

  it('expands array field with scalar items', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const tagsField = nodes.find(n => n.id.endsWith('.fields.Tags'))!
    assert.equal(tagsField.properties.type, 'string')
    assert.equal(tagsField.properties.collection, 'array')
  })

  it('creates a Mapping node for additionalProperties with scalar values', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Metadata: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const metaField = nodes.find(n => n.id.endsWith('.fields.Metadata'))!
    assert.equal(metaField.properties.$ref, '#/mappings/Metadata')
    const mappingNode = nodes.find(n => n.id.endsWith('.mappings.Metadata'))!
    assert.ok(mappingNode, 'Mapping node should be created')
    assert.equal(mappingNode.template, 'Mapping')
    assert.deepEqual(mappingNode.properties, { type: 'string' })
  })

  it('creates a Mapping node for additionalProperties with $ref values', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              PerPerson: { type: 'object', additionalProperties: { $ref: '#/components/schemas/PersonMetric' } },
            },
          },
          PersonMetric: { type: 'object', properties: { Value: { type: 'number' } } },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const mappingNode = nodes.find(n => n.id.endsWith('.mappings.PerPerson'))!
    assert.ok(mappingNode)
    assert.equal(mappingNode.properties.$ref, 'x.Command.C.schemas.PersonMetric')
    assert.ok(nodes.some(n => n.id === 'x.Command.C.schemas.PersonMetric'))
  })

  it('creates a Mapping node for additionalProperties with array-of-ref values', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Groups: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/Driver' } } },
            },
          },
          Driver: { type: 'object', properties: { Id: { type: 'string', format: 'uuid' } } },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const mappingNode = nodes.find(n => n.id.endsWith('.mappings.Groups'))!
    assert.ok(mappingNode)
    assert.equal(mappingNode.properties['value-collection'], 'array')
    assert.equal(mappingNode.properties.$ref, 'x.Command.C.schemas.Driver')
  })

  it('does not expand the same sibling schema twice', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              A: { $ref: '#/components/schemas/Shared' },
              B: { $ref: '#/components/schemas/Shared' },
            },
          },
          Shared: { type: 'object', properties: { X: { type: 'string' } } },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const sharedSchemaNodes = nodes.filter(n => n.id === 'x.Command.C.schemas.Shared')
    assert.equal(sharedSchemaNodes.length, 1)
  })

  it('handles node with no schema in components gracefully', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          schema: { $ref: '#/components/schemas/Missing' },
        },
      },
      components: { schemas: {} },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const schemaNode = nodes.find(n => n.id.endsWith('.schemas.Missing'))!
    assert.ok(schemaNode, 'Schema node created even when schema definition missing')
    assert.equal(schemaNode.template, 'Schema')
  })
})

describe('mapDocument — edges', () => {
  it('constructs edge ID as from__type__to', () => {
    const doc = makeDoc({
      edges: [{
        from: 'orders.DomainModel.OrderAggregate.operations.Place',
        to: 'orders.DomainEvent.OrderPlaced',
        type: 'produces',
      }],
    })
    const { edges } = mapDocument(doc, SPEC_PATH)
    assert.equal(edges.length, 1)
    assert.equal(edges[0].id, 'orders.DomainModel.OrderAggregate.operations.Place__produces__orders.DomainEvent.OrderPlaced')
    assert.equal(edges[0].type, 'produces')
    assert.equal(edges[0].state, 'implemented')
    assert.equal(edges[0].derivation, 'determined')
    assert.equal(edges[0].derivedBy, 'adapter:corum')
  })

  it('emits a warning and skips edges with unknown type', () => {
    const doc = makeDoc({
      edges: [{ from: 'a.B.C', to: 'd.E.F', type: 'unknown-type' }],
    })
    const { edges, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(edges.length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('unknown-type')))
  })
})

describe('mapDocument — gaps', () => {
  it('emits each gap as a warning diagnostic', () => {
    const doc = makeDoc({
      gaps: [
        { kind: 'unresolved-field-type', nodeId: 'orders.X.fields.Y', reason: 'MissingType' },
        { kind: 'duplicate-domain-type', reason: 'name collision' },
      ],
    })
    const { diagnostics } = mapDocument(doc, SPEC_PATH)
    const warnings = diagnostics.filter(d => d.severity === 'warning')
    assert.equal(warnings.length, 2)
    assert.ok(warnings[0].message.includes('unresolved-field-type'))
    assert.ok(warnings[1].message.includes('duplicate-domain-type'))
  })
})
