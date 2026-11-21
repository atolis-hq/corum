import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startGraphFileWatcher, startWebServer, type WebServerHandle } from '../src/web/server.js'
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
    info: { version: '1', core: true, role: 'field' },
    ui: { displayName: 'Field' },
  })
  templates.set('Schema', {
    name: 'Schema',
    info: { version: '1', core: true, role: 'type-container' },
    ui: { displayName: 'Schema' },
  })

  const orderNode = {
    id: 'orders.Order',
    template: 'DomainModel',
    namespace: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'An order', schema: '#/schemas/order' },
  }
  const schemaNode = {
    id: 'orders.Order.schemas.order', parentId: 'orders.Order',
    template: 'Schema',
    namespace: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'Order schema' },
  }
  const fieldNode = {
    id: 'orders.Order.schemas.order.fields.id', parentId: 'orders.Order.schemas.order',
    template: 'Field',
    namespace: 'orders',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { type: 'uuid' },
  }
  const externalSchemaNode = {
    id: 'billing.Invoice.schemas.order',
    template: 'Schema',
    namespace: 'billing',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'Billing order schema' },
  }
  const externalFieldNode = {
    id: 'billing.Invoice.schemas.order.fields.id', parentId: 'billing.Invoice.schemas.order',
    template: 'Field',
    namespace: 'billing',
    state: 'agreed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { type: 'uuid' },
  }
  const operationNode = {
    id: 'orders.Order.operations.cancel', parentId: 'orders.Order',
    template: 'DomainOperation',
    namespace: 'orders',
    state: 'proposed' as const,
    stability: 'stable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-04-18',
    properties: { description: 'Cancel an order', linkedSchema: 'orders.Order.schemas.order' },
  }
  const orphanOperationNode = {
    id: 'orders.CancelOrder',
    template: 'DomainOperation',
    namespace: 'orders',
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
  const precedesEdge = {
    id: 'orders.Order__precedes__orders.CancelOrder',
    from: 'orders.Order',
    to: 'orders.CancelOrder',
    type: 'precedes' as const,
    state: 'agreed' as const,
    stability: 'stable' as const,
  }
  const edgesByFrom = new Map([
    [mapsToEdge.from, [mapsToEdge]],
    [precedesEdge.from, [precedesEdge]],
  ])
  const edgesByTo = new Map([
    [mapsToEdge.to, [mapsToEdge]],
    [precedesEdge.to, [precedesEdge]],
  ])
  const edgeTypes = new Map([
    ['maps-to', { name: 'maps-to', category: 'lineage' as const }],
    ['precedes', { name: 'precedes', category: 'semantic' as const }],
  ])

  return { nodesById, edgesByFrom, edgesByTo, templates, edgeTypes, diagnostics: [] }
}

function writeWatcherFixture(root: string): { graphPath: string; nodePath: string; templatePath: string } {
  const graphPath = path.join(root, 'graph')
  const packPath = path.join(root, 'pack')
  const templatesPath = path.join(packPath, 'templates')
  const componentPath = path.join(graphPath, 'nodes', 'orders')
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

    child.stdout.on('data', chunk => {
      logs += chunk.toString()
      const match = logs.match(/http:\/\/localhost:(\d+)/)
      if (!match) return

      clearTimeout(timeout)
      child.removeAllListeners('exit')
      resolve({ child, port: Number(match[1]) })
    })
    child.stderr.on('data', chunk => { logs += chunk.toString() })
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

  describe('vendor assets', () => {
    it('serves the allowlisted UMD bundle as javascript', async () => {
      const res = await fetch(`http://localhost:${handle.port}/vendor/react.umd.js`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type') ?? '', /text\/javascript/)
    })

    it('serves generated shims with explicit named exports', async () => {
      const react = await fetch(`http://localhost:${handle.port}/vendor/shims/react.js`)
      assert.equal(react.status, 200)
      assert.match(await react.text(), /export const useState/)
      const jsx = await fetch(`http://localhost:${handle.port}/vendor/shims/react-jsx-runtime.js`)
      assert.equal(jsx.status, 200)
      assert.match(await jsx.text(), /export function jsx/)
    })

    it('rejects traversal and names outside the allowlist', async () => {
      for (const p of ['/vendor/nope.js', '/vendor/..%2fpackage.json', '/vendor/shims/nope.js', '/vendor/shims/..%2f..%2fpackage.json']) {
        const res = await fetch(`http://localhost:${handle.port}${p}`)
        assert.equal(res.status, 404, p)
      }
    })
  })

  describe('plugin asset hardening', () => {
    it('never serves /builtin/* through static handling', async () => {
      for (const p of ['/builtin/graph/plugin.yaml', '/builtin/graph/index.js', '/builtin/']) {
        const res = await fetch(`http://localhost:${handle.port}${p}`)
        assert.equal(res.status, 404, p)
      }
    })

    it('sets nosniff on plugin and vendor responses', async () => {
      const plugin = await fetch(`http://localhost:${handle.port}/plugins/graph/index.js`)
      assert.equal(plugin.status, 200)
      assert.equal(plugin.headers.get('x-content-type-options'), 'nosniff')
      for (const p of ['/vendor/react.umd.js', '/vendor/shims/react.js']) {
        const res = await fetch(`http://localhost:${handle.port}${p}`)
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p)
      }
    })

    it('returns JSON 400 without stack traces for malformed percent-escapes', async () => {
      for (const p of ['/plugins/graph/%', '/vendor/%', '/api/overlay/%']) {
        const res = await fetch(`http://localhost:${handle.port}${p}`)
        assert.equal(res.status, 400, p)
        assert.match(res.headers.get('content-type') ?? '', /application\/json/, p)
        const text = await res.text()
        assert.ok(!/node_modules|at\s|[A-Za-z]:\|\/Users\//.test(text), `${p}: ${text}`)
        assert.ok(typeof (JSON.parse(text) as { error: unknown }).error === 'string')
      }
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
            file: 'nodes/orders/broken.yaml',
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

    it('reports the owning root for child nodes in /api/cluster and /api/nodes', async () => {
      const fieldId = 'orders.DomainModel.order.schemas.order.fields.customerId'
      const cluster = await fetch(`http://localhost:${sourceHandle.port}/api/cluster?nodeId=${encodeURIComponent(fieldId)}`)
      assert.equal(cluster.status, 200)
      const body = await cluster.json() as { owner?: { id: string; template: string } }
      assert.deepEqual(body.owner, { id: 'orders.DomainModel.order', template: 'DomainModel' })
      const rootCluster = await fetch(`http://localhost:${sourceHandle.port}/api/cluster?nodeId=orders.DomainModel.order`)
      assert.equal(((await rootCluster.json()) as { owner?: unknown }).owner, undefined)

      const nodes = await (await fetch(`http://localhost:${sourceHandle.port}/api/nodes?includeCore=true`)).json() as Array<{ id: string; rootId?: string; rootTemplate?: string }>
      const field = nodes.find(n => n.id === fieldId)
      assert.equal(field?.rootId, 'orders.DomainModel.order')
      assert.equal(field?.rootTemplate, 'DomainModel')
      assert.equal(nodes.find(n => n.id === 'orders.DomainModel.order')?.rootId, undefined)
    })

    it('includes owning root metadata for external owned nodes in /api/cluster', async () => {
      const response = await fetch(`http://localhost:${sourceHandle.port}/api/cluster?nodeId=payments.APIEndpoint.complete-payment&includeEdges=calls`)
      assert.equal(response.status, 200)
      const body = await response.json() as { includedNodes: Array<{ id: string; rootId?: string; rootTemplate?: string }> }
      const operation = body.includedNodes.find(node => node.id === 'payments.DomainModel.payment.operations.capture')
      assert.ok(operation)
      assert.equal(operation.rootId, 'payments.DomainModel.payment')
      assert.equal(operation.rootTemplate, 'DomainModel')
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

    it('exposes info.role so the UI can resolve match keys', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/templates?includeCore=true`)
      const body = await res.json() as Array<{ name: string; role?: string }>
      const withRole = body.filter(t => t.role !== undefined)
      assert.ok(withRole.length > 0, 'at least one fixture template declares a role')
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

    it('filters by namespace', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes?namespace=orders`)
      const body = await res.json() as Array<{ id: string }>
      assert.equal(body.length, 3)
    })

    it('filters by kind', async () => {
      const all = await (await fetch(`http://localhost:${handle.port}/api/nodes`)).json() as Array<{ id: string }>
      const res = await fetch(`http://localhost:${handle.port}/api/nodes?kind=component`)
      const body = await res.json() as Array<{ id: string }>
      assert.equal(body.length, all.length)
      const none = await (await fetch(`http://localhost:${handle.port}/api/nodes?kind=journey`)).json() as Array<{ id: string }>
      assert.equal(none.length, 0)
    })

    it('GET /api/kinds returns the kind registry and namespace kinds', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/kinds`)
      const body = await res.json() as { kinds: Array<{ id: string; label: string }>; namespaces: Array<{ namespace: string; kind: string }> }
      assert.deepEqual(body.kinds.find(k => k.id === 'component'), { id: 'component', label: 'Component' })
      assert.deepEqual(body.namespaces.find(n => n.namespace === 'orders')?.kind, 'component')
    })

    it('returns id, template, namespace, state, stability, and navigation ownership only', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/nodes`)
      const body = await res.json() as Array<Record<string, unknown>>
      const node = body[0]
      assert.ok('id' in node)
      assert.ok('template' in node)
      assert.ok('namespace' in node)
      assert.ok(!('component' in node))
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

    it('includes Mapping descendants and resolves #/mappings/ on a Field node to parent schema', async () => {
      const mappingGraph: Graph = {
        nodesById: new Map([
          ['orders.Order', {
            id: 'orders.Order', template: 'DomainModel', namespace: 'orders',
            state: 'agreed' as const, stability: 'stable' as const,
            schemaVersion: '1', lastModifiedAt: '2026-04-18',
            properties: {},
          }],
          ['orders.Order.schemas.prices', {
            id: 'orders.Order.schemas.prices', parentId: 'orders.Order', template: 'Schema', namespace: 'orders',
            state: 'agreed' as const, stability: 'stable' as const,
            schemaVersion: '1', lastModifiedAt: '2026-04-18',
            properties: {},
          }],
          ['orders.Order.schemas.prices.fields.pricesByZone', {
            id: 'orders.Order.schemas.prices.fields.pricesByZone', parentId: 'orders.Order.schemas.prices', template: 'Field', namespace: 'orders',
            state: 'agreed' as const, stability: 'stable' as const,
            schemaVersion: '1', lastModifiedAt: '2026-04-18',
            properties: { $ref: '#/mappings/pricesByZone', nullable: false },
          }],
          ['orders.Order.schemas.prices.mappings.pricesByZone', {
            id: 'orders.Order.schemas.prices.mappings.pricesByZone', parentId: 'orders.Order.schemas.prices', template: 'Mapping', namespace: 'orders',
            state: 'agreed' as const, stability: 'stable' as const,
            schemaVersion: '1', lastModifiedAt: '2026-04-18',
            properties: { type: 'decimal' },
          }],
        ]),
        edgesByFrom: new Map(),
        edgesByTo: new Map(),
        templates: new Map([
          ['DomainModel', {
            name: 'DomainModel',
            info: { version: '1', core: false, description: 'A domain model' },
            ui: { colour: '#4a90e2', displayName: 'Domain Model', icon: 'sitemap' },
          }],
          ['Schema', {
            name: 'Schema',
            info: { version: '1', core: true, description: 'A schema' },
            ui: { displayName: 'Schema' },
          }],
          ['Field', {
            name: 'Field',
            info: { version: '1', core: true, description: 'A field' },
            properties: { type: 'object', properties: { $ref: { type: 'string', format: 'node-ref' } } },
            ui: { displayName: 'Field' },
          }],
          ['Mapping', {
            name: 'Mapping',
            info: { version: '1', core: true, description: 'A keyed collection' },
            ui: { displayName: 'Mapping' },
          }],
        ]),
        diagnostics: [],
      }

      const mappingHandle = await startWebServer(mappingGraph, { port: 0 })
      try {
        const res = await fetch(
          `http://localhost:${mappingHandle.port}/api/cluster?nodeId=${encodeURIComponent('orders.Order')}`,
        )
        assert.equal(res.status, 200)
        const body = await res.json() as {
          descendants: Array<{ id: string; properties: Record<string, unknown> }>
        }

        assert.ok(
          body.descendants.some(d => d.id === 'orders.Order.schemas.prices.mappings.pricesByZone'),
          'Mapping node appears in cluster descendants',
        )
        const field = body.descendants.find(d => d.id === 'orders.Order.schemas.prices.fields.pricesByZone')
        assert.deepEqual(field?.properties.$ref, {
          display: 'pricesByZone',
          nodeId: 'orders.Order.schemas.prices.mappings.pricesByZone',
        })
      } finally {
        await mappingHandle.close()
      }
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

  describe('GET /api/graph', () => {
    it('returns 200 with { nodes, edges } shape', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/graph`)
      assert.equal(res.status, 200)
      const body = await res.json() as { nodes: unknown[]; edges: unknown[] }
      assert.ok(Array.isArray(body.nodes), 'nodes is an array')
      assert.ok(Array.isArray(body.edges), 'edges is an array')
    })

    it('excludes Schema, Field, EnumDefinition, EnumValue, Mapping template nodes', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/graph`)
      const body = await res.json() as { nodes: Array<{ id: string; template: string }> }
      const excludedTemplates = new Set(['Schema', 'Field', 'EnumDefinition', 'EnumValue', 'Mapping'])
      assert.ok(
        body.nodes.every(n => !excludedTemplates.has(n.template)),
        'no excluded-template nodes appear in graph response',
      )
      const ids = body.nodes.map(n => n.id).sort()
      assert.deepEqual(ids, ['orders.CancelOrder', 'orders.Order', 'orders.Order.operations.cancel'])
    })

    it('only includes semantic edge types — structural types are absent', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/graph`)
      const body = await res.json() as { edges: Array<{ type: string }> }
      const semanticTypes = new Set(['triggers', 'produces', 'reads', 'uses-type', 'calls', 'implements', 'maps-to', 'derived-from', 'precedes'])
      const structuralTypes = new Set(['has-field', 'has-value', 'renamed-from'])
      assert.ok(
        body.edges.every(e => semanticTypes.has(e.type) && !structuralTypes.has(e.type)),
        'all edges use semantic types only',
      )
    })

    it('includes pack-declared visible edge types', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/graph`)
      const body = await res.json() as { edges: Array<{ from: string; to: string; type: string }> }
      assert.ok(body.edges.some(edge =>
        edge.type === 'precedes'
        && edge.from === 'orders.Order'
        && edge.to === 'orders.CancelOrder',
      ))
    })

    it('edges have no dangling endpoints — both from and to must be in returned nodes', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/graph`)
      const body = await res.json() as { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> }
      const nodeIds = new Set(body.nodes.map(n => n.id))
      assert.ok(
        body.edges.every(e => nodeIds.has(e.from) && nodeIds.has(e.to)),
        'no dangling edge endpoints',
      )
    })

    it('?ref= falls back gracefully for unknown ref — returns 200', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/graph?ref=nonexistent-branch`)
      assert.equal(res.status, 200)
      const body = await res.json() as { nodes: unknown[]; edges: unknown[] }
      assert.ok(Array.isArray(body.nodes))
      assert.ok(Array.isArray(body.edges))
    })
  })

  describe('GET /api/stats', () => {
    it('returns counts matching the test graph', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/stats`)
      assert.equal(res.status, 200)
      const body = await res.json() as {
        nodeCount: number
        namespaceCount: number
        orphanNodeCount: number
        nodesByNamespace: Record<string, number>
        nodesByTemplate: Record<string, number>
        nodesByState: Record<string, number>
        nodesByStability: Record<string, number>
        edgesByType: Record<string, number>
        diagnosticCount: number
      }
      assert.equal(body.nodeCount, 7)
      assert.equal(body.namespaceCount, 2)
      assert.equal(body.orphanNodeCount, 1)
      assert.deepEqual(body.nodesByNamespace, {
        billing: 2,
        orders: 5,
      })
      assert.deepEqual(body.nodesByTemplate, {
        DomainModel: 1,
        Schema: 2,
        Field: 2,
        DomainOperation: 2,
      })
      assert.deepEqual(body.nodesByState, {
        agreed: 5,
        draft: 1,
        proposed: 1,
      })
      assert.deepEqual(body.nodesByStability, {
        stable: 6,
        unstable: 1,
      })
      assert.equal(body.edgesByType['maps-to'], 1)
      assert.equal(body.edgesByType['precedes'], 1)
      assert.equal(body.edgesByType['triggers'], undefined)
      assert.equal(body.diagnosticCount, 0)
    })

    it('returns only semantic edge types present in the graph', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/stats`)
      const body = await res.json() as { edgesByType: Record<string, number> }
      assert.deepEqual(body.edgesByType, { 'maps-to': 1, precedes: 1 })
    })

    it('falls back to default graph for unknown ?ref=', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/stats?ref=nonexistent-branch`)
      assert.equal(res.status, 200)
      const body = await res.json() as { nodeCount: number }
      assert.ok(body.nodeCount > 0)
    })
  })

  describe('GET /api/search', () => {
    it('returns ranked root-level search results', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/search?q=order&limit=5`)
      assert.equal(res.status, 200)
      const body = await res.json() as Array<{ node: { id: string } }>
      assert.ok(body.length > 0)
      assert.ok(body.every(result => !result.node.id.includes('.fields.')))
      assert.ok(body.some(result => result.node.id.includes('order')))
    })
  })

  describe('GET /api/lineage', () => {
    it('returns pack-declared visible edges for a focused node', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/lineage?node_ids=${encodeURIComponent('orders.Order')}&direction=both&reads_outbound_only=false`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as { edges: Array<{ from: string; to: string; type: string }> }
      assert.ok(body.edges.some(edge =>
        edge.type === 'precedes'
        && edge.from === 'orders.Order'
        && edge.to === 'orders.CancelOrder',
      ))
    })

    it('returns annotated lineage nodes and edges', async () => {
      const res = await fetch(
        `http://localhost:${handle.port}/api/lineage?node_ids=${encodeURIComponent('orders.Order.operations.cancel')}&direction=upstream`,
      )
      assert.equal(res.status, 200)
      const body = await res.json() as {
        nodes: Array<{ id: string; origin_id: string; depth: number; via_edge_type: string }>
        edges: Array<{ id: string }>
      }
      assert.ok(Array.isArray(body.nodes))
      assert.ok(Array.isArray(body.edges))
    })

    it('returns 400 when node_ids is missing', async () => {
      const res = await fetch(`http://localhost:${handle.port}/api/lineage`)
      assert.equal(res.status, 400)
    })
  })

  describe('plugins', () => {
    let tmp: string
    let pluginHandle: WebServerHandle
    let savedEnv: string | undefined
    let base: string

    function writePlugin(id: string, templates: string[] = [], contributes = ''): void {
      const dir = path.join(tmp, 'builtin', id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'plugin.yaml'),
        `id: ${id}\nversion: 1.0.0\nengines: { corum: "*" }\nrequires: { templates: [${templates.join(', ')}] }\nmain: ./index.js\n${contributes}`,
      )
      fs.writeFileSync(path.join(dir, 'index.js'), `export const id = '${id}'\n`)
    }

    before(async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-web-plugins-'))
      writePlugin('on', [], [
        'contributes:',
        '  pages:',
        '    - { id: view, title: View, mount: mount }',
        '  nodeActions:',
        '    - { id: quick-one, label: Quick one, appliesTo: ["*"], page: view, icon: diagram-project, param: focus, menu: false, quick: [header, relations] }',
        '',
      ].join('\n'))
      writePlugin('off')
      writePlugin('needs-missing', ['NoSuchTemplate'])
      const graphDir = path.join(tmp, 'graph')
      fs.mkdirSync(graphDir)
      fs.writeFileSync(path.join(graphDir, 'graph.yaml'), 'plugins:\n  - id: off\n    enabled: false\n')
      savedEnv = process.env.CORUM_BUILTIN_PLUGIN_DIRS
      process.env.CORUM_BUILTIN_PLUGIN_DIRS = path.join(tmp, 'builtin')
      pluginHandle = await startWebServer(makeTestGraph(), { port: 0, graphPath: graphDir })
      base = `http://localhost:${pluginHandle.port}`
    })

    after(async () => {
      await pluginHandle.close()
      if (savedEnv === undefined) delete process.env.CORUM_BUILTIN_PLUGIN_DIRS
      else process.env.CORUM_BUILTIN_PLUGIN_DIRS = savedEnv
      fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('GET /api/plugins returns statuses without filesystem paths', async () => {
      const res = await fetch(`${base}/api/plugins`)
      assert.equal(res.status, 200)
      const body = await res.json() as Array<{ id: string; status: string; origin: string; reason?: string; manifest: { id: string } }>
      const byId = new Map(body.map(p => [p.id, p]))
      assert.equal(byId.get('on')?.status, 'enabled')
      assert.equal(byId.get('on')?.origin, 'builtin')
      assert.equal(byId.get('off')?.status, 'disabled')
      assert.equal(byId.get('needs-missing')?.status, 'unavailable')
      assert.match(byId.get('needs-missing')?.reason ?? '', /NoSuchTemplate/)
      assert.equal(byId.get('on')?.manifest.id, 'on')
      const manifest = byId.get('on')?.manifest as unknown as { contributes: { nodeActions: unknown[] } }
      assert.deepEqual(manifest.contributes.nodeActions, [{
        id: 'quick-one', label: 'Quick one', appliesTo: ['*'], page: 'view', icon: 'diagram-project', param: 'focus', menu: false, quick: ['header', 'relations'],
      }])
      assert.ok(!JSON.stringify(body).includes(path.basename(tmp)))
    })

    it('GET /plugins/:id/* serves enabled plugin assets with caching headers', async () => {
      const res = await fetch(`${base}/plugins/on/index.js`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type') ?? '', /^text\/javascript/)
      assert.equal(res.headers.get('cache-control'), 'no-cache')
      assert.match(await res.text(), /export const id/)
      const etag = res.headers.get('etag')
      assert.ok(etag)
      const again = await fetch(`${base}/plugins/on/index.js`, { headers: { 'If-None-Match': etag } })
      assert.equal(again.status, 304)
    })

    it('honours weak and wildcard If-None-Match and ignores Range', async () => {
      const first = await fetch(`${base}/plugins/on/index.js`)
      const etag = first.headers.get('etag') ?? ''
      assert.ok(etag)
      for (const header of [`W/${etag}`, '*', `"nope", ${etag}`]) {
        const res = await fetch(`${base}/plugins/on/index.js`, { headers: { 'If-None-Match': header } })
        assert.equal(res.status, 304, header)
      }
      const other = await fetch(`${base}/plugins/on/index.js`, { headers: { 'If-None-Match': '"other"' } })
      assert.equal(other.status, 200)
      const ranged = await fetch(`${base}/plugins/on/index.js`, { headers: { Range: 'bytes=0-3' } })
      assert.equal(ranged.status, 200)
      assert.equal(ranged.headers.get('content-range'), null)
      assert.match(await ranged.text(), /export const id/)
    })

    it('does not serve disabled, unavailable or unknown plugins', async () => {
      for (const id of ['off', 'needs-missing', 'nope']) {
        const res = await fetch(`${base}/plugins/${id}/index.js`)
        assert.equal(res.status, 404, id)
      }
    })

    it('never serves plugin.yaml or traversal paths', async () => {
      for (const p of ['plugin.yaml', '..%2foff%2findex.js', '%2e%2e/off/index.js', '../off/index.js']) {
        const res = await fetch(`${base}/plugins/on/${p}`)
        assert.equal(res.status, 404, p)
      }
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

    describe('plugin refresh scope', () => {
      type ReloadInfo = { graphReloaded: boolean; pluginsChanged: boolean }

      async function watchFixture(extra?: (root: string, graphPath: string) => string[]) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-watch-'))
        const fixture = writeWatcherFixture(tmp)
        const pluginDirs = extra ? extra(tmp, fixture.graphPath) : []
        const graph = await loadGraph({ graphPath: fixture.graphPath })
        const calls: ReloadInfo[] = []
        const stop = startGraphFileWatcher(graph, {
          graphPath: fixture.graphPath,
          debounceMs: 25,
          logger: () => {},
          pluginWatchDirs: () => pluginDirs,
          onReload: info => calls.push(info as ReloadInfo),
        })
        return { tmp, calls, stop, ...fixture, pluginDirs }
      }

      async function settled(calls: ReloadInfo[], count: number): Promise<void> {
        await eventually(async () => calls.length, length => length >= count)
        await new Promise(resolve => setTimeout(resolve, 150))
      }

      it('does not refresh plugins when only a node file changes', async () => {
        const w = await watchFixture()
        try {
          fs.appendFileSync(w.nodePath, '\n')
          await settled(w.calls, 1)
          assert.equal(w.calls.at(-1)?.graphReloaded, true)
          assert.equal(w.calls.at(-1)?.pluginsChanged, false)
        } finally {
          w.stop()
          fs.rmSync(w.tmp, { recursive: true, force: true })
        }
      })

      it('refreshes plugins when graph.yaml changes', async () => {
        const w = await watchFixture()
        try {
          fs.appendFileSync(path.join(w.graphPath, 'graph.yaml'), '\n')
          await settled(w.calls, 1)
          assert.equal(w.calls.at(-1)?.graphReloaded, true)
          assert.equal(w.calls.at(-1)?.pluginsChanged, true)
        } finally {
          w.stop()
          fs.rmSync(w.tmp, { recursive: true, force: true })
        }
      })

      it('refreshes plugins when a pack file changes', async () => {
        const w = await watchFixture()
        try {
          fs.appendFileSync(w.templatePath, '\n')
          await settled(w.calls, 1)
          assert.equal(w.calls.at(-1)?.graphReloaded, true)
          assert.equal(w.calls.at(-1)?.pluginsChanged, true)
        } finally {
          w.stop()
          fs.rmSync(w.tmp, { recursive: true, force: true })
        }
      })

      it('refreshes plugins without reloading the graph when a standalone plugin manifest changes', async () => {
        const w = await watchFixture((tmp) => {
          const dir = path.join(tmp, 'plugins', 'demo')
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, 'plugin.yaml'), 'id: demo\n')
          return [dir]
        })
        try {
          fs.appendFileSync(path.join(w.pluginDirs[0], 'plugin.yaml'), '\n')
          await settled(w.calls, 1)
          assert.equal(w.calls.at(-1)?.graphReloaded, false)
          assert.equal(w.calls.at(-1)?.pluginsChanged, true)
        } finally {
          w.stop()
          fs.rmSync(w.tmp, { recursive: true, force: true })
        }
      })

      it('ignores non-manifest files inside a standalone plugin directory', async () => {
        const w = await watchFixture((tmp) => {
          const dir = path.join(tmp, 'plugins', 'demo')
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, 'index.js'), '// v1\n')
          return [dir]
        })
        try {
          fs.appendFileSync(path.join(w.pluginDirs[0], 'index.js'), '// v2\n')
          await new Promise(resolve => setTimeout(resolve, 400))
          assert.equal(w.calls.length, 0)
        } finally {
          w.stop()
          fs.rmSync(w.tmp, { recursive: true, force: true })
        }
      })
    })

    it('preserves sourceContent and edgeTypes on the served graph object after a reload', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-watch-'))
      let watchedHandle: WebServerHandle | undefined
      try {
        const { graphPath, nodePath } = writeWatcherFixture(tmp)
        // Start from a Graph object that was NOT produced by loadGraph (no sourceContent/edgeTypes
        // set yet), mirroring the shape a caller may pass in. A correct reload must populate
        // these fields from the freshly loaded graph so buildGraphYaml never regresses to
        // templatePacks: [].
        // makeTestGraph() builds a Graph literal with no sourceContent/edgeTypes field set.
        const watchedGraph = makeTestGraph()

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

        await eventually(
          async () => fetch(`http://localhost:${watchedHandle!.port}/api/nodes`).then(res => res.json()) as Promise<Array<{ id: string; state: string }>>,
          body => body.some(node => node.id === 'orders.Thing.first' && node.state === 'agreed'),
        )

        assert.ok(
          watchedGraph.sourceContent?.get('graph.yaml')?.includes('templatePacks'),
          'sourceContent for graph.yaml must survive a file-watcher reload so buildGraphYaml does not regress templatePacks to []',
        )
        assert.ok(
          watchedGraph.edgeTypes && watchedGraph.edgeTypes.size > 0,
          'edgeTypes must survive a file-watcher reload',
        )
      } finally {
        if (watchedHandle) await watchedHandle.close()
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  describe('web assets', () => {
    for (const entryPath of ['/', '/index.html']) {
      it(`${entryPath} revalidates HTML and versions local entry assets`, async () => {
        const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
        const response = await fetch(`http://localhost:${handle.port}${entryPath}`)
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('cache-control'), 'no-cache')
        assert.match(response.headers.get('content-type') ?? '', /text\/html/)
        const html = await response.text()
        const original = fs.readFileSync(path.join(repoRoot, 'web/index.html'), 'utf8')
        assert.equal(html, original
          .replace('href="style.css"', `href="style.css?v=${encodeURIComponent(version)}"`)
          .replace('src="app.jsx"', `src="app.jsx?v=${encodeURIComponent(version)}"`))

        for (const asset of ['style.css', 'app.jsx']) {
          const assetUrl = `${asset}?v=${encodeURIComponent(version)}`
          assert.ok(html.includes(`"${assetUrl}"`))
          const assetResponse = await fetch(`http://localhost:${handle.port}/${assetUrl}`)
          assert.equal(assetResponse.status, 200)
          assert.equal(await assetResponse.text(), fs.readFileSync(path.join(repoRoot, 'web', asset), 'utf8'))
        }
      })
    }

    let primitives = ''
    let app = ''
    let graph = ''
    let styles = ''
    let statusCodes = { primitives: 0, app: 0, graph: 0, styles: 0 }

    before(async () => {
      const graphFiles = ['index.js', 'constants.js', 'layout.js', 'levels.js', 'rf-builders.js', 'node-cards.js', 'toolbar.js', 'view.js']
      const sdkFiles = ['ui.js', 'properties.js', 'schema-model.js', 'schema-rows.js', 'schema-card.js']
      const [primitivesRes, appRes, graphRes, styleRes] = await Promise.all([
        Promise.all(sdkFiles.map(file => fetch(`http://localhost:${handle.port}/sdk/${file}`))).then(responses => ({
          status: responses.every(r => r.status === 200) ? 200 : 500,
          text: async () => (await Promise.all(responses.map(r => r.text()))).join('\n'),
        })),
        fetch(`http://localhost:${handle.port}/app.jsx`),
        Promise.all(graphFiles.map(file => fetch(`http://localhost:${handle.port}/plugins/graph/${file}`))).then(responses => ({
          status: responses.every(r => r.status === 200) ? 200 : 500,
          text: async () => (await Promise.all(responses.map(r => r.text()))).join('\n'),
        })),
        fetch(`http://localhost:${handle.port}/style.css`),
      ])
      statusCodes = { primitives: primitivesRes.status, app: appRes.status, graph: graphRes.status, styles: styleRes.status }
      primitives = await primitivesRes.text()
      app = await appRes.text()
      graph = await graphRes.text()
      styles = await styleRes.text()
    })

    it('serves static files with 200', () => {
      assert.equal(statusCodes.primitives, 200)
      assert.equal(statusCodes.app, 200)
      assert.equal(statusCodes.graph, 200)
      assert.equal(statusCodes.styles, 200)
    })

    it('primitives: buildPropertyRows uses depth for nested row indentation', () => {
      assert.match(primitives, /function buildPropertyRows\(entries, onNavigate, depth = 0/)
      assert.match(primitives, /const rows = buildPropertyRows\(entries, onNavigate, 0, '', propertyHints\)/)
      assert.ok(primitives.includes("className=${`prop-row${row.depth > 0 ? ' nested' : ''}`}"))
      assert.match(primitives, /className="mono prop-key-cell"/)
      assert.match(primitives, /'--prop-depth': row\.depth/)
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
      assert.ok(primitives.includes("${index > 0 && html`<span key=${`sep-${edge.id}`}>${' '}</span>`}"))
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
      assert.match(app, /eventSource\.addEventListener\('graph-reloaded', onGraphReloaded\)/)
      assert.match(app, /refreshAllData\(\);\s*\};/)
      assert.match(app, /pluginsChangedOnServer\(\)/)
      assert.match(app, /refreshToken/)
      assert.match(app, /fetch\(`\/api\/cluster\?nodeId=\$\{encodeURIComponent\(nodeId\)\}&includeEdges=maps-to,reads,uses-type,triggers,produces,calls,implements\$\{refParam\}\$\{overlayParam\}`\)/)
    })

    it('app: SchemaCard receives allNodes including includedNodes', () => {
      assert.match(app, /allNodes=\{\[root, \.\.\.descendants, \.\.\.includedNodes\]\}/)
    })

    it('primitives: nested child schemas render overlay ghost rows in the recursive schema view', () => {
      assert.match(primitives, /function SchemaFieldRows\(\{\s*schemaNodeId,\s*model,\s*prefix = '',\s*depth = 0,\s*visited = new Set\(\),\s*edges = \[\],\s*overlayFields,\s*overlayRefs,\s*compact = false\s*\}\)/)
      assert.match(primitives, /const childSchemaNode = !canExpandMapping/)
      assert.match(primitives, /const childGhostFields = childSchemaNode \? overlayFieldsForSchema\(overlayFields, childSchemaNode\.id\) : \[\];/)
      assert.match(primitives, /<\$\{SchemaFieldRows\}[\s\S]*overlayFields=\$\{overlayFields\}\s*overlayRefs=\$\{overlayRefs\}/)
      assert.match(primitives, /childGhostFields\.length > 0 && html`<\$\{GhostFieldRows\} fields=\$\{childGhostFields\} overlayRefs=\$\{overlayRefs\} prefix=\$\{childPrefix\} depth=\$\{depth \+ 1\} compact=\$\{compact\} \/>`/)
      assert.match(primitives, /function GhostFieldRows\(\{\s*fields,\s*overlayRefs,\s*prefix = '',\s*depth = 0,\s*compact = false\s*\}\)/)
      assert.match(primitives, /const name = compact \? fieldLocalName\(field\.id\) : prefix \+ fieldLocalName\(field\.id\);/)
      assert.ok(primitives.includes("className=${`field-row overlay-ghost ${stripeClass}${depth > 0 ? ' nested' : ''}`}"))
      assert.ok(primitives.includes("'--field-depth': depth"))
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
      assert.match(app, /if \(openComponent === undefined\) \{ openComponentWithEntries\(autoOpen\); return; \}/)
      assert.match(app, /function toggleComponent\(component, kind\) \{[\s\S]*openComponentWithEntries/)
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

    it('app: primary nav and page heading say Explorer; dashboard card stays Namespaces', () => {
      assert.match(app, /\{ id: 'namespaces', icon: 'sitemap', label: 'Explorer' \}/)
      assert.match(app, /<h1>Explorer<\/h1>/)
      assert.match(app, /label="Namespaces" \/>/)
    })

    it('app: namespaces section navigation routes through /namespaces, with no /components route', () => {
      assert.match(app, /function handleSection\(section, pluginPage\) \{/)
      assert.match(app, /: `\/\$\{section\}`;\s*navigate\(buildRoute\(\{ pathname, params: \{\}, branch: viewingRef \}\)\);/)
      assert.match(app, /const showTree = activeSection === 'namespaces' \|\| activeNodeId;/)
      assert.match(app, /} else if \(route\.pathname === '\/namespaces'\) \{\s*page = <NamespacesPage \/>;/)
      assert.doesNotMatch(app, /\/components/)
      assert.doesNotMatch(app, /ComponentsPage/)
    })

    it('app: navigation is grouped into one section per kind and non-default kinds open the generic page', () => {
      assert.match(app, /groupNamespacesByKind\(nodes, kinds\)/)
      assert.match(app, /kindSections\.map\(section =>/)
      assert.match(app, /<div className="nav-kind-head">\{section\.label\}<\/div>/)
      assert.match(app, /if \(kind !== 'component'\) onNamespace\(component\);/)
      assert.match(app, /fetch\(`\/api\/kinds\$\{refParam\}`\)/)
    })

    it('app: generic namespace page lists owned nodes plus inbound and outbound edges with links', () => {
      assert.match(app, /route\.pathname === '\/namespace'/)
      assert.match(app, /function NamespacePage\(/)
      assert.match(app, /<EdgeList title="Inbound" edges=\{inbound\} endpoint="from" \/>/)
      assert.match(app, /<EdgeList title="Outbound" edges=\{outbound\} endpoint="to" \/>/)
      assert.match(app, /<div className="card-head">Owned nodes<\/div>/)
      assert.match(app, /onClick=\{\(\) => onNavigate\(id\)\}/)
      // Core UI has no kind-specific code: only the default kind is named.
      assert.doesNotMatch(app, /journey/i)
      assert.doesNotMatch(graph, /journey/i)
    })

    it('graph: kind filter defaults to component and colours nodes by kind', () => {
      assert.match(graph, /const kindFilter = resolveKindFilter\(requestedKind, graphData\?\.nodes \?\? \[\]\)/)
      assert.match(graph, /filterByKind\(graphData\.nodes, graphData\.edges, kindFilter\)/)
      assert.match(graph, /aria-label="Kind filter"/)
      assert.match(graph, /\{ id: 'all', label: 'All' \}/)
      assert.match(graph, /kindColour: kindColour\(/)
    })

    it('graph: node cards render status beside stability in the footer, not in the header', () => {
      assert.doesNotMatch(graph, /<div className="graph-node-card-header">\s*<\$\{TemplateBadge\} name=\$\{data\.templateLabel\} colour=\$\{colour\} \/>\s*<\/div>/)
      assert.match(graph, /<div className="graph-node-card-footer">[\s\S]*<\$\{StabilityTag\} stability=\$\{data\.stability\} \/>[\s\S]*<\$\{StateTag\} state=\$\{data\.state\} \/>/)
    })

    it('graph: node card titles use a dedicated wrapped block instead of single-line truncation', () => {
      assert.match(graph, /<div className="graph-node-card-body">\s*<div className="graph-node-card-text">\s*<div className="graph-node-card-name" title=\$\{data\.nodeId\}>\$\{data\.label\}<\/div>\s*<div className="graph-node-card-component" style=\$\{\{ color: data\.kindColour \}\}>\$\{data\.component\}<\/div>\s*<\/div>\s*<div className="graph-node-card-type">\s*<\$\{TemplateBadge\} name=\$\{data\.templateLabel\} colour=\$\{colour\} \/>\s*<\/div>\s*<\/div>/)
      assert.match(styles, /\.graph-node-card-text\s*\{[^}]*min-height:\s*calc\(\(1\.25em \* 2\) \+ 12px\);/s)
      assert.match(styles, /\.graph-node-card-name\s*\{[^}]*white-space:\s*normal;[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*line-height:\s*1\.25;/s)
      assert.match(styles, /\.graph-node-card-type\s*\{[^}]*margin-top:\s*6px;/)
      assert.doesNotMatch(styles, /\.graph-node-card-name\s*\{[^}]*white-space:\s*nowrap;/s)
      assert.doesNotMatch(styles, /\.graph-node-card-name\s*\{[^}]*text-overflow:\s*ellipsis;/s)
      assert.doesNotMatch(styles, /\.graph-node-card-name\s*\{[^}]*min-height:/s)
    })

    it('graph: depth control allows level 1 as the minimum step', () => {
      assert.match(graph, /export const DEPTH_STEPS = \[1, 2, 3, 4, 5, Infinity\]/)
    })

    it('graph: node cards keep parent labels even when the parent node is outside the visible focus depth', () => {
      assert.match(graph, /const parentLabel = n\.parentId \? getDisplayName\(n\.parentId\) : null/)
    })

    it('graph: focus view fetches lineage data through ctx.api instead of using buildFocusGraph', () => {
      assert.doesNotMatch(graph, /buildFocusGraph/)
      assert.match(graph, /const \[focusData, setFocusData\] = useState\(null\)/)
      assert.match(graph, /const debounceTimerRef = useRef\(null\)/)
      assert.match(graph, /ctx\.api\.get\('\/api\/lineage', \[/)
      assert.doesNotMatch(graph, /\bfetch\(/)
    })

    it('graph: edge controls are derived from graph response types and new types default visible', () => {
      assert.match(graph, /const availableEdgeTypes = useMemo\(\(\) => collectEdgeTypes\(graphData\?\.edges \?\? \[\], focusData\?\.edges \?\? \[\]\), \[graphData, focusData\]\)/)
      assert.match(graph, /function loadHiddenEdgeTypes\(\) \{[\s\S]*hiddenTypes/)
      assert.match(graph, /new Set\(availableEdgeTypes\.filter\(type => !hiddenEdgeTypes\.has\(type\)\)\)/)
      assert.match(graph, /<\$\{GraphToolbar\}[\s\S]*edgeTypes=\$\{availableEdgeTypes\}/)
      assert.doesNotMatch(graph, /ALL_EDGE_TYPES/)
    })

    it('graph: graph view keeps a single React Flow canvas instance and refits after node updates', () => {
      assert.match(graph, /const \[reactFlowInstance, setReactFlowInstance\] = useState\(null\)/)
      assert.match(graph, /const pendingViewportRef = useRef\(null\)/)
      assert.match(graph, /const lastFocusedNodeIdRef = useRef\(null\)/)
      assert.match(graph, /pendingViewportRef\.current = \{ type: 'full' \}/)
      assert.match(graph, /const focalChanged = lastFocusedNodeIdRef\.current !== focalNodeId/)
      assert.match(graph, /if \(focalChanged\) \{[\s\S]*pendingViewportRef\.current = \{ type: 'focus', nodeId: focalNodeId \}/)
      assert.match(graph, /const measuredId = pending\.type === 'focus' \? pending\.nodeId : rfNodes\[0\]\?\.id/)
      assert.match(graph, /const measuredNode = measuredId \? reactFlowInstance\.getNode\(measuredId\) : null/)
      assert.match(graph, /if \(!measuredNode\?\.width \|\| !measuredNode\?\.height\) \{/)
      assert.match(graph, /requestAnimationFrame\(fitPendingViewport\)/)
      assert.match(graph, /pending\.type === 'focus'/)
      assert.match(graph, /reactFlowInstance\.fitView\(\{\s*duration: 0,\s*padding: 0\.2,\s*\}\)/)
      assert.doesNotMatch(graph, /nodes:\s*\[\{\s*id:\s*pending\.nodeId\s*\}\]/)
      assert.match(graph, /pendingViewportRef\.current = null/)
      assert.match(graph, /onInit=\$\{setReactFlowInstance\}/)
      assert.doesNotMatch(graph, /key=\{canvasInstanceKey\}/)
    })

    it('graph: plugin ports reach the host only through the import map and corum:ui', () => {
      assert.doesNotMatch(graph, /window\.CorumHost|window\.CorumRouter|window\.ReactFlow|window\.ELK/)
      assert.match(graph, /export const mountGraph = mountReact\(GraphView\)/)
    })

    it('app: initial route state is derived from window.location.hash', () => {
      assert.match(app, /const \[route, setRoute\] = useState\(\(\) => parseRoute\(window\.location\.hash\)\);/)
      assert.match(app, /const next = parseRoute\(location\.hash\);/)
      assert.match(app, /setRoute\(next\);/)
      assert.doesNotMatch(app, /const \[route, setRoute\] = useState\(parseRoute\);/)
      assert.doesNotMatch(app, /setRoute\(parseRoute\(\)\);/)
    })

    it('app: overlay nav dots are derived from diff-aware indicator ids', () => {
      assert.match(app, /const \{ buildNavTree, buildOverlayIndicatorIds, groupNamespacesByKind, namespaceEdges \} = window\.CorumNav;/)
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

    it('app: DashboardPage receives graph data props from App', () => {
      assert.match(app, /page = \(\s*<DashboardPage/)
      assert.match(app, /nodes=\{nodes\}/)
      assert.match(app, /gitMode=\{gitMode\}/)
      assert.match(app, /viewingRef=\{viewingRef\}/)
      assert.match(app, /branches=\{branches\}/)
      assert.match(app, /branchResults=\{branchResults\}/)
    })

    it('app: DashboardPage fetches /api/stats and /api/overlay', () => {
      assert.match(app, /\/api\/stats/)
      assert.match(app, /\/api\/overlay\//)
    })

    it('app: DashboardPage renders counts from stats instead of filtered nodes', () => {
      assert.doesNotMatch(app, /const componentCount = new Set\(nodes\.map\(n => n\.component\)\.filter\(Boolean\)\)\.size;/)
      assert.doesNotMatch(app, /const nodeCount = nodes\.length;/)
      assert.doesNotMatch(app, /const nodesByComponent = \[\.\.\.nodes\.reduce\(/)
      assert.doesNotMatch(app, /const nodesByTemplate = \[\.\.\.nodes\.reduce\(/)
      assert.doesNotMatch(app, /const nodesByState = \[\.\.\.nodes\.reduce\(/)
      assert.doesNotMatch(app, /const nodesByStability = \[\.\.\.nodes\.reduce\(/)
      assert.match(app, /<HeroCard value=\{stats \? stats\.namespaceCount : '\u2026'\} label="Namespaces" \/>/)
      assert.match(app, /<HeroCard value=\{stats \? stats\.nodeCount : '\u2026'\} label="Nodes" \/>/)
      assert.match(app, /Object\.entries\(stats\.nodesByNamespace\)/)
      assert.match(app, /Object\.entries\(stats\.nodesByTemplate\)/)
      assert.match(app, /Object\.entries\(stats\.nodesByState\)/)
      assert.match(app, /Object\.entries\(stats\.nodesByStability\)/)
    })

    it('app: DashboardPage includes Namespaces by Kind and Nodes by Namespace panels', () => {
      assert.match(app, /<div className="card-head">Namespaces by Kind<\/div>/)
      assert.match(app, /Object\.entries\(stats\.namespacesByKind \?\? \{\}\)/)
      assert.match(app, /<div className="card-head">Nodes by Namespace<\/div>/)
    })

    it('style: dashboard hero and grid layout classes defined', () => {
      assert.match(styles, /\.dashboard-hero\s*\{/)
      assert.match(styles, /\.hero-card\s*\{/)
      assert.match(styles, /\.dashboard-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(260px,\s*1fr\)\);/s)
      assert.match(styles, /@media \(max-width:\s*960px\)\s*\{[\s\S]*\.dashboard-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(260px,\s*1fr\)\);/s)
      assert.match(styles, /@media \(max-width:\s*640px\)\s*\{[\s\S]*\.dashboard-grid\s*\{[^}]*grid-template-columns:\s*1fr;/s)
      assert.match(styles, /\.dashboard-panel\s*\{/)
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
          file: 'nodes/orders/broken.yaml',
          message: 'unknown template: MissingTemplate',
        },
      ])
    }
    return new Map()
  }

  async commit(): Promise<void> {
    throw new Error('not implemented')
  }

  async head(): Promise<string> {
    return 'fake-head'
  }

  async log(): Promise<string[]> {
    return []
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
      [`nodes/orders/${ref.replace(/[^\w-]/g, '_')}.yaml`, [
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

  async head(): Promise<string> {
    return 'fake-head'
  }

  async log(): Promise<string[]> {
    return []
  }

  async reloadSignature(): Promise<string> {
    return this.branches.join('|')
  }
}
