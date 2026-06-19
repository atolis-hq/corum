import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWebServer, type WebServerHandle } from '../src/web/server.js'
import { loadGraph } from '../src/loader/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { LoadError, type Graph } from '../src/schema/index.js'
import type { ContentMap, GraphSource } from '../src/source/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

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
    properties: {
      type: 'object',
      properties: {
        linkedSchema: { type: 'string', format: 'node-ref' },
      },
    },
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
    properties: { description: 'Cancel an order', linkedSchema: 'orders.Order.schemas.order' },
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

function writeWatcherFixture(root: string): { graphPath: string; nodePath: string; templatePath: string } {
  const graphPath = path.join(root, 'graph')
  const packPath = path.join(root, 'pack')
  const templatesPath = path.join(packPath, 'templates')
  const componentPath = path.join(graphPath, 'components', 'orders')
  fs.mkdirSync(templatesPath, { recursive: true })
  fs.mkdirSync(componentPath, { recursive: true })
  fs.mkdirSync(path.join(graphPath, 'edges'), { recursive: true })

  fs.writeFileSync(
    path.join(graphPath, 'graph.yaml'),
    [
      'schemaVersion: "1"',
      'templatePacks:',
      '  - name: test',
      '    path: ../pack',
      '',
    ].join('\n'),
  )

  const templatePath = path.join(templatesPath, 'Thing.yaml')
  fs.writeFileSync(
    templatePath,
    [
      'name: Thing',
      'info:',
      '  version: "1"',
      'ui:',
      '  displayName: Thing',
      '',
    ].join('\n'),
  )

  const nodePath = path.join(componentPath, 'thing.yaml')
  fs.writeFileSync(
    nodePath,
    [
      'id: orders.Thing.first',
      'template: Thing',
      'schemaVersion: "1"',
      'metadata:',
      '  component: orders',
      '  state: draft',
      '  stability: unstable',
      '  lastModifiedAt: "2026-04-25"',
      'properties:',
      '  description: First version',
      '',
    ].join('\n'),
  )

  return { graphPath, nodePath, templatePath }
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000
  let last: T
  do {
    last = await read()
    if (predicate(last)) return last
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (Date.now() < deadline)
  assert.fail(`condition was not met; last value: ${JSON.stringify(last)}`)
}

async function startStandaloneWebEntrypoint(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, [path.join(repoRoot, 'dist/src/web/server.js')], {
    env: {
      ...process.env,
      CORUM_GRAPH_PATH: fixtureGraphDir,
      CORUM_WEB_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let logs = ''
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`standalone web server did not start; logs: ${logs}`))
    }, 5000)

    child.once('error', err => {
      clearTimeout(timeout)
      reject(err)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`standalone web server exited early with code ${code} signal ${signal}; logs: ${logs}`))
    })

    child.stderr.on('data', chunk => {
      logs += chunk.toString()
      const match = logs.match(/http:\/\/localhost:(\d+)/)
      if (!match) return

      clearTimeout(timeout)
      child.removeAllListeners('exit')
      resolve({ child, port: Number(match[1]) })
    })
  })
}

async function stopStandaloneWebEntrypoint(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>(resolve => {
    child.once('exit', () => resolve())
    child.kill()
  })
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

  describe('multi-branch API', () => {
    let sourceHandle: WebServerHandle

    before(async () => {
      const source = new FileGraphSource({ graphDir: fixtureGraphDir })
      const graph = await loadGraph({ source })
      sourceHandle = await startWebServer(graph, { port: 0, source })
    })

    after(async () => {
      await sourceHandle.close()
    })

    it('GET /api/branches returns 501 without a configured source', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/branches`)

      assert.equal(res.status, 501)
      assert.deepEqual(await res.json(), { error: 'multi-branch requires a configured source' })
    })

    it('GET /api/branches returns one FileGraphSource default branch', async () => {
      const res = await fetch(`http://localhost:${sourceHandle.port}/api/branches`)

      assert.equal(res.status, 200)
      const body = await res.json() as {
        default: string
        branches: Array<{ ref: string; isDefault: boolean }>
        results: Array<{ ref: string; status: string }>
      }
      assert.equal(body.branches.length, 1)
      assert.deepEqual(body.branches, [{ ref: body.default, isDefault: true }])
      assert.deepEqual(body.results, [{ ref: body.default, status: 'loaded' }])
    })

    it('GET /api/overlay/:ref returns FileGraphSource nodes as local', async () => {
      const branchesRes = await fetch(`http://localhost:${sourceHandle.port}/api/branches`)
      const branchesBody = await branchesRes.json() as { default: string }

      const res = await fetch(
        `http://localhost:${sourceHandle.port}/api/overlay/${encodeURIComponent(branchesBody.default)}`,
      )

      assert.equal(res.status, 200)
      const body = await res.json() as {
        viewingRef: string
        nodes: Array<{ id: string; ghostState: string; branches: string[]; node: { id: string } }>
      }
      assert.equal(body.viewingRef, branchesBody.default)
      assert.ok(body.nodes.length > 0)
      assert.ok(body.nodes.every(node => node.ghostState === 'local'))
      assert.ok(body.nodes.every(node => node.branches.length === 1 && node.branches[0] === branchesBody.default))
      assert.ok(body.nodes.every(node => node.id === node.node.id))
    })

    it('GET /api/branches includes diagnostics for failed branch loads', async () => {
      const failingGraph = makeTestGraph()
      const failingHandle = await startWebServer(failingGraph, { port: 0, source: new FailingBranchSource() })
      try {
        const res = await fetch(`http://localhost:${failingHandle.port}/api/branches`)

        assert.equal(res.status, 200)
        const body = await res.json() as {
          results: Array<{ ref: string; status: string; error?: string; diagnostics?: Array<{ file: string; message: string }> }>
        }
        const failed = body.results.find(result => result.ref === 'feat/fails')
        assert.equal(failed?.status, 'failed')
        assert.equal(failed?.error, 'Graph load failed with 1 error(s)')
        assert.deepEqual(failed?.diagnostics, [
          {
            severity: 'error',
            file: 'components/orders/broken.yaml',
            message: 'unknown template: MissingTemplate',
          },
        ])
      } finally {
        await failingHandle.close()
      }
    })

    it('POST /api/reload invalidates cached branch state', async () => {
      const source = new MutableBranchSource()
      const graph = await loadGraph({ source })
      const reloadingHandle = await startWebServer(graph, { port: 0, source, logger: () => {} })
      try {
        const before = await fetch(`http://localhost:${reloadingHandle.port}/api/branches`).then(res => res.json()) as {
          branches: Array<{ ref: string }>
        }
        assert.deepEqual(before.branches.map(branch => branch.ref), ['main'])

        source.setBranches(['main', 'feat/two'])

        const reloadRes = await fetch(`http://localhost:${reloadingHandle.port}/api/reload`, { method: 'POST' })
        assert.equal(reloadRes.status, 202)

        const after = await fetch(`http://localhost:${reloadingHandle.port}/api/branches`).then(res => res.json()) as {
          branches: Array<{ ref: string }>
        }
        assert.deepEqual(after.branches.map(branch => branch.ref), ['main', 'feat/two'])
      } finally {
        await reloadingHandle.close()
      }
    })

    it('git polling invalidates cached branch state when the repo signature changes', async () => {
      const source = new MutableBranchSource()
      const graph = await loadGraph({ source })
      const pollingHandle = await startWebServer(graph, {
        port: 0,
        source,
        gitPollSeconds: 0.05,
        logger: () => {},
      })
      try {
        const before = await fetch(`http://localhost:${pollingHandle.port}/api/branches`).then(res => res.json()) as {
          branches: Array<{ ref: string }>
        }
        assert.deepEqual(before.branches.map(branch => branch.ref), ['main'])

        source.setBranches(['main', 'feat/two'])

        const after = await eventually(
          async () => fetch(`http://localhost:${pollingHandle.port}/api/branches`).then(res => res.json()) as Promise<{
            branches: Array<{ ref: string }>
          }>,
          body => body.branches.some(branch => branch.ref === 'feat/two'),
        )
        assert.deepEqual(after.branches.map(branch => branch.ref), ['main', 'feat/two'])
      } finally {
        await pollingHandle.close()
      }
    })
  })

  describe('?ref= support', () => {
    let sourceHandle: WebServerHandle

    before(async () => {
      const source = new FileGraphSource({ graphDir: fixtureGraphDir })
      const graph = await loadGraph({ source })
      sourceHandle = await startWebServer(graph, { port: 0, source })
    })

    after(async () => {
      await sourceHandle.close()
    })

    it('GET /api/nodes returns same nodes with valid ?ref= as without (single-branch source)', async () => {
      const branchesRes = await fetch(`http://localhost:${sourceHandle.port}/api/branches`)
      const { default: defaultRef } = await branchesRes.json() as { default: string }
      const [noRef, withRef] = await Promise.all([
        fetch(`http://localhost:${sourceHandle.port}/api/nodes`).then(r => r.json()) as Promise<Array<{ id: string }>>,
        fetch(`http://localhost:${sourceHandle.port}/api/nodes?ref=${encodeURIComponent(defaultRef)}`).then(r => r.json()) as Promise<Array<{ id: string }>>,
      ])
      assert.deepEqual(withRef.map(n => n.id).sort(), noRef.map(n => n.id).sort())
    })

    it('GET /api/nodes falls back to default graph for unknown ?ref=', async () => {
      const defaultRes = await fetch(`http://localhost:${sourceHandle.port}/api/nodes`)
      const defaultBody = await defaultRes.json() as Array<{ id: string }>
      const refRes = await fetch(`http://localhost:${sourceHandle.port}/api/nodes?ref=nonexistent-branch`)
      assert.equal(refRes.status, 200)
      const refBody = await refRes.json() as Array<{ id: string }>
      assert.deepEqual(refBody.map(n => n.id).sort(), defaultBody.map(n => n.id).sort())
    })

    it('GET /api/nodes ignores ?ref= when no source configured', async () => {
      const noSourceHandle = await startWebServer(makeTestGraph(), { port: 0 })
      try {
        const res = await fetch(`http://localhost:${noSourceHandle.port}/api/nodes?ref=main`)
        assert.equal(res.status, 200)
        const body = await res.json() as Array<{ id: string }>
        assert.equal(body.length, 3)
      } finally {
        await noSourceHandle.close()
      }
    })

    it('GET /api/templates returns same templates with valid ?ref= (single-branch source)', async () => {
      const branchesRes = await fetch(`http://localhost:${sourceHandle.port}/api/branches`)
      const { default: defaultRef } = await branchesRes.json() as { default: string }
      const [noRef, withRef] = await Promise.all([
        fetch(`http://localhost:${sourceHandle.port}/api/templates`).then(r => r.json()) as Promise<Array<{ name: string }>>,
        fetch(`http://localhost:${sourceHandle.port}/api/templates?ref=${encodeURIComponent(defaultRef)}`).then(r => r.json()) as Promise<Array<{ name: string }>>,
      ])
      assert.deepEqual(withRef.map(t => t.name).sort(), noRef.map(t => t.name).sort())
    })

    it('GET /api/cluster returns overlay: null when overlayRefs not provided', async () => {
      const branchesRes = await fetch(`http://localhost:${sourceHandle.port}/api/branches`)
      const { default: defaultRef } = await branchesRes.json() as { default: string }
      const nodesRes = await fetch(`http://localhost:${sourceHandle.port}/api/nodes`)
      const nodes = await nodesRes.json() as Array<{ id: string; template: string }>
      const root = nodes.find(n => !n.id.includes('.')) ?? nodes[0]
      if (!root) return

      const res = await fetch(
        `http://localhost:${sourceHandle.port}/api/cluster?nodeId=${encodeURIComponent(root.id)}&ref=${encodeURIComponent(defaultRef)}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as { root: { id: string }; overlay: unknown }
      assert.equal(body.root.id, root.id)
      assert.equal(body.overlay, null)
    })

    it('GET /api/cluster with overlayRefs= returns overlay null when no ghost fields (single-branch source)', async () => {
      const branchesRes = await fetch(`http://localhost:${sourceHandle.port}/api/branches`)
      const { default: defaultRef } = await branchesRes.json() as { default: string }
      const nodesRes = await fetch(`http://localhost:${sourceHandle.port}/api/nodes`)
      const nodes = await nodesRes.json() as Array<{ id: string }>
      const root = nodes[0]
      if (!root) return

      const res = await fetch(
        `http://localhost:${sourceHandle.port}/api/cluster?nodeId=${encodeURIComponent(root.id)}&ref=${encodeURIComponent(defaultRef)}&overlayRefs=${encodeURIComponent(defaultRef)}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as { overlay: unknown }
      assert.equal(body.overlay, null)
    })
  })

  describe('standalone entrypoint', () => {
    it('passes configured source to the web server options', async () => {
      const { child, port } = await startStandaloneWebEntrypoint()
      try {
        const res = await fetch(`http://localhost:${port}/api/branches`)

        assert.equal(res.status, 200)
        const body = await res.json() as {
          default: string
          branches: Array<{ ref: string; isDefault: boolean }>
        }
        assert.deepEqual(body.branches, [{ ref: body.default, isDefault: true }])
      } finally {
        await stopStandaloneWebEntrypoint(child)
      }
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

    it('resolves descendant node-ref properties to display metadata', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as { descendants: Array<{ id: string; properties: Record<string, unknown> }> }
      const operation = body.descendants.find(d => d.id === 'orders.Order.operations.cancel')

      assert.deepEqual(operation?.properties.linkedSchema, {
        display: 'orders.Order.schemas.order',
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

  describe('file watcher', () => {
    it('reloads graph files and template files when enabled', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-watch-'))
      let watchedHandle: WebServerHandle | undefined
      try {
        const { graphPath, nodePath, templatePath } = writeWatcherFixture(tmp)
        const watchedGraph = await loadGraph({ graphPath })
        watchedHandle = await startWebServer(watchedGraph, {
          port: 0,
          graphPath,
          fileWatcher: true,
          fileWatcherDebounceMs: 25,
          logger: () => {},
        })

        fs.writeFileSync(
          nodePath,
          [
            'id: orders.Thing.first',
            'template: Thing',
            'schemaVersion: "1"',
            'metadata:',
            '  component: orders',
            '  state: agreed',
            '  stability: stable',
            '  lastModifiedAt: "2026-04-25"',
            'properties:',
            '  description: Second version',
            '',
          ].join('\n'),
        )

        const nodes = await eventually(
          async () => fetch(`http://localhost:${watchedHandle!.port}/api/nodes`).then(res => res.json()) as Promise<Array<{ id: string; state: string }>>,
          body => body.some(node => node.id === 'orders.Thing.first' && node.state === 'agreed'),
        )
        assert.ok(nodes.some(node => node.id === 'orders.Thing.first' && node.state === 'agreed'))

        fs.writeFileSync(
          templatePath,
          [
            'name: Thing',
            'info:',
            '  version: "1"',
            'ui:',
            '  displayName: Renamed Thing',
            '',
          ].join('\n'),
        )

        const templates = await eventually(
          async () => fetch(`http://localhost:${watchedHandle!.port}/api/templates`).then(res => res.json()) as Promise<Array<{ name: string; ui?: { displayName?: string } }>>,
          body => body.some(template => template.name === 'Thing' && template.ui?.displayName === 'Renamed Thing'),
        )
        assert.ok(templates.some(template => template.name === 'Thing' && template.ui?.displayName === 'Renamed Thing'))
      } finally {
        if (watchedHandle) await watchedHandle.close()
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('web assets', () => {
    let primitives = ''
    let app = ''
    let styles = ''
    let statusCodes = { primitives: 0, app: 0, styles: 0 }

    before(async () => {
      const [primitivesRes, appRes, styleRes] = await Promise.all([
        fetch(`http://localhost:${handle.port}/primitives.jsx`),
        fetch(`http://localhost:${handle.port}/app.jsx`),
        fetch(`http://localhost:${handle.port}/style.css`),
      ])
      statusCodes = { primitives: primitivesRes.status, app: appRes.status, styles: styleRes.status }
      primitives = await primitivesRes.text()
      app = await appRes.text()
      styles = await styleRes.text()
    })

    it('serves static files with 200', () => {
      assert.equal(statusCodes.primitives, 200)
      assert.equal(statusCodes.app, 200)
      assert.equal(statusCodes.styles, 200)
    })

    it('primitives: buildPropertyRows uses depth for nested row indentation', () => {
      assert.match(primitives, /function buildPropertyRows\(entries, onNavigate, depth = 0/)
      assert.match(primitives, /const rows = buildPropertyRows\(entries, onNavigate\);/)
      assert.match(primitives, /className=\{`prop-row\$\{row\.depth > 0 \? ' nested' : ''\}`\}/)
      assert.match(primitives, /className="mono prop-key-cell">/)
      assert.match(primitives, /<span className="prop-key-label" style=\{\{ '--prop-depth': row\.depth \}\}>/)
    })

    it('primitives: no legacy prop-table-nested class', () => {
      assert.doesNotMatch(primitives, /prop-table-nested/)
    })

    it('primitives: clusterNodeId resolves field links to cluster root', () => {
      assert.match(primitives, /function clusterNodeId\(nodeId\)/)
      assert.match(primitives, /targetNodeId: clusterNodeId\(otherNodeId\)/)
    })

    it('primitives: edge links rendered with separators between multiple links', () => {
      assert.match(primitives, /links\.map\(\(edge, index\) => \{/)
      assert.match(primitives, /index > 0 && <span key=\{`sep-\$\{edge\.id\}`\}>\{' '\}<\/span>/)
    })

    it('app: templateDisplayName resolves ui.displayName and is used for labels', () => {
      assert.match(app, /function templateDisplayName\(template\) \{\s*return template\?\.ui\?\.displayName \?\? template\?\.name \?\? '';\s*\}/)
      assert.match(app, /<TemplateBadge name=\{templateDisplayName\(template\)\} colour=\{colour\} \/>/)
      assert.match(app, /<span>\{templateDisplayName\(template\)\}<\/span>/)
    })

    it('app: cluster data destructures descendants and includedNodes', () => {
      assert.match(app, /const \{ root, descendants, includedNodes, edges \} = cluster;/)
      assert.match(app, /for \(const child of descendants\) \{/)
      assert.match(app, /const childDisplayEntries = \[\.\.\.displayChildren\.entries\(\)\]/)
    })

    it('app: reload events refetch branches, graph lists, and visible cluster data', () => {
      assert.match(app, /new EventSource\('\/api\/events'\)/)
      assert.match(app, /const refreshBranchState = useCallback\(\(\) => \{/)
      assert.match(app, /const refreshAllData = useCallback\(\(\) => \{/)
      assert.match(app, /eventSource\.addEventListener\('graph-reloaded', refreshAllData\)/)
      assert.match(app, /refreshToken/)
      assert.match(app, /fetch\(`\/api\/cluster\?nodeId=\$\{encodeURIComponent\(nodeId\)\}&includeEdges=maps-to,reads\$\{refParam\}\$\{overlayParam\}`\)/)
    })

    it('app: SchemaCard receives allNodes including includedNodes', () => {
      assert.match(app, /allNodes=\{\[root, \.\.\.descendants, \.\.\.includedNodes\]\}/)
    })

    it('primitives: nested child schemas render overlay ghost rows in the recursive schema view', () => {
      assert.match(primitives, /function SchemaFieldRows\(\{ schemaName, model, prefix = '', depth = 0, visited = new Set\(\), edges = \[\], overlayFields, overlayRefs \}\)/)
      assert.match(primitives, /const childSchemaNode = canExpand \? model\.schemasByName\.get\(localRef\) : null;/)
      assert.match(primitives, /const childGhostFields = childSchemaNode \? overlayFieldsForSchema\(overlayFields, childSchemaNode\.id\) : \[\];/)
      assert.match(primitives, /<SchemaFieldRows[\s\S]*overlayFields=\{overlayFields\}[\s\S]*overlayRefs=\{overlayRefs\}/)
      assert.match(primitives, /\{childGhostFields\.length > 0 && \(\s*<GhostFieldRows fields=\{childGhostFields\} overlayRefs=\{overlayRefs\} prefix=\{childPrefix\} depth=\{depth \+ 1\} \/>\s*\)\}/)
      assert.match(primitives, /function GhostFieldRows\(\{ fields, overlayRefs, prefix = '', depth = 0 \}\)/)
      assert.match(primitives, /const name = prefix \+ \(fieldLocalName\(field\.id\)\);/)
      assert.match(primitives, /className=\{`field-row overlay-ghost \$\{stripeClass\}\$\{depth > 0 \? ' nested' : ''\}`\}/)
      assert.match(primitives, /style=\{\{ '--field-depth': depth \}\}/)
    })

    it('primitives: fieldSchemaName resolves fields from standalone Schema nodes', () => {
      assert.match(primitives, /if \(fieldIdx < 0\) return null;/)
      assert.match(primitives, /if \(schemaIdx < 0\)/)
      assert.match(primitives, /return nodeId\.slice\(0, fieldIdx\)\.split\('\.'\)\.pop\(\) \?\? null;/)
    })

    it('app: rootSpecializedTemplates handles Schema and EnumDefinition nodes', () => {
      assert.match(app, /const rootSpecializedTemplates = new Set\(\['Schema', 'EnumDefinition'\]\);/)
      assert.match(app, /const rootSpecializedNodes = rootSpecializedTemplates\.has\(root\.template\) \? \[\[root\.template, \[root\]\]\] : \[\];/)
      assert.match(app, /const displayEntries = \[\.\.\.rootSpecializedNodes, .*childDisplayEntries/)
    })

    it('app: anchorIdForNode enables scroll-to navigation within the page', () => {
      assert.match(app, /function anchorIdForNode\(nodeId\)/)
      assert.match(app, /const displayedNodeIds = new Set\(\[\s*root\.id,\s*\.\.\.Array\.from\(displayChildren\.values\(\)\)\.reduce\(\(all, group\) => all\.concat\(group\), \[\]\)\.map\(child => child\.id\),\s*\.\.\.includedNodes\.map\(n => n\.id\),\s*\]\);/)
      assert.match(app, /document\.getElementById\(anchorIdForNode\(targetNodeId\)\)\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' }\);/)
      assert.match(app, /anchorIdForNode=\{anchorIdForNode\}/)
    })

    it('app: component nav behaves as a single-open accordion', () => {
      assert.match(app, /const sortedComponents = \[\.\.\.navTree\.keys\(\)\]\.sort\(\(a, b\) => a\.localeCompare\(b\)\);/)
      assert.match(app, /const \[openComponent, setOpenComponent\] = useState\(\);/)
      assert.match(app, /if \(openComponent === undefined\) \{\s*setOpenComponent\(sortedComponents\[0\] \?\? null\);/)
      assert.match(app, /setOpenComponent\(prev => prev === component \? null : component\);/)
      assert.doesNotMatch(app, /for \(const component of navTree\.keys\(\)\) initial\[component\] = true;/)
    })

    it('style: nested property row depth indentation via CSS variable', () => {
      assert.match(styles, /\.prop-row\.nested\s*\{[\s\S]*\}/)
      assert.match(styles, /\.prop-key-label\s*\{[\s\S]*padding-left:\s*calc\(var\(--prop-depth,\s*0\)\s*\*\s*24px\);/)
    })

    it('style: branch picker is not clipped by the branch bar', () => {
      assert.match(styles, /\.branch-picker\s*\{[\s\S]*z-index:\s*100;/)
      assert.match(styles, /\.branch-bar\s*\{[^}]*overflow:\s*visible;/)
    })

    it('style: non-conflict ghost rows use a stronger neutral grey background while conflicts stay red', () => {
      assert.match(styles, /\.field-row\.overlay-ghost\s*\{[^}]*background:\s*color-mix\(in oklch,\s*var\(--ink\)\s*6%,\s*var\(--paper\)\);/)
      assert.match(styles, /\.overlay-stripe-0\s*\{[^}]*background:\s*color-mix\(in oklch,\s*var\(--ink\)\s*8%,\s*var\(--paper\)\);/)
      assert.match(styles, /\.overlay-stripe-1\s*\{[^}]*background:\s*color-mix\(in oklch,\s*var\(--ink\)\s*8%,\s*var\(--paper\)\);/)
      assert.match(styles, /\.overlay-conflict\s*\{[^}]*background:\s*color-mix\(in oklch,\s*#c44\s*5%,\s*var\(--paper\)\);/)
    })

    it('app: components section navigation still routes through /components', () => {
      assert.match(app, /function handleSection\(section\) \{/)
      assert.match(app, /navigate\(buildRoute\(\{ pathname: `\/\$\{section\}`, params: \{\}, branch: viewingRef \}\)\);/)
      assert.match(app, /const showTree = activeSection === 'components' \|\| activeNodeId;/)
      assert.match(app, /} else if \(route\.pathname === '\/components'\) \{\s*page = <ComponentsPage \/>;/)
    })

    it('app: initial route state is derived from window.location.hash', () => {
      assert.match(app, /const \[route, setRoute\] = useState\(\(\) => parseRoute\(window\.location\.hash\)\);/)
      assert.match(app, /const handler = \(\) => setRoute\(parseRoute\(window\.location\.hash\)\);/)
      assert.doesNotMatch(app, /const \[route, setRoute\] = useState\(parseRoute\);/)
      assert.doesNotMatch(app, /setRoute\(parseRoute\(\)\);/)
    })

    it('app: overlay nav dots are derived from diff-aware indicator ids', () => {
      assert.match(app, /const \{ buildNavTree, buildOverlayIndicatorIds \} = window\.CorumNav;/)
      assert.match(app, /setOverlayIndicatorIds\(buildOverlayIndicatorIds\(nodes, templates, data\.nodes \|\| \[\], activeOverlayRefs\)\);/)
      assert.doesNotMatch(app, /\.filter\(node => activeOverlayRefs\.some\(ref => node\.branches\.includes\(ref\)\)\)\s*\.map\(node => node\.id\)/)
    })

    it('app: branch picker renders failed branches and their load errors', () => {
      assert.match(app, /const \[branchResults, setBranchResults\] = useState\(\[\]\);/)
      assert.match(app, /setBranchResults\(data\.results \|\| \[\]\);/)
      assert.match(app, /const failedBranches = branchResults\.filter\(result => result\.status === 'failed'\);/)
      assert.match(app, /className=\"branch-failed-badge\"/)
      assert.match(app, /className=\"branch-picker-item branch-picker-item-disabled\"/)
      assert.match(app, /className=\"branch-picker-error\"/)
    })

    it('app: selected mode uses a separate multi-select compare picker and preserves valid compare refs', () => {
      assert.match(app, /const \[comparePickerOpen, setComparePickerOpen\] = useLocalState\(false\);/)
      assert.match(app, /const compareableBranches = branches\.filter\(branch => branch\.ref !== viewingRef\);/)
      assert.match(app, /overlayMode === 'selected' && \(/)
      assert.match(app, /<span className=\"branch-label\">Compare<\/span>/)
      assert.match(app, /className=\"branch-chip overlay branch-chip-select\"/)
      assert.match(app, /onClick=\{\(\) => \{ setComparePickerOpen\(open => !open\); setPickerOpen\(false\); \}\}/)
      assert.match(app, /type=\"checkbox\"/)
      assert.match(app, /checked=\{overlayRefs\.includes\(branch\.ref\)\}/)
      assert.match(app, /onOverlayRefs\(overlayRefs\.includes\(branch\.ref\)/)
      assert.match(app, /setOverlayRefs\(prev => prev\.filter\(ref => ref !== viewingRef && branches\.some\(branch => branch\.ref === ref\)\)\);/)
    })

    it('app: branch bar exposes an always-visible reload button backed by the reload endpoint', () => {
      assert.match(app, /function BranchBar\(\{ branches, branchResults, viewingRef, overlayRefs, overlayMode, onViewingRef, onOverlayRefs, onOverlayMode, onReload \}\)/)
      assert.match(app, /className="branch-chip reload"/)
      assert.match(app, /onClick=\{onReload\}/)
      assert.match(app, /fetch\('\/api\/reload', \{ method: 'POST' \}\)/)
      assert.match(app, /\.then\(\(\) => refreshAllData\(\)\)/)
      assert.match(app, /\.catch\(\(\) => refreshAllData\(\)\)/)
    })

    it('style: failed branches in the picker are visibly disabled and show errors', () => {
      assert.match(styles, /\.branch-failed-badge\s*\{[\s\S]*background:/)
      assert.match(styles, /\.branch-picker-item-disabled\s*\{[\s\S]*cursor:\s*not-allowed;/)
      assert.match(styles, /\.branch-picker-error\s*\{[\s\S]*font-size:\s*10px;/)
    })

    it('style: compare picker supports checkbox selection affordances', () => {
      assert.match(styles, /\.branch-chip-select\s*\{[\s\S]*border:/)
      assert.match(styles, /\.branch-picker-check\s*\{[\s\S]*accent-color:/)
      assert.match(styles, /\.branch-picker-item-selectable\s*\{[\s\S]*justify-content:\s*space-between;/)
    })

    it('style: reload button is styled as a dedicated branch chip action', () => {
      assert.match(styles, /\.branch-chip\.reload\s*\{[\s\S]*cursor:\s*pointer;/)
      assert.match(styles, /\.branch-chip\.reload:hover\s*\{/)
    })

    it('app: overlayRefs encoded as repeated query params not comma-joined', () => {
      assert.doesNotMatch(app, /overlayRefs\.map\(ref => encodeURIComponent\(ref\)\)\.join\(','\)/)
      assert.match(app, /overlayRefs\.map\(ref => `overlayRefs=\$\{encodeURIComponent\(ref\)\}`\)\.join\('&'\)/)
    })

    it('app: branch picker dismisses on click outside', () => {
      assert.match(app, /document\.addEventListener\('mousedown', handleClickOutside\)/)
      assert.match(app, /document\.removeEventListener\('mousedown', handleClickOutside\)/)
    })
  })
})

class FailingBranchSource implements GraphSource {
  async defaultBranch(): Promise<string> {
    return 'main'
  }

  async listBranches(): Promise<string[]> {
    return ['main', 'feat/fails']
  }

  async loadPackContent(): Promise<ContentMap> {
    return new Map()
  }

  async loadGraphContent(ref: string): Promise<ContentMap> {
    if (ref === 'feat/fails') {
      throw new LoadError([
        {
          severity: 'error',
          file: 'components/orders/broken.yaml',
          message: 'unknown template: MissingTemplate',
        },
      ])
    }
    return new Map()
  }

  async commit(): Promise<void> {
    throw new Error('not implemented')
  }
}

class MutableBranchSource implements GraphSource {
  private branches = ['main']
  private defaultRef = 'main'

  setBranches(branches: string[]): void {
    this.branches = [...branches]
  }

  async defaultBranch(): Promise<string> {
    return this.defaultRef
  }

  async listBranches(): Promise<string[]> {
    return [...this.branches]
  }

  async loadPackContent(): Promise<ContentMap> {
    return new Map([
      ['pack/templates/Thing.yaml', [
        'name: Thing',
        'info:',
        '  version: "1"',
        'ui:',
        '  displayName: Thing',
        '',
      ].join('\n')],
    ])
  }

  async loadGraphContent(ref: string): Promise<ContentMap> {
    return new Map([
      ['graph.yaml', [
        'schemaVersion: "1"',
        'templatePacks:',
        '  - name: pack',
        '    path: ../pack',
        '',
      ].join('\n')],
      [`components/orders/${ref.replace(/[^\w-]/g, '_')}.yaml`, [
        `id: orders.Thing.${ref.replace(/[^\w-]/g, '_')}`,
        'template: Thing',
        'schemaVersion: "1"',
        'metadata:',
        '  component: orders',
        '  state: agreed',
        '  stability: stable',
        '  lastModifiedAt: "2026-05-02"',
        'properties:',
        `  description: ${ref}`,
        '',
      ].join('\n')],
    ])
  }

  async commit(): Promise<void> {
    throw new Error('not implemented')
  }

  async reloadSignature(): Promise<string> {
    return this.branches.join('|')
  }
}
