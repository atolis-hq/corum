import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deduplicateResults } from '../../src/import/dedup.js'
import type { EntryResult } from '../../src/import/dedup.js'
import type { Node, Edge } from '../../src/schema/index.js'

function makeNode(id: string, adapterId: string, extra: Record<string, unknown> = {}): Node {
  const parts = id.split('.')
  return {
    id,
    template: parts[1] ?? 'Unknown',
    component: parts[0],
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: '2026-01-01',
    extractedFrom: '/fake/spec.yaml',
    derivation: 'determined',
    derivedBy: `adapter:${adapterId}`,
    properties: { ...extra },
  }
}

function makeEdge(from: string, to: string, type: Edge['type'] = 'triggers'): Edge {
  return {
    id: `${from}__${type}__${to}`,
    from,
    to,
    type,
    state: 'implemented',
    stability: 'unstable',
    derivation: 'determined',
    derivedBy: 'adapter:test',
  }
}

function makeResult(adapterId: string, nodes: Node[], edges: Edge[] = []): EntryResult {
  return { adapterId, specPath: `/fake/${adapterId}.yaml`, nodes, edges }
}

describe('deduplicateResults — x-aka matching', () => {
  it('redirects edges from secondary root to primary and drops secondary node', () => {
    const secondary = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const edge = makeEdge('billing.APIEndpoint.GetInvoiceController', 'billing.Command.GetInvoiceQuery')

    const results = [
      makeResult('corum', [secondary], [edge]),
      makeResult('openapi', [primary]),
    ]

    const { results: out, diagnostics } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])

    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'secondary node dropped')

    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges.length, 1)
    assert.equal(allEdges[0].from, 'billing.APIEndpoint.GetInvoice')
    assert.equal(allEdges[0].to, 'billing.Command.GetInvoiceQuery')
    assert.equal(allEdges[0].id, 'billing.APIEndpoint.GetInvoice__triggers__billing.Command.GetInvoiceQuery')

    assert.equal(diagnostics.length, 0, 'no warning for x-aka match')
  })

  it('rewrites edges where secondary is the target', () => {
    const secondary = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const edge = makeEdge('billing.APIGateway.Router', 'billing.APIEndpoint.GetInvoiceController', 'calls')

    const results = [
      makeResult('corum', [secondary], [edge]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges[0].to, 'billing.APIEndpoint.GetInvoice')
  })

  it('no match when x-aka does not correspond to any primary node', () => {
    const secondary = makeNode('billing.APIEndpoint.UnknownController', 'corum', { 'x-aka': ['NoMatch'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')

    const results = [
      makeResult('corum', [secondary]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 1, 'unmatched secondary node kept')
  })
})

describe('deduplicateResults — same-ID collision', () => {
  it('keeps primary, drops secondary, emits warning when IDs match', () => {
    const secondary = makeNode('customers.IntegrationEvent.CustomerCreated', 'corum')
    const primary = makeNode('customers.IntegrationEvent.CustomerCreated', 'asyncapi')

    const results = [
      makeResult('corum', [secondary]),
      makeResult('asyncapi', [primary]),
    ]

    const { results: out, diagnostics } = deduplicateResults(results, [{ primary: 'asyncapi', secondary: 'corum' }])
    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'secondary dropped')

    assert.equal(diagnostics.length, 1)
    assert.ok(diagnostics[0].message.includes('customers.IntegrationEvent.CustomerCreated'))
    assert.ok(diagnostics[0].message.includes('asyncapi'))
    assert.ok(diagnostics[0].message.includes('corum'))
    assert.equal(diagnostics[0].severity, 'warning')
  })

  it('does not rewrite edges when IDs are identical (same-ID collision)', () => {
    const secondary = makeNode('customers.IntegrationEvent.CustomerCreated', 'corum')
    const primary = makeNode('customers.IntegrationEvent.CustomerCreated', 'asyncapi')
    const edge = makeEdge('customers.DomainModel.CustomerAggregate', 'customers.IntegrationEvent.CustomerCreated', 'produces')

    const results = [
      makeResult('corum', [secondary], [edge]),
      makeResult('asyncapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'asyncapi', secondary: 'corum' }])
    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges[0].to, 'customers.IntegrationEvent.CustomerCreated', 'edge target unchanged')
    assert.equal(allEdges[0].id, 'customers.DomainModel.CustomerAggregate__produces__customers.IntegrationEvent.CustomerCreated')
  })
})

describe('deduplicateResults — child node dropping', () => {
  it('drops schema and field children of a redirected secondary root', () => {
    const root = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const schema = makeNode('billing.APIEndpoint.GetInvoiceController.schemas.GetInvoiceResponse', 'corum')
    const field = makeNode('billing.APIEndpoint.GetInvoiceController.schemas.GetInvoiceResponse.fields.InvoiceId', 'corum')
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')

    const results = [
      makeResult('corum', [root, schema, field]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'root and all children dropped')
  })

  it('drops edge referencing dropped child node when rewritten target does not exist in primary', () => {
    const root = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const field = makeNode('billing.APIEndpoint.GetInvoiceController.schemas.Response.fields.Id', 'corum')
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const edge = makeEdge(
      'billing.APIEndpoint.GetInvoiceController.schemas.Response.fields.Id',
      'shared.Schema.Invoice.fields.Id',
      'maps-to',
    )

    const results = [
      makeResult('corum', [root, field], [edge]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges.length, 0, 'edge dropped because rewritten target does not exist in primary')
  })

  it('rewrites child edge when rewritten target exists in primary', () => {
    const root = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const field = makeNode('billing.APIEndpoint.GetInvoiceController.schemas.Response.fields.Id', 'corum')
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const primaryField = makeNode('billing.APIEndpoint.GetInvoice.schemas.Response.fields.Id', 'openapi')
    const edge = makeEdge(
      'billing.APIEndpoint.GetInvoiceController.schemas.Response.fields.Id',
      'shared.Schema.Invoice.fields.Id',
      'maps-to',
    )

    const results = [
      makeResult('corum', [root, field], [edge]),
      makeResult('openapi', [primary, primaryField]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges.length, 1)
    assert.equal(allEdges[0].from, 'billing.APIEndpoint.GetInvoice.schemas.Response.fields.Id')
    assert.equal(allEdges[0].to, 'shared.Schema.Invoice.fields.Id')
  })
})

describe('deduplicateResults — same-ID collision with full tree', () => {
  it('emits only one warning for same-ID collision with full tree', () => {
    const secondary = makeNode('customers.IntegrationEvent.CustomerCreated', 'corum')
    const secondaryChild = makeNode('customers.IntegrationEvent.CustomerCreated.schemas.CustomerCreated', 'corum')
    const primary = makeNode('customers.IntegrationEvent.CustomerCreated', 'asyncapi')
    const primaryChild = makeNode('customers.IntegrationEvent.CustomerCreated.schemas.CustomerCreated', 'asyncapi')

    const results = [
      makeResult('corum', [secondary, secondaryChild]),
      makeResult('asyncapi', [primary, primaryChild]),
    ]

    const { results: out, diagnostics } = deduplicateResults(results, [{ primary: 'asyncapi', secondary: 'corum' }])
    assert.equal(diagnostics.length, 1, 'only root-level warning, not one per child')
    assert.ok(diagnostics[0].message.includes('customers.IntegrationEvent.CustomerCreated'))
    const corumNodes = out.find(r => r.adapterId === 'corum')!.nodes
    assert.equal(corumNodes.length, 0, 'all corum nodes dropped')
  })
})

describe('deduplicateResults — x-aka cleanup', () => {
  it('strips x-aka from secondary nodes that were not matched (kept)', () => {
    const secondary = makeNode('billing.APIEndpoint.UnknownController', 'corum', { 'x-aka': ['NoMatch'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')

    const results = [
      makeResult('corum', [secondary]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const kept = out.find(r => r.adapterId === 'corum')!.nodes[0]
    assert.ok(!('x-aka' in kept.properties), 'x-aka stripped from kept node')
  })

  it('strips x-aka even when no rules are matched', () => {
    const node = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })

    const results = [makeResult('corum', [node])]
    const { results: out } = deduplicateResults(results, [])
    assert.ok(!('x-aka' in out[0].nodes[0].properties))
  })
})

describe('deduplicateResults — no-op cases', () => {
  it('returns results unchanged when no rules provided', () => {
    const node = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const results = [makeResult('openapi', [node])]
    const { results: out, diagnostics } = deduplicateResults(results, [])
    assert.equal(out[0].nodes.length, 1)
    assert.equal(diagnostics.length, 0)
  })

  it('applies multiple rules independently', () => {
    const corumApi = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const corumEvent = makeNode('customers.IntegrationEvent.CustomerCreated', 'corum')
    const openApi = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const asyncApi = makeNode('customers.IntegrationEvent.CustomerCreated', 'asyncapi')

    const results = [
      makeResult('corum', [corumApi, corumEvent]),
      makeResult('openapi', [openApi]),
      makeResult('asyncapi', [asyncApi]),
    ]

    const { results: out, diagnostics } = deduplicateResults(results, [
      { primary: 'openapi', secondary: 'corum' },
      { primary: 'asyncapi', secondary: 'corum' },
    ])

    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'both corum nodes dropped')
    assert.equal(diagnostics.length, 1, 'one warning for same-ID collision')
  })
})
