import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapDocument } from '../../../src/adapters/corum/mapper.js'
import type { CorumInterchangeDocument } from '../../../src/adapters/corum/parser.js'

const SPEC_PATH = '/fake/output.corum.yaml'

function makeDoc(overrides: Partial<CorumInterchangeDocument> = {}): CorumInterchangeDocument {
  return {
    corumInterchange: '1.0',
    nodes: [],
    ...overrides,
  }
}

describe('mapDocument — nodes', () => {
  it('maps a resolved node with derivation: determined', () => {
    const doc = makeDoc({
      nodes: [{
        id: 'orders.DomainEvent.OrderPlaced',
        template: 'DomainEvent',
        properties: { schema: 'OrderPlaced' },
        provenance: { derivation: 'resolved', by: 'treesitter' },
      }],
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
    assert.equal(n.derivedBy, 'adapter:corum/treesitter')
    assert.equal(n.extractedFrom, SPEC_PATH)
    assert.deepEqual(n.properties, { schema: 'OrderPlaced' })
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('maps an inferred node with derivation: inferred', () => {
    const doc = makeDoc({
      nodes: [{
        id: 'orders.DomainModel.OrderAggregate.operations.Place',
        template: 'DomainOperation',
        properties: { description: 'Place' },
        provenance: { derivation: 'inferred', confidence: 0.9, by: 'treesitter' },
      }],
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'inferred')
  })

  it('defaults derivation to determined when provenance is absent', () => {
    const doc = makeDoc({
      nodes: [{ id: 'orders.DomainEvent.OrderPlaced', template: 'DomainEvent', properties: {} }],
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'determined')
    assert.equal(nodes[0].derivedBy, 'adapter:corum')
  })

  it('uses adapter:corum as derivedBy when provenance.by is absent', () => {
    const doc = makeDoc({
      nodes: [{
        id: 'orders.DomainEvent.OrderPlaced',
        template: 'DomainEvent',
        properties: {},
        provenance: { derivation: 'resolved' },
      }],
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivedBy, 'adapter:corum')
  })

  it('emits a warning and skips nodes missing id or template', () => {
    const doc = makeDoc({
      nodes: [
        { id: '', template: 'DomainEvent', properties: {} },
        { id: 'orders.DomainEvent.OrderPlaced', template: '', properties: {} },
      ],
    })
    const { nodes, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 0)
    assert.equal(diagnostics.filter(d => d.severity === 'warning').length, 2)
  })
})

describe('mapDocument — edges', () => {
  it('constructs edge ID as from__type__to', () => {
    const doc = makeDoc({
      edges: [{
        from: 'orders.DomainModel.OrderAggregate.operations.Place',
        to: 'orders.DomainEvent.OrderPlaced',
        type: 'produces',
        provenance: { derivation: 'inferred', by: 'treesitter' },
      }],
    })
    const { edges } = mapDocument(doc, SPEC_PATH)
    assert.equal(edges.length, 1)
    assert.equal(edges[0].id, 'orders.DomainModel.OrderAggregate.operations.Place__produces__orders.DomainEvent.OrderPlaced')
    assert.equal(edges[0].type, 'produces')
    assert.equal(edges[0].state, 'implemented')
    assert.equal(edges[0].derivation, 'inferred')
    assert.equal(edges[0].derivedBy, 'adapter:corum/treesitter')
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
