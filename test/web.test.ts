import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startWebServer, type WebServerHandle } from '../src/web/server.js'
import type { Graph } from '../src/schema/index.js'

function makeTestGraph(): Graph {
  const templates = new Map()
  templates.set('DomainModel', {
    name: 'DomainModel',
    info: { version: '1', core: false, description: 'A domain model' },
    properties: {
      type: 'object',
      properties: {
        schema: { type: 'string', format: 'node-ref' },
      },
    },
    operations: { 'item-template': 'DomainOperation' },
    ui: {
      colour: '#4a90e2',
      displayName: 'Domain Model',
      icon: 'sitemap',
      nav: {
        nestOwned: [
          { section: 'operations', label: 'Operations' },
        ],
      },
    },
  })
  templates.set('DomainOperation', {
    name: 'DomainOperation',
    info: { version: '1', core: false, description: 'A domain operation' },
    ui: { colour: '#5B8C5A', displayName: 'Domain Operation', icon: 'gear' },
  })
  templates.set('Field', {
    name: 'Field',
    info: { version: '1', core: true },
    ui: { displayName: 'Field' },
  })
  templates.set('Schema', {
    name: 'Schema',
    info: { version: '1', core: true },
    ui: { displayName: 'Schema' },
  })

  const orderNode = {
    id: 'orders.Order',
    template: 'DomainModel',
    component: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'An order', schema: '#/schemas/order' },
  }
  const schemaNode = {
    id: 'orders.Order.schemas.order',
    template: 'Schema',
    component: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'Order schema' },
  }
  const fieldNode = {
    id: 'orders.Order.schemas.order.fields.id',
    template: 'Field',
    component: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { type: 'uuid' },
  }
  const externalSchemaNode = {
    id: 'billing.Invoice.schemas.order',
    template: 'Schema',
    component: 'billing',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'Billing order schema' },
  }
  const externalFieldNode = {
    id: 'billing.Invoice.schemas.order.fields.id',
    template: 'Field',
    component: 'billing',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { type: 'uuid' },
  }
  const operationNode = {
    id: 'orders.Order.operations.cancel',
    template: 'DomainOperation',
    component: 'orders',
    state: 'proposed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'Cancel an order' },
  }
  const orphanOperationNode = {
    id: 'orders.CancelOrder',
    template: 'DomainOperation',
    component: 'orders',
    state: 'draft' as const,
    stability: 'unstable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'Standalone operation' },
  }

  const nodesById = new Map()
  nodesById.set('orders.Order', orderNode)
  nodesById.set('orders.Order.schemas.order', schemaNode)
  nodesById.set('orders.Order.schemas.order.fields.id', fieldNode)
  nodesById.set('orders.Order.operations.cancel', operationNode)
  nodesById.set('orders.CancelOrder', orphanOperationNode)
  nodesById.set('billing.Invoice.schemas.order', externalSchemaNode)
  nodesById.set('billing.Invoice.schemas.order.fields.id', externalFieldNode)

  const mapsToEdge = {
    id: 'orders.Order.schemas.order.fields.id__maps-to__billing.Invoice.schemas.order.fields.id',
    from: 'orders.Order.schemas.order.fields.id',
    to: 'billing.Invoice.schemas.order.fields.id',
    type: 'maps-to' as const,
    state: 'agreed' as const,
    stability: 'stable' as const,
  }
  const edgesByFrom = new Map([
    [mapsToEdge.from, [mapsToEdge]],
  ])
  const edgesByTo = new Map([
    [mapsToEdge.to, [mapsToEdge]],
  ])

  return { nodesById, edgesByFrom, edgesByTo, templates, diagnostics: [] }
}

describe('web server', () => {
  let handle: WebServerHandle

  before(async () => {
    handle = await startWebServer(makeTestGraph(), { port: 0 })
  })

  after(async () => {
    await handle.close()
  })

  describe('GET /health', () => {
    it('returns { ok: true }', async () => {
      const res = await fetch(`http://localhost:${handle.port}/health`)
      assert.equal(res.status, 200)
      const body = await res.json() as unknown
      assert.deepEqual(body, { ok: true })
    })
  })

  describe('GET /api/templates', () => {
    it('returns non-core templates by default', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/templates`)
      assert.equal(res.status, 200)
      const body = await res.json() as Array<{ name: string; core: boolean }>
      assert.equal(body.length, 2)
      assert.deepEqual(body.map(t => t.name).sort(), ['DomainModel', 'DomainOperation'])
      assert.equal(body[0].core, false)
    })

    it('includes core templates when ?includeCore=true', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/templates?includeCore=true`)
      const body = await res.json() as Array<{ name: string }>
      assert.equal(body.length, 4)
      const names = body.map(t => t.name).sort()
      assert.deepEqual(names, ['DomainModel', 'DomainOperation', 'Field', 'Schema'])
    })

    it('includes ui config in response', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/templates`)
      const body = await res.json() as Array<{ name: string; ui?: { colour?: string; displayName?: string; nav?: { nestOwned?: unknown[] } } }>
      const dm = body.find(t => t.name === 'DomainModel')
      assert.equal(dm?.ui?.colour, '#4a90e2')
      assert.equal(dm?.ui?.displayName, 'Domain Model')
      assert.deepEqual(dm?.ui?.nav?.nestOwned, [{ section: 'operations', label: 'Operations' }])
    })
  })

  describe('GET /api/nodes', () => {
    it('returns non-core template nodes with no filter', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes`)
      assert.equal(res.status, 200)
      const body = await res.json() as Array<{ id: string; template: string }>
      assert.equal(body.length, 3)
      const ids = body.map(n => n.id).sort()
      assert.deepEqual(ids, ['orders.CancelOrder', 'orders.Order', 'orders.Order.operations.cancel'])
    })

    it('includes core template nodes when ?includeCore=true', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes?includeCore=true`)
      assert.equal(res.status, 200)
      const body = await res.json() as Array<{ id: string; template: string }>
      assert.equal(body.length, 7)
      const ids = body.map(n => n.id).sort()
      assert.deepEqual(ids, [
        'billing.Invoice.schemas.order',
        'billing.Invoice.schemas.order.fields.id',
        'orders.CancelOrder',
        'orders.Order',
        'orders.Order.operations.cancel',
        'orders.Order.schemas.order',
        'orders.Order.schemas.order.fields.id',
      ])
    })

    it('filters by template', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes?template=DomainModel`)
      const body = await res.json() as Array<{ id: string }>
      assert.equal(body.length, 1)
      assert.equal(body[0].id, 'orders.Order')
    })

    it('filters by component', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes?component=orders`)
      const body = await res.json() as Array<{ id: string }>
      assert.equal(body.length, 3)
    })

    it('returns id, template, component, state, stability, and navigation ownership only', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes`)
      const body = await res.json() as Array<Record<string, unknown>>
      const node = body[0]
      assert.ok('id' in node)
      assert.ok('template' in node)
      assert.ok('component' in node)
      assert.ok('state' in node)
      assert.ok('stability' in node)
      assert.ok(!('properties' in node))
    })

    it('includes parentId and ownedSection for owned nodes but not orphans', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes`)
      const body = await res.json() as Array<Record<string, unknown>>
      const operation = body.find(node => node.id === 'orders.Order.operations.cancel')
      const orphan = body.find(node => node.id === 'orders.CancelOrder')

      assert.equal(operation?.parentId, 'orders.Order')
      assert.equal(operation?.ownedSection, 'operations')
      assert.equal(orphan?.parentId, undefined)
      assert.equal(orphan?.ownedSection, undefined)
    })
  })

  describe('GET /api/cluster', () => {
    it('returns cluster for a valid nodeId', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as {
        root: { id: string }
        descendants: unknown[]
        includedNodes: unknown[]
        edges: unknown[]
      }
      assert.equal(body.root.id, 'orders.Order')
      assert.ok(Array.isArray(body.descendants))
      assert.ok(Array.isArray(body.includedNodes))
      assert.ok(Array.isArray(body.edges))
    })

    it('includes navigation ownership metadata on cluster descendants', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as { descendants: Array<Record<string, unknown>> }
      const operation = body.descendants.find(child => child.id === 'orders.Order.operations.cancel')

      assert.equal(operation?.parentId, 'orders.Order')
      assert.equal(operation?.ownedSection, 'operations')
    })

    it('keeps external linked field nodes out of the default cluster payload', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as {
        descendants: Array<{ id: string }>
        includedNodes: Array<{ id: string }>
        edges: Array<{ type: string }>
      }

      assert.equal(body.includedNodes.length, 0)
      assert.ok(!body.descendants.some(node => node.id === 'billing.Invoice.schemas.order.fields.id'))
      assert.ok(!body.edges.some(edge => edge.type === 'maps-to'))
    })

    it('includes requested external field edges and nodes when includeEdges=maps-to', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}&includeEdges=maps-to`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as {
        descendants: Array<{ id: string }>
        includedNodes: Array<{ id: string }>
        edges: Array<{ from: string; to: string; type: string }>
      }

      assert.ok(body.descendants.some(node => node.id === 'orders.Order.schemas.order.fields.id'))
      assert.ok(body.includedNodes.some(node => node.id === 'billing.Invoice.schemas.order.fields.id'))
      assert.ok(body.edges.some(edge =>
        edge.type === 'maps-to'
        && edge.from === 'orders.Order.schemas.order.fields.id'
        && edge.to === 'billing.Invoice.schemas.order.fields.id',
      ))
    })

    it('resolves root node-ref properties to display metadata', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as { root: { properties: Record<string, unknown> } }

      assert.deepEqual(body.root.properties.schema, {
        display: 'order',
        nodeId: 'orders.Order.schemas.order',
      })
    })

    it('returns 404 for unknown nodeId', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=nonexistent`,
      )
      assert.equal(res.status, 404)
    })

    it('returns 400 when nodeId param is missing', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/cluster`)
      assert.equal(res.status, 400)
    })
  })

  describe('GET /api/plugins', () => {
    it('returns an array (empty when no plugins exist)', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/plugins`)
      assert.equal(res.status, 200)
      const body = await res.json() as unknown
      assert.ok(Array.isArray(body))
    })
  })

  describe('web assets', () => {
    it('renders nested property objects as flattened rows in the main table', async () => {
      const [primitivesRes, appRes, styleRes] = await Promise.all([
        fetch(`http://localhost:${handle.port}/primitives.jsx`),
        fetch(`http://localhost:${handle.port}/app.jsx`),
        fetch(`http://localhost:${handle.port}/style.css`),
      ])

      assert.equal(primitivesRes.status, 200)
      assert.equal(appRes.status, 200)
      assert.equal(styleRes.status, 200)

      const primitives = await primitivesRes.text()
      const app = await appRes.text()
      const styles = await styleRes.text()

      assert.match(
        primitives,
        /function buildPropertyRows\(entries, onNavigate, depth = 0/,
      )
      assert.match(
        primitives,
        /const rows = buildPropertyRows\(entries, onNavigate\);/,
      )
      assert.match(
        primitives,
        /className=\{`prop-row\$\{row\.depth > 0 \? ' nested' : ''\}`\}/,
      )
      assert.match(
        primitives,
        /className="mono prop-key-cell">/,
      )
      assert.match(
        primitives,
        /<span className="prop-key-label" style=\{\{ '--prop-depth': row\.depth \}\}>/,
      )
      assert.doesNotMatch(
        primitives,
        /prop-table-nested/,
      )
      assert.match(
        app,
        /function templateDisplayName\(template\) \{\s*return template\?\.ui\?\.displayName \?\? template\?\.name \?\? '';\s*\}/,
      )
      assert.match(
        app,
        /<TemplateBadge name=\{templateDisplayName\(template\)\} colour=\{colour\} \/>/,
      )
      assert.match(
        app,
        /<span>\{templateDisplayName\(template\)\}<\/span>/,
      )
      assert.match(
        app,
        /const rootSpecializedTemplates = new Set\(\['Schema', 'EnumDefinition'\]\);/,
      )
      assert.match(
        app,
        /const rootSpecializedNodes = rootSpecializedTemplates\.has\(root\.template\) \? \[\[root\.template, \[root\]\]\] : \[\];/,
      )
      assert.match(
        app,
        /const \{ root, descendants, includedNodes, edges \} = cluster;/,
      )
      assert.match(
        app,
        /for \(const child of descendants\) \{/,
      )
      assert.match(
        app,
        /const childDisplayEntries = \[\.\.\.displayChildren\.entries\(\)\]/,
      )
      assert.match(
        app,
        /allNodes=\{\[root, \.\.\.descendants, \.\.\.includedNodes\]\}/,
      )
      assert.match(
        primitives,
        /function clusterNodeId\(nodeId\)/,
      )
      assert.match(
        primitives,
        /targetNodeId: clusterNodeId\(otherNodeId\)/,
      )
      assert.match(
        primitives,
        /links\.map\(\(edge, index\) => \{/,
      )
      assert.match(
        primitives,
        /index > 0 && <span key=\{`sep-\$\{edge\.id\}`\}>\{' '\}<\/span>/,
      )
      assert.match(
        app,
        /const displayEntries = \[\.\.\.rootSpecializedNodes, .*childDisplayEntries/,
      )
      assert.match(
        app,
        /function anchorIdForNode\(nodeId\)/,
      )
      assert.match(
        app,
        /const displayedNodeIds = new Set\(\[\s*root\.id,\s*\.\.\.Array\.from\(displayChildren\.values\(\)\)\.reduce\(\(all, group\) => all\.concat\(group\), \[\]\)\.map\(child => child\.id\),\s*\]\);/,
      )
      assert.match(
        app,
        /document\.getElementById\(anchorIdForNode\(targetNodeId\)\)\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' }\);/,
      )
      assert.match(
        app,
        /anchorIdForNode=\{anchorIdForNode\}/,
      )
      assert.match(
        styles,
        /\.prop-row\.nested\s*\{[\s\S]*\}/,
      )
      assert.match(
        styles,
        /\.prop-key-label\s*\{[\s\S]*padding-left:\s*calc\(var\(--prop-depth,\s*0\)\s*\*\s*24px\);/,
      )
    })
  })
})
