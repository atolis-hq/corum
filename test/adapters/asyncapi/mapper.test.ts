import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractValue, deriveScalarType, deriveMessageName, classifyEvent, deriveNodeId, countMessageSchemaUsage, collectSharedSchemaNames, extractHeaders } from '../../../src/adapters/asyncapi/mapper.js'

const SCALAR_TYPES: Record<string, string> = {
  string: 'string', integer: 'integer', boolean: 'boolean', number: 'decimal',
  'string/uuid': 'uuid', 'string/date': 'date', 'string/date-time': 'datetime',
}

function makeOp(channelAddress: string, opTags: string[] = []) {
  return {
    channels: () => ({ all: () => [{ address: () => channelAddress }] }),
    tags: () => ({ all: () => opTags.map(name => ({ name: () => name })) }),
  }
}

function makeMsg(name: string | undefined, id = 'msg-id', msgTags: string[] = []) {
  return {
    name: () => name,
    id: () => id,
    tags: () => ({ all: () => msgTags.map(t => ({ name: () => t })) }),
  }
}

describe('extractValue', () => {
  it('channel-segment: splits on separator and returns segment by index', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 0 }, op as any, msg as any), 'orders')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 1 }, op as any, msg as any), 'v1')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 2 }, op as any, msg as any), 'order-placed')
  })

  it('channel-segment: negative segment counts from end', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: -1 }, op as any, msg as any), 'order-placed')
  })

  it('channel-segment: returns undefined for out-of-range segment', () => {
    const op = makeOp('orders')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 5 }, op as any, msg as any), undefined)
  })

  it('channel-pattern: returns first capture group', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-pattern', pattern: '^([a-z]+)\\.' }, op as any, msg as any), 'orders')
  })

  it('channel-pattern: returns full match when no capture group', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-pattern', pattern: 'orders' }, op as any, msg as any), 'orders')
  })

  it('channel-pattern: returns undefined when no match', () => {
    const op = makeOp('orders.v1')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-pattern', pattern: 'nomatch' }, op as any, msg as any), undefined)
  })

  it('name-segment: splits message name on separator', () => {
    const op = makeOp('any')
    const msg = makeMsg('OrderPlaced.v2')
    assert.equal(extractValue({ strategy: 'name-segment', separator: '.', segment: 0 }, op as any, msg as any), 'OrderPlaced')
    assert.equal(extractValue({ strategy: 'name-segment', separator: '.', segment: -1 }, op as any, msg as any), 'v2')
  })

  it('name-segment: falls back to id when name() is undefined', () => {
    const op = makeOp('any')
    const msg = makeMsg(undefined, 'OrderPlaced.v2')
    assert.equal(extractValue({ strategy: 'name-segment', separator: '.', segment: 0 }, op as any, msg as any), 'OrderPlaced')
  })

  it('name-pattern: returns match from message name', () => {
    const op = makeOp('any')
    const msg = makeMsg('ProductUpdatedDomainEvent')
    assert.equal(extractValue({ strategy: 'name-pattern', pattern: 'DomainEvent' }, op as any, msg as any), 'DomainEvent')
    assert.equal(extractValue({ strategy: 'name-pattern', pattern: 'IntegrationEvent' }, op as any, msg as any), undefined)
  })

  it('tag: returns first tag from message', () => {
    const op = makeOp('any', [])
    const msg = makeMsg('OrderPlaced', 'id', ['domain'])
    assert.equal(extractValue({ strategy: 'tag' }, op as any, msg as any), 'domain')
  })

  it('tag: falls back to operation tags when message has none', () => {
    const op = makeOp('any', ['integration'])
    const msg = makeMsg('OrderPlaced', 'id', [])
    assert.equal(extractValue({ strategy: 'tag' }, op as any, msg as any), 'integration')
  })

  it('hardcoded: always returns the fixed value', () => {
    const op = makeOp('any')
    const msg = makeMsg('Anything')
    assert.equal(extractValue({ strategy: 'hardcoded', value: 'payments' }, op as any, msg as any), 'payments')
  })
})

describe('deriveScalarType', () => {
  it('maps JSON Schema primitive types to Corum scalar types', () => {
    assert.equal(deriveScalarType('string', undefined, SCALAR_TYPES), 'string')
    assert.equal(deriveScalarType('integer', undefined, SCALAR_TYPES), 'integer')
    assert.equal(deriveScalarType('boolean', undefined, SCALAR_TYPES), 'boolean')
    assert.equal(deriveScalarType('number', undefined, SCALAR_TYPES), 'decimal')
  })

  it('maps format-qualified types', () => {
    assert.equal(deriveScalarType('string', 'uuid', SCALAR_TYPES), 'uuid')
    assert.equal(deriveScalarType('string', 'date', SCALAR_TYPES), 'date')
    assert.equal(deriveScalarType('string', 'date-time', SCALAR_TYPES), 'datetime')
  })

  it('returns undefined for unknown types', () => {
    assert.equal(deriveScalarType('object', undefined, SCALAR_TYPES), undefined)
    assert.equal(deriveScalarType('array', undefined, SCALAR_TYPES), undefined)
  })
})


describe('deriveMessageName', () => {
  it('returns message.name() as-is when no messageNaming config', () => {
    const msg = makeMsg('OrderPlaced')
    assert.deepEqual(deriveMessageName(msg as any, undefined, 'spec.yaml'), { name: 'OrderPlaced' })
  })

  it('applies messageNaming strategy to message name', () => {
    const op = makeOp('any')
    const msg = makeMsg('OrderPlaced.v2')
    const result = deriveMessageName(
      msg as any,
      { strategy: { strategy: 'name-segment', separator: '.', segment: 0 }, operation: op as any },
      'spec.yaml',
    )
    assert.deepEqual(result, { name: 'OrderPlaced' })
  })

  it('returns null when name is absent and no messageNaming config', () => {
    const msg = makeMsg(undefined, 'some-id')
    assert.equal(deriveMessageName(msg as any, undefined, 'spec.yaml'), null)
  })

  it('returns null for anonymous message (no name, no id)', () => {
    const msg = makeMsg(undefined, '')
    assert.equal(deriveMessageName(msg as any, undefined, 'spec.yaml'), null)
  })
})

describe('classifyEvent', () => {
  it('returns IntegrationEvent when classification is absent', () => {
    assert.equal(classifyEvent(undefined, makeOp('any') as any, makeMsg('OrderPlaced') as any), 'IntegrationEvent')
  })

  it('returns IntegrationEvent for always-integration', () => {
    assert.equal(classifyEvent({ strategy: 'always-integration' }, makeOp('any') as any, makeMsg('OrderPlaced') as any), 'IntegrationEvent')
  })

  it('returns DomainEvent for always-domain', () => {
    assert.equal(classifyEvent({ strategy: 'always-domain' }, makeOp('any') as any, makeMsg('OrderPlaced') as any), 'DomainEvent')
  })

  it('returns DomainEvent when extracted value matches domainValue', () => {
    const classification = { from: { strategy: 'channel-segment' as const, separator: '.', segment: 0 }, domainValue: 'internal' }
    assert.equal(classifyEvent(classification, makeOp('internal.orders') as any, makeMsg('OrderPlaced') as any), 'DomainEvent')
  })

  it('returns IntegrationEvent when extracted value does not match domainValue', () => {
    const classification = { from: { strategy: 'channel-segment' as const, separator: '.', segment: 0 }, domainValue: 'internal' }
    assert.equal(classifyEvent(classification, makeOp('external.orders') as any, makeMsg('OrderPlaced') as any), 'IntegrationEvent')
  })
})

describe('deriveNodeId', () => {
  it('builds IntegrationEvent root node ID', () => {
    assert.equal(
      deriveNodeId('event', 'orders', 'order-placed', { template: 'IntegrationEvent' }),
      'orders.IntegrationEvent.order-placed',
    )
  })

  it('builds DomainEvent root node ID', () => {
    assert.equal(
      deriveNodeId('event', 'orders', 'order-created', { template: 'DomainEvent' }),
      'orders.DomainEvent.order-created',
    )
  })

  it('builds Schema child node ID from parent and section', () => {
    assert.equal(
      deriveNodeId('schema', 'orders', 'order-placed', {
        parentId: 'orders.IntegrationEvent.order-placed',
        section: 'schemas',
      }),
      'orders.IntegrationEvent.order-placed.schemas.order-placed',
    )
  })

  it('builds Field child node ID', () => {
    assert.equal(
      deriveNodeId('field', 'orders', 'orderId', {
        parentId: 'orders.IntegrationEvent.order-placed.schemas.order-placed',
        section: 'fields',
      }),
      'orders.IntegrationEvent.order-placed.schemas.order-placed.fields.orderId',
    )
  })
})

function makeDoc(schemaNames: string[], messages: Array<{ name: string; payloadRef?: string }>) {
  const ops = messages.map(m => ({
    messages: () => ({
      all: () => [{
        name: () => m.name,
        id: () => m.name,
        json: () => m.payloadRef ? { payload: { $ref: `#/components/schemas/${m.payloadRef}` } } : {},
      }],
    }),
    channels: () => ({ all: () => [{ address: () => 'test.channel' }] }),
  }))
  return {
    allOperations: () => ops,
    json: () => ({ components: { schemas: Object.fromEntries(schemaNames.map(n => [n, { type: 'object' }])) } }),
  }
}

describe('countMessageSchemaUsage', () => {
  it('counts 1 when one unique message name references a schema', () => {
    const doc = makeDoc(['Order'], [{ name: 'OrderPlaced', payloadRef: 'Order' }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Order'), 1)
  })

  it('counts 1 when two messages with the same name reference the same schema', () => {
    const doc = makeDoc(['Pet'], [{ name: 'Pet', payloadRef: 'Pet' }, { name: 'Pet', payloadRef: 'Pet' }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Pet'), 1)
  })

  it('counts 2 when two differently-named messages reference the same schema', () => {
    const doc = makeDoc(['Payload'], [{ name: 'EventA', payloadRef: 'Payload' }, { name: 'EventB', payloadRef: 'Payload' }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Payload'), 2)
  })

  it('returns undefined for schemas not referenced by any message', () => {
    const doc = makeDoc(['Unused'], [{ name: 'Event', payloadRef: undefined }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Unused'), undefined)
  })
})

describe('collectSharedSchemaNames', () => {
  it('marks schemas with count >= 2 as shared', () => {
    const doc = makeDoc(['Shared', 'Owned'], [])
    const shared = collectSharedSchemaNames(doc as any, new Map([['Shared', 2], ['Owned', 1]]))
    assert.equal(shared.has('Shared'), true)
    assert.equal(shared.has('Owned'), false)
  })

  it('promotes schemas referenced by shared schemas (BFS closure)', () => {
    const doc = {
      allOperations: () => [],
      json: () => ({
        components: {
          schemas: {
            Shared: { type: 'object', properties: { child: { $ref: '#/components/schemas/Child' } } },
            Child: { type: 'object' },
          },
        },
      }),
    }
    const shared = collectSharedSchemaNames(doc as any, new Map([['Shared', 2]]))
    assert.equal(shared.has('Shared'), true)
    assert.equal(shared.has('Child'), true)
  })
})

describe('extractHeaders', () => {
  const ST = { string: 'string', integer: 'integer', 'string/uuid': 'uuid' }

  it('maps flat header properties to Corum header shape', () => {
    const raw = {
      type: 'object',
      properties: { correlationId: { type: 'string', format: 'uuid' }, retryCount: { type: 'integer' } },
      required: ['correlationId'],
    }
    const result = extractHeaders(raw, ST, 'spec.yaml')
    assert.ok(result)
    assert.deepEqual(result.headers, {
      correlationId: { type: 'uuid', required: true },
      retryCount: { type: 'integer', required: false },
    })
    assert.equal(result.diagnostics.length, 0)
  })

  it('skips nested object headers with a warning', () => {
    const raw = { type: 'object', properties: { nested: { type: 'object', properties: { x: { type: 'string' } } } } }
    const result = extractHeaders(raw, ST, 'spec.yaml')
    assert.ok(result)
    assert.equal(Object.keys(result.headers).length, 0)
    assert.equal(result.diagnostics.filter((d: { severity: string }) => d.severity === 'warning').length, 1)
  })

  it('handles type: [string, null] nullable pattern', () => {
    const raw = { type: 'object', properties: { name: { type: ['string', 'null'] } } }
    const result = extractHeaders(raw, ST, 'spec.yaml')
    assert.ok(result)
    assert.equal((result.headers.name as any).type, 'string')
  })

  it('returns null for falsy input', () => {
    assert.equal(extractHeaders(null, ST, 'spec.yaml'), null)
    assert.equal(extractHeaders(undefined, ST, 'spec.yaml'), null)
  })
})
