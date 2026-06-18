import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveComponent, deriveScalarType, isRefSchema, deriveNodeId } from '../../../src/adapters/openapi/mapper.js'

describe('deriveComponent', () => {
  it('extracts component from URI by segment index', () => {
    assert.equal(deriveComponent('/orders/v1/create', { strategy: 'uri-segment', segment: 0 }), 'orders')
    assert.equal(deriveComponent('/payments/v1/capture', { strategy: 'uri-segment', segment: 0 }), 'payments')
    assert.equal(deriveComponent('/api/orders/create', { strategy: 'uri-segment', segment: 1 }), 'orders')
  })

  it('extracts component from URI using regex pattern', () => {
    assert.equal(
      deriveComponent('/orders/v1/create', { strategy: 'uri-segment', pattern: '^/([^/]+)/' }),
      'orders'
    )
  })

  it('returns hardcoded component', () => {
    assert.equal(
      deriveComponent('/anything', { strategy: 'hardcoded', component: 'legacy' }),
      'legacy'
    )
  })

  it('returns undefined when segment out of range', () => {
    assert.equal(deriveComponent('/orders', { strategy: 'uri-segment', segment: 5 }), undefined)
  })

  it('returns undefined when regex has no capture group match', () => {
    assert.equal(
      deriveComponent('/orders', { strategy: 'uri-segment', pattern: '^/nomatch/([^/]+)' }),
      undefined
    )
  })
})

describe('deriveScalarType', () => {
  it('maps basic types', () => {
    const scalarTypes = { string: 'string', integer: 'integer', boolean: 'boolean', 'string/uuid': 'uuid', 'string/date-time': 'datetime' }
    assert.equal(deriveScalarType('string', undefined, scalarTypes), 'string')
    assert.equal(deriveScalarType('integer', undefined, scalarTypes), 'integer')
    assert.equal(deriveScalarType('string', 'uuid', scalarTypes), 'uuid')
    assert.equal(deriveScalarType('string', 'date-time', scalarTypes), 'datetime')
  })

  it('returns undefined for unknown types', () => {
    assert.equal(deriveScalarType('object', undefined, {}), undefined)
  })
})

describe('isRefSchema', () => {
  it('detects $ref schemas', () => {
    assert.equal(isRefSchema({ $ref: '#/components/schemas/Order' }), true)
    assert.equal(isRefSchema({ type: 'string' }), false)
    assert.equal(isRefSchema({}), false)
  })
})

describe('deriveNodeId', () => {
  it('builds APIEndpoint ID from component and operationId', () => {
    assert.equal(deriveNodeId('operation', 'orders', 'createOrder'), 'orders.APIEndpoint.createOrder')
  })

  it('builds Schema ID from parent ID and schema name', () => {
    assert.equal(
      deriveNodeId('schema', undefined, 'create-order-request', 'orders.APIEndpoint.createOrder', 'schemas'),
      'orders.APIEndpoint.createOrder.schemas.create-order-request'
    )
  })

  it('builds Field ID from parent ID and field name', () => {
    assert.equal(
      deriveNodeId('field', undefined, 'customerId', 'orders.APIEndpoint.createOrder.schemas.create-order-request', 'fields'),
      'orders.APIEndpoint.createOrder.schemas.create-order-request.fields.customerId'
    )
  })
})
