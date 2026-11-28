import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify as stringifyYaml } from 'yaml'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { loadImportConfig } from '../../src/import/config.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { Graph } from '../../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

const OPENAPI = {
  openapi: '3.0.0',
  info: { title: 'Orders', version: '1' },
  paths: {
    '/orders': {
      post: {
        operationId: 'createOrder',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrderRequest' } } } },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
  components: {
    schemas: {
      CreateOrderRequest: {
        type: 'object',
        properties: { customerId: { type: 'string' }, total: { type: 'number' } },
      },
    },
  },
}

function interchange(extra: { edges?: unknown[]; ids?: string[] } = {}) {
  return {
    corum: '1.0',
    nodes: {
      'orders.DomainModel.OrderAggregate': {
        type: 'DomainModel',
        title: 'OrderAggregate',
        ...(extra.ids ? { ids: extra.ids } : {}),
      },
    },
    edges: extra.edges ?? [
      { type: 'uses-type', from: 'orders.DomainModel.OrderAggregate', to: 'clr:Orders.Contracts.CreateOrderRequest' },
      { type: 'uses-type', from: 'orders.DomainModel.OrderAggregate', to: 'clr:Orders.Contracts.CreateOrderRequest#CustomerId' },
      { type: 'calls', from: 'orders.DomainModel.OrderAggregate', to: 'clr:op:createOrder' },
    ],
  }
}

const MAP = {
  exact: { 'clr:op:createOrder': 'openapi:orders/op/createOrder' },
  rules: [
    { from: 'clr:{area}.Contracts.{type}', to: 'openapi:{area|lower}/schema/{type}' },
    { from: 'clr:{area}.Contracts.{type}#{field}', to: 'openapi:{area|lower}/schema/{type}/{field|camel}' },
  ],
}

async function setupOrders(extra: Parameters<typeof interchange>[0] = {}, map: unknown = MAP) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-idmap-'))
  const graphDir = path.join(dir, 'graph')
  const graph = await loadGraph({ graphPath: fixtureGraphDir })
  await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
  const write = (name: string, content: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), stringifyYaml(content))
  }
  write('openapi.yaml', OPENAPI)
  write('code.corum.yaml', interchange(extra))
  write('maps/code-to-spec.yaml', map)
  // Spec paths resolve against the CWD, so they are written absolute; idMaps are relative to the config.
  write('imports.yaml', {
    idMaps: ['./maps/code-to-spec.yaml'],
    imports: [
      { adapter: 'openapi', spec: path.join(dir, 'openapi.yaml'), componentMapping: { strategy: 'uri-segment', segment: 0 } },
      { adapter: 'corum', spec: path.join(dir, 'code.corum.yaml') },
    ],
  })
  process.env.CORUM_GRAPH_PATH = graphDir
  return {
    dir,
    write,
    run: () => runImport(loadImportConfig(path.join(dir, 'imports.yaml')), createGraphRuntimeConfig()),
    load: (): Promise<Graph> => loadGraph({ graphPath: graphDir }),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

const edgeKeys = (g: Graph) => [...g.edgesByFrom.values()].flat().map(e => e.id).filter(k => !k.includes('__has-')).sort()

describe('ID maps — single run, fresh graph', () => {
  it('links a clr: interchange to OpenAPI schema, field and operation with no Corum IDs in the interchange', async () => {
    const t = await setupOrders()
    try {
      const result = await t.run()
      assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), [])
      const g = await t.load()
      const keys = edgeKeys(g)
      const from = 'orders.DomainModel.OrderAggregate'
      assert.ok(keys.includes(`${from}__uses-type__orders.APIEndpoint.createOrder.schemas.CreateOrderRequest`), keys.join('\n'))
      assert.ok(keys.includes(`${from}__uses-type__orders.APIEndpoint.createOrder.schemas.CreateOrderRequest.fields.customerId`), keys.join('\n'))
      assert.ok(keys.includes(`${from}__calls__orders.APIEndpoint.createOrder`), keys.join('\n'))
      assert.ok(![...g.nodesById.keys()].some(id => id.includes('clr:')), 'no node was created for a mapped reference')
      assert.equal(result.idMapSummary?.rules[0].resolved, 1)
      assert.equal(result.idMapSummary?.rules[1].resolved, 1)
      assert.equal(result.idMapSummary?.exact[0].resolved, 1)
    } finally {
      t.cleanup()
    }
  })

  it('is unchanged on re-run', async () => {
    const t = await setupOrders()
    try {
      await t.run()
      const g1 = await t.load()
      const first = edgeKeys(g1)
      const nodes1 = [...g1.nodesById.keys()].sort()
      await t.run()
      const g2 = await t.load()
      assert.deepEqual(edgeKeys(g2), first)
      assert.deepEqual([...g2.nodesById.keys()].sort(), nodes1)
    } finally {
      t.cleanup()
    }
  })

  it('an exact entry overrides a rule for the same ID', async () => {
    const t = await setupOrders({}, {
      exact: { 'clr:Orders.Contracts.CreateOrderRequest': 'openapi:orders/schema/CreateOrderRequest/total', 'clr:op:createOrder': 'openapi:orders/op/createOrder' },
      rules: MAP.rules,
    })
    try {
      const result = await t.run()
      const keys = edgeKeys(await t.load())
      assert.ok(keys.some(k => k.endsWith('__uses-type__orders.APIEndpoint.createOrder.schemas.CreateOrderRequest.fields.total')), keys.join('\n'))
      assert.ok(!result.diagnostics.some(d => d.message.includes('Ambiguous')))
      assert.equal(result.idMapSummary?.rules[0].overridden, 1)
    } finally {
      t.cleanup()
    }
  })

  it('reports ambiguous references and unmatched rules without resolving', async () => {
    const t = await setupOrders({}, {
      exact: { 'clr:op:createOrder': 'openapi:orders/op/createOrder' },
      rules: [
        ...MAP.rules,
        { from: 'clr:{area}.Contracts.{type}', to: 'openapi:{area|lower}/schema/{type}/total' },
        { from: 'nothing:{x}', to: 'openapi:orders/schema/{x}' },
      ],
    })
    try {
      const result = await t.run()
      assert.ok(result.diagnostics.some(d => d.message.includes('Ambiguous') && d.message.includes('CreateOrderRequest')))
      assert.ok(result.diagnostics.some(d => d.message.includes('matched no reference')))
      const keys = edgeKeys(await t.load())
      assert.ok(!keys.some(k => k.includes('__uses-type__') && k.endsWith('schemas.CreateOrderRequest')))
    } finally {
      t.cleanup()
    }
  })

  it('stops the run on a malformed map', async () => {
    const t = await setupOrders({}, { rules: [{ from: 'a:{x}', to: 'b:{x|shout}' }] })
    try {
      const result = await t.run()
      assert.ok(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('unknown transform')))
    } finally {
      t.cleanup()
    }
  })

  it('resolves through declared ids, and survives schema promotion', async () => {
    const t = await setupOrders({
      ids: ['clr:Orders.Contracts.Aggregate'],
      edges: [{ type: 'uses-type', from: 'clr:Orders.Contracts.Aggregate', to: 'clr:Orders.Contracts.CreateOrderRequest' }],
    })
    try {
      await t.run()
      const before = edgeKeys(await t.load())
      assert.ok(before.includes('orders.DomainModel.OrderAggregate__uses-type__orders.APIEndpoint.createOrder.schemas.CreateOrderRequest'), before.join('\n'))

      // A second operation uses the schema, so it is promoted to a standalone schema.
      const promoted = structuredClone(OPENAPI) as typeof OPENAPI & { paths: Record<string, unknown> }
      promoted.paths['/orders/bulk'] = {
        post: {
          operationId: 'bulkOrder',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrderRequest' } } } },
          responses: { '200': { description: 'ok' } },
        },
      }
      t.write('openapi.yaml', promoted)
      await t.run()
      const after = edgeKeys(await t.load())
      assert.ok(after.includes('orders.DomainModel.OrderAggregate__uses-type__orders.Schema.CreateOrderRequest'), after.join('\n'))
      assert.deepEqual(after.filter(k => k.includes('clr:')), [])
    } finally {
      t.cleanup()
    }
  })
})

describe('ID maps — field $ref and deduplication', () => {
  it('resolves a field $ref written as a source ID', async () => {
    const t = await setupOrders()
    try {
      t.write('code.corum.yaml', {
        corum: '1.0',
        nodes: { 'orders.DomainModel.OrderAggregate': { type: 'DomainModel', schema: { $ref: '#/components/schemas/OrderAggregate' } } },
        components: { schemas: { OrderAggregate: { type: 'object', properties: { request: { $ref: 'clr:Orders.Contracts.CreateOrderRequest' } } } } },
        edges: [],
      })
      const result = await t.run()
      const g = await t.load()
      const field = [...g.nodesById.values()].find(n => n.id.endsWith('.fields.request'))
      assert.ok(field, 'field exists')
      assert.equal(field.properties.$ref, 'orders.APIEndpoint.createOrder.schemas.CreateOrderRequest')
      assert.ok(!result.diagnostics.some(d => d.message.includes('falling back')), JSON.stringify(result.diagnostics))
    } finally {
      t.cleanup()
    }
  })

  it('merges only under a dedup rule, matching fields through the map and carrying unmatched ones', async () => {
    const t = await setupOrders()
    try {
      t.write('code.corum.yaml', {
        corum: '1.0',
        nodes: {
          'orders.Schema.CreateOrderDto': { type: 'Schema', ids: ['clr:Orders.Contracts.CreateOrderRequest'], schema: { $ref: '#/components/schemas/CreateOrderDto' } },
        },
        components: { schemas: { CreateOrderDto: { type: 'object', properties: { CustomerId: { type: 'string' }, Notes: { type: 'string' } } } } },
        edges: [],
      })

      // No dedup rule: nothing is merged or dropped.
      await t.run()
      const ids0 = [...(await t.load()).nodesById.keys()]
      assert.ok(ids0.includes('orders.Schema.CreateOrderDto'))
      assert.ok(ids0.includes('orders.Schema.CreateOrderDto.schemas.CreateOrderDto.fields.Notes'))
      assert.ok(ids0.includes('orders.APIEndpoint.createOrder.schemas.CreateOrderRequest.fields.customerId'))
    } finally {
      t.cleanup()
    }
  })

  it('with a dedup rule the declared node merges into the spec schema', async () => {
    const t = await setupOrders()
    try {
      t.write('code.corum.yaml', {
        corum: '1.0',
        nodes: {
          'orders.Schema.CreateOrderDto': { type: 'Schema', ids: ['clr:Orders.Contracts.CreateOrderRequest'], schema: { $ref: '#/components/schemas/CreateOrderDto' } },
        },
        components: { schemas: { CreateOrderDto: { type: 'object', properties: { CustomerId: { type: 'string' }, Notes: { type: 'string' } } } } },
        edges: [],
      })
      t.write('imports.yaml', {
        idMaps: ['./maps/code-to-spec.yaml'],
        deduplication: [{ primary: 'openapi', secondary: 'corum' }],
        imports: [
          { adapter: 'openapi', spec: path.join(t.dir, 'openapi.yaml'), componentMapping: { strategy: 'uri-segment', segment: 0 } },
          { adapter: 'corum', spec: path.join(t.dir, 'code.corum.yaml') },
        ],
      })
      const result = await t.run()
      const ids = [...(await t.load()).nodesById.keys()]
      assert.ok(!ids.some(id => id.startsWith('orders.Schema.CreateOrderDto')), ids.join('\n'))
      assert.ok(ids.includes('orders.APIEndpoint.createOrder.schemas.CreateOrderRequest.fields.customerId'))
      assert.ok(!ids.includes('orders.APIEndpoint.createOrder.schemas.CreateOrderRequest.fields.CustomerId'), 'matched via the map, not duplicated')
      assert.ok(ids.includes('orders.APIEndpoint.createOrder.schemas.CreateOrderRequest.fields.Notes'), 'unmatched field is carried, not lost')
      assert.ok(result.diagnostics.some(d => d.message.includes('Notes') && d.message.includes('carried')), JSON.stringify(result.diagnostics))
    } finally {
      t.cleanup()
    }
  })
})
