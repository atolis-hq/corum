import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractValue, deriveScalarType } from '../../../src/adapters/asyncapi/mapper.js'

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
