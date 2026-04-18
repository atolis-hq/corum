import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startWebServer, type WebServerHandle } from '../src/web/server.js'
import type { Graph } from '../src/schema/index.js'

function makeTestGraph(): Graph {
  const templates = new Map()
  templates.set('DomainModel', {
    name: 'DomainModel',
    version: '1',
    core: false,
    description: 'A domain model',
    ui: { colour: '#4a90e2', icon: 'model' },
  })
  templates.set('Field', {
    name: 'Field',
    version: '1',
    core: true,
  })

  const orderNode = {
    id: 'orders.Order',
    template: 'DomainModel',
    component: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'An order' },
  }
  const fieldNode = {
    id: 'orders.Order.id',
    template: 'Field',
    component: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { scalarType: 'uuid' },
  }

  const nodesById = new Map()
  nodesById.set('orders.Order', orderNode)
  nodesById.set('orders.Order.id', fieldNode)

  const edgesByFrom = new Map()
  const edgesByTo = new Map()

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
      assert.equal(body.length, 1)
      assert.equal(body[0].name, 'DomainModel')
      assert.equal(body[0].core, false)
    })

    it('includes core templates when ?includeCore=true', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/templates?includeCore=true`)
      const body = await res.json() as Array<{ name: string }>
      assert.equal(body.length, 2)
      const names = body.map(t => t.name).sort()
      assert.deepEqual(names, ['DomainModel', 'Field'])
    })

    it('includes ui config in response', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/templates`)
      const body = await res.json() as Array<{ name: string; ui?: { colour?: string } }>
      const dm = body.find(t => t.name === 'DomainModel')
      assert.equal(dm?.ui?.colour, '#4a90e2')
    })
  })

  describe('GET /api/nodes', () => {
    it('returns all nodes with no filter', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes`)
      assert.equal(res.status, 200)
      const body = await res.json() as Array<{ id: string; template: string }>
      assert.equal(body.length, 2)
      const ids = body.map(n => n.id).sort()
      assert.deepEqual(ids, ['orders.Order', 'orders.Order.id'])
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
      assert.equal(body.length, 2)
    })

    it('returns id, template, component, state, stability only', async () => {
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
  })

  describe('GET /api/cluster', () => {
    it('returns cluster for a valid nodeId', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as { root: { id: string }; children: unknown[]; edges: unknown[] }
      assert.equal(body.root.id, 'orders.Order')
      assert.ok(Array.isArray(body.children))
      assert.ok(Array.isArray(body.edges))
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
})
