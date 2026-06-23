import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveComponent, deriveScalarType, isRefSchema, deriveNodeId, mapDocument } from '../../../src/adapters/openapi/mapper.js'
import type { OpenAPIV3 } from 'openapi-types'
import type { AdapterPackConfig } from '../../../src/adapters/index.js'
import type { OpenAPIImportEntry } from '../../../src/import/config.js'

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

const PACK_CONFIG: AdapterPackConfig = {
  adapter: 'openapi',
  version: '1.0',
  constructs: {
    operation: { template: 'APIEndpoint' },
    requestSchema: { template: 'Schema', section: 'schemas' },
    responseSchema: { template: 'Schema', section: 'schemas' },
    schemaProperty: { template: 'Field', section: 'fields' },
    enumDefinition: { template: 'EnumDefinition', section: 'enums' },
    enumValue: { template: 'EnumValue', section: 'values' },
  },
  scalarTypes: {
    string: 'string',
    'string/uuid': 'uuid',
    'string/date': 'date',
    'string/date-time': 'datetime',
    integer: 'integer',
    number: 'decimal',
    boolean: 'boolean',
  },
}

const ENTRY: OpenAPIImportEntry = {
  adapter: 'openapi',
  spec: 'test.yaml',
  componentMapping: { strategy: 'uri-segment', segment: 0 },
}

function makeDoc(paths: Record<string, OpenAPIV3.PathItemObject>): OpenAPIV3.Document {
  return { openapi: '3.0.0', info: { title: 'Test', version: '1.0' }, paths }
}

describe('mapDocument â€” parameters', () => {
  it('maps a query parameter with scalar type', () => {
    const doc = makeDoc({
      '/items/search': {
        get: {
          operationId: 'searchItems',
          parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.searchItems')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      limit: { location: 'query', type: 'integer', required: true },
    })
  })

  it('maps an array query parameter as collection array', () => {
    const doc = makeDoc({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'tags', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.listItems')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      tags: { location: 'query', type: 'string', required: false, collection: 'array' },
    })
  })

  it('maps an enum-constrained query parameter as type string', () => {
    const doc = makeDoc({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['active', 'inactive'] } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.listItems')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      status: { location: 'query', type: 'string', required: false },
    })
  })

  it('maps a path parameter with location path', () => {
    const doc = makeDoc({
      '/items/{itemId}': {
        get: {
          operationId: 'getItemById',
          parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.getItemById')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      itemId: { location: 'path', type: 'uuid', required: true },
    })
  })

  it('maps a header parameter with location header', () => {
    const doc = makeDoc({
      '/items/{itemId}': {
        delete: {
          operationId: 'deleteItem',
          parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'X-Api-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.deleteItem')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      itemId: { location: 'path', type: 'uuid', required: true },
      'X-Api-Key': { location: 'header', type: 'string', required: true },
    })
  })

  it('skips cookie parameters', () => {
    const doc = makeDoc({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'session', in: 'cookie', required: false, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.listItems')
    assert.ok(endpoint)
    assert.equal(endpoint.properties.parameters, undefined)
  })

  it('inherits path-item-level parameters, operation-level overrides same name', () => {
    const doc = makeDoc({
      '/items/{itemId}': {
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          operationId: 'getItemById',
          parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.getItemById')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      itemId: { location: 'path', type: 'uuid', required: true },
    })
  })

  it('does not set parameters property when operation has no parameters', () => {
    const doc = makeDoc({
      '/items': {
        post: {
          operationId: 'createItem',
          responses: { '201': { description: 'Created' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.createItem')
    assert.ok(endpoint)
    assert.equal(endpoint.properties.parameters, undefined)
  })
})

describe('mapDocument — componentNameReplacements', () => {
  it('rewrites extracted component name in endpoint node ID', () => {
    const doc = makeDoc({
      '/ordershipping/create': {
        post: {
          operationId: 'createShipment',
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG, [{ from: 'ordershipping', to: 'order-shipping' }])
    assert.ok(nodes.some(n => n.id === 'order-shipping.APIEndpoint.createShipment'), 'expected canonical component name in node ID')
    assert.ok(!nodes.some(n => n.id.startsWith('ordershipping.')), 'expected raw component name to be absent')
  })

  it('does not affect names with no matching replacement', () => {
    const doc = makeDoc({
      '/payments/capture': {
        post: {
          operationId: 'capturePayment',
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG, [{ from: 'ordershipping', to: 'order-shipping' }])
    assert.ok(nodes.some(n => n.id === 'payments.APIEndpoint.capturePayment'))
  })
})
