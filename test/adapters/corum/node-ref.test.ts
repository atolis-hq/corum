import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapDocument } from '../../../src/adapters/corum/mapper.js'
import type { CorumInterchangeDocument } from '../../../src/adapters/corum/parser.js'

const SPEC_PATH = '/fake/output.corum.yaml'
const ENUM_ID = 'orders.EnumDefinition.OrderStatus'

function makeDoc(overrides: Partial<CorumInterchangeDocument>): CorumInterchangeDocument {
  return { corum: '1.0', nodes: {}, ...overrides }
}

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
        required: ['status'],
        properties: {
          status: { $ref: ENUM_ID },
          history: { type: 'array', items: { $ref: ENUM_ID } },
          byName: { type: 'object', additionalProperties: { $ref: ENUM_ID } },
          ghost: { $ref: 'orders.EnumDefinition.Missing' },
          old: { $ref: 'orders.EnumDefinition.OldStatus' },
        },
      },
    },
  },
})

const nodeRefs = {
  ids: new Set([ENUM_ID]),
  aliases: new Map([['orders.EnumDefinition.OldStatus', ENUM_ID]]),
}

function run(d: CorumInterchangeDocument) {
  return mapDocument(d, SPEC_PATH, new Map(), undefined, undefined, nodeRefs)
}

function fieldProps(nodes: { id: string; properties: Record<string, unknown> }[], name: string) {
  return nodes.find(n => n.id.endsWith(`.fields.${name}`))!.properties
}

describe('mapDocument — node-ID $ref to existing graph nodes', () => {
  it('links fields to existing nodes without creating them', () => {
    const { nodes } = run(doc)
    assert.deepEqual(fieldProps(nodes, 'status'), { $ref: ENUM_ID, nullable: false, collection: 'one' })
    assert.deepEqual(fieldProps(nodes, 'history'), { $ref: ENUM_ID, nullable: true, collection: 'array' })
    const mapping = nodes.find(n => n.id.endsWith('.mappings.byName'))!
    assert.equal(mapping.properties.$ref, ENUM_ID)
    assert.ok(!nodes.some(n => n.id === ENUM_ID))
  })

  it('warns and falls back to string when unresolved', () => {
    const { nodes, diagnostics } = run(doc)
    assert.equal(fieldProps(nodes, 'ghost').type, 'string')
    assert.equal(fieldProps(nodes, 'ghost').$ref, undefined)
    const warning = diagnostics.find(d => d.message.includes('orders.EnumDefinition.Missing'))
    assert.ok(warning)
    assert.equal(warning.severity, 'warning')
    assert.ok(warning.message.includes('.fields.ghost'))
  })

  it('resolves retired IDs through the alias map', () => {
    const { nodes } = run(doc)
    assert.equal(fieldProps(nodes, 'old').$ref, ENUM_ID)
  })

  it('keeps same-document refs unchanged', () => {
    const d = makeDoc({
      nodes: { 'orders.DomainEvent.A': { type: 'DomainEvent', schema: { $ref: '#/components/schemas/A' } } },
      components: {
        schemas: {
          A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
          B: { type: 'object', properties: { x: { type: 'string' } } },
        },
      },
    })
    const { nodes, diagnostics } = run(d)
    assert.equal(fieldProps(nodes, 'b').$ref, 'orders.DomainEvent.A.schemas.B')
    assert.equal(diagnostics.length, 0)
  })
})
