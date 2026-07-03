import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadPacks } from '../src/loader/pack-loader.js'
import { loadClusters } from '../src/loader/cluster-loader.js'
import { sanitizeIdSegment, validateNodeId, validateRootId } from '../src/loader/id-grammar.js'
import type { Diagnostic } from '../src/schema/index.js'
import type { ContentMap } from '../src/source/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

async function buildPackContentMap(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadPackContent(await source.defaultBranch())
}

describe('id grammar — validateNodeId', () => {
  it('accepts well-formed hierarchical ids', () => {
    assert.equal(validateNodeId('orders.DomainModel.order'), null)
    assert.equal(validateNodeId('orders.DomainModel.order.schemas.order.fields.id'), null)
    assert.equal(validateNodeId('orders.APIEndpoint.get-order_v2'), null)
  })

  it('accepts _ and - anywhere in a segment', () => {
    assert.equal(validateNodeId('_unresolved.Schema.AddressListItem'), null)
    assert.equal(validateRootId('_unresolved.EnumDefinition.SortOrder'), null)
    assert.equal(validateNodeId('orders.Schema.-leading-dash'), null)
    assert.equal(validateNodeId('orders.Schema.trailing_'), null)
  })

  it('rejects empty segments', () => {
    assert.match(validateNodeId('orders..order') ?? '', /segment/)
    assert.match(validateNodeId('.orders.DomainModel.order') ?? '', /segment/)
    assert.match(validateNodeId('orders.DomainModel.order.') ?? '', /segment/)
  })

  it('rejects reserved separator __ inside segments', () => {
    assert.match(validateNodeId('orders.DomainModel.my__node') ?? '', /__/)
  })

  it('rejects disallowed characters', () => {
    assert.notEqual(validateNodeId('orders.DomainModel.my node'), null)
    assert.notEqual(validateNodeId('orders.DomainModel.my/node'), null)
    assert.notEqual(validateNodeId('orders.DomainModel.my#node'), null)
  })
})

describe('id grammar — validateRootId', () => {
  it('accepts component.Template.name roots', () => {
    assert.equal(validateRootId('orders.DomainModel.order'), null)
  })

  it('rejects roots with fewer than 3 segments', () => {
    assert.match(validateRootId('orders.order') ?? '', /3/)
    assert.match(validateRootId('orders') ?? '', /3/)
  })
})

describe('id grammar — sanitizeIdSegment', () => {
  it('leaves valid segments untouched', () => {
    assert.equal(sanitizeIdSegment('getOrder'), 'getOrder')
    assert.equal(sanitizeIdSegment('get-order_v2'), 'get-order_v2')
  })

  it('replaces dots and other reserved characters', () => {
    assert.equal(sanitizeIdSegment('orders.getOrder'), 'orders-getOrder')
    assert.equal(sanitizeIdSegment('get order'), 'get-order')
  })

  it('collapses double underscores', () => {
    assert.ok(!sanitizeIdSegment('my__op').includes('__'))
  })
})

describe('id grammar — loader enforcement', () => {
  async function loadSingleCluster(yaml: string): Promise<{ diagnostics: Diagnostic[]; nodeIds: string[] }> {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    const content: ContentMap = new Map([['components/orders/test.yaml', yaml]])
    const result = loadClusters(content, templates, diagnostics)
    return { diagnostics, nodeIds: [...result.nodes.keys()] }
  }

  it('emits an error diagnostic for a root id with fewer than 3 segments', async () => {
    const { diagnostics, nodeIds } = await loadSingleCluster(
      'id: orders.order\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  lastModifiedAt: "2026-01-01"\n',
    )
    assert.ok(diagnostics.some(d => d.severity === 'error' && /id/i.test(d.message)), 'expected id grammar error')
    assert.equal(nodeIds.length, 0)
  })

  it('emits an error diagnostic for a root id with invalid characters', async () => {
    const { diagnostics, nodeIds } = await loadSingleCluster(
      'id: "orders.DomainModel.my order"\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  lastModifiedAt: "2026-01-01"\n',
    )
    assert.ok(diagnostics.some(d => d.severity === 'error'), 'expected id grammar error')
    assert.equal(nodeIds.length, 0)
  })

  it('emits an error diagnostic and skips a child whose local name contains a dot', async () => {
    const { diagnostics, nodeIds } = await loadSingleCluster(
      [
        'id: orders.DomainModel.order',
        'template: DomainModel',
        'schemaVersion: "1.0"',
        'metadata:',
        '  component: orders',
        '  lastModifiedAt: "2026-01-01"',
        'schemas:',
        '  "bad.name":',
        '    fields: {}',
        '  good:',
        '    fields: {}',
      ].join('\n') + '\n',
    )
    assert.ok(
      diagnostics.some(d => d.severity === 'error' && /bad\.name/.test(d.message)),
      'expected diagnostic naming the bad local name',
    )
    assert.ok(nodeIds.includes('orders.DomainModel.order.schemas.good'))
    assert.ok(!nodeIds.some(id => id.includes('bad.name')))
  })

  it('materialises parentId on owned children', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const result = loadClusters(await source.loadGraphContent(await source.defaultBranch()), templates, diagnostics)

    const child = result.nodes.get('orders.DomainModel.order.schemas.order')
    assert.ok(child, 'expected fixture child node')
    assert.equal(child.parentId, 'orders.DomainModel.order')

    const grandchild = result.nodes.get('orders.DomainModel.order.schemas.order.fields.id')
    assert.ok(grandchild, 'expected fixture grandchild node')
    assert.equal(grandchild.parentId, 'orders.DomainModel.order.schemas.order')

    const root = result.nodes.get('orders.DomainModel.order')
    assert.ok(root)
    assert.equal(root.parentId, undefined)
  })
})
