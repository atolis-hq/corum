import { stringify as stringifyYaml } from 'yaml'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const ENUM_ID = 'orders.EnumDefinition.OrderStatus'

describe('corum import — node-ID $ref to existing nodes', () => {
  it('links a field to an existing enum and leaves the enum untouched on re-import', async () => {
    const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-noderef-'))
    try {
      await saveGraph(await loadGraph({ graphPath: fixtureGraphDir }), { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
      process.env.CORUM_GRAPH_PATH = graphDir
      const runtimeConfig = createGraphRuntimeConfig()

      // First import declares the enum.
      const declaring = path.join(graphDir, 'declare.corum.yaml')
      fs.writeFileSync(declaring, stringifyYaml({
        corum: '1.0',
        nodes: { 'orders.DomainEvent.OrderShipped': { type: 'DomainEvent', schema: { $ref: '#/components/schemas/OrderShipped' } } },
        components: { schemas: { OrderShipped: { type: 'object', properties: { status: { $ref: '#/components/schemas/OrderStatus' } } }, OrderStatus: { enum: ['open', 'closed'] } } },
      }))
      const first = await runImport({ imports: [{ adapter: 'corum', spec: declaring }] }, runtimeConfig)
      assert.ok(!first.diagnostics.some(d => d.severity === 'error'))
      const before = await loadGraph({ graphPath: graphDir })
      const enumBefore = before.nodesById.get(ENUM_ID)
      assert.ok(enumBefore, 'enum should exist after the first import')

      // Second import only references it by ID.
      const referencing = path.join(graphDir, 'reference.corum.yaml')
      fs.writeFileSync(referencing, stringifyYaml({
        corum: '1.0',
        nodes: { 'orders.DomainEvent.OrderCancelled': { type: 'DomainEvent', schema: { $ref: '#/components/schemas/OrderCancelled' } } },
        components: { schemas: { OrderCancelled: { type: 'object', required: ['status'], properties: { status: { $ref: ENUM_ID } } } } },
      }))
      for (let i = 0; i < 2; i++) {
        const result = await runImport({ imports: [{ adapter: 'corum', spec: referencing }] }, runtimeConfig)
        assert.ok(!result.diagnostics.some(d => d.severity === 'error'))
        assert.ok(!result.diagnostics.some(d => d.message.includes(ENUM_ID)), 'no unresolved warning expected')
        const after = await loadGraph({ graphPath: graphDir })
        const field = after.nodesById.get('orders.DomainEvent.OrderCancelled.schemas.OrderCancelled.fields.status')
        assert.equal(field?.properties.$ref, ENUM_ID)
        const enumAfter = after.nodesById.get(ENUM_ID)
        assert.ok(enumAfter)
        assert.equal(enumAfter.parentId, enumBefore.parentId)
        assert.deepEqual(enumAfter.properties, enumBefore.properties)
        assert.equal(enumAfter.extractedFrom, enumBefore.extractedFrom)
        assert.deepEqual(
          [...after.nodesById.keys()].filter(id => id.startsWith(`${ENUM_ID}.`)).sort(),
          [...before.nodesById.keys()].filter(id => id.startsWith(`${ENUM_ID}.`)).sort(),
        )
      }
    } finally {
      fs.rmSync(graphDir, { recursive: true, force: true })
    }
  })
})

for (const earlier of [true, false]) {
  it(`resolves direct IDs only from earlier successful entries (earlier=${earlier})`, async () => {
    const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-ordered-ref-'))
    try {
      // Start with packs but no nodes, as on a freshly initialized graph.
      await saveGraph(await loadGraph({ graphPath: fixtureGraphDir }), { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
      fs.rmSync(path.join(graphDir, 'nodes'), { recursive: true, force: true })
      fs.rmSync(path.join(graphDir, 'edges'), { recursive: true, force: true })
      const runtime = createGraphRuntimeConfig({ CORUM_GRAPH_PATH: graphDir })
      const spec = path.join(graphDir, 'api.json')
      const linked = path.join(graphDir, 'linked.json')
      const schemaId = 'orders.Schema.Address'
      const fieldId = `${schemaId}.fields.line1`
      const missingId = 'orders.Schema.Missing'
      fs.writeFileSync(spec, JSON.stringify({
        openapi: '3.0.3', info: { title: 'Orders', version: '1' },
        components: { schemas: { Address: { type: 'object', properties: { line1: { type: 'string' } } } } },
        paths: Object.fromEntries(['first', 'second'].map(name => [`/orders/${name}`, {
          post: { operationId: name, requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Address' } } } }, responses: { '200': { description: 'ok' } } },
        }])),
      }))
      fs.writeFileSync(linked, JSON.stringify({
        corum: '1.0',
        nodes: { 'orders.DomainEvent.Linked': { type: 'DomainEvent', schema: { $ref: '#/components/schemas/Linked' } } },
        components: { schemas: { Linked: { type: 'object', properties: {
          address: { $ref: schemaId }, line: { $ref: fieldId }, missing: { $ref: missingId },
        } } } },
        edges: [{ type: 'maps-to', from: fieldId, to: 'orders.DomainEvent.Linked.schemas.Linked.fields.line' }],
      }))
      const apiEntry = { adapter: 'openapi' as const, spec, componentMapping: { strategy: 'hardcoded' as const, component: 'orders' } }
      const linkedEntry = { adapter: 'corum' as const, spec: linked }
      const imports = earlier ? [apiEntry, linkedEntry] : [linkedEntry, apiEntry]
      const result = await runImport({ imports }, runtime)
      assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), [])
      for (const id of [schemaId, fieldId]) {
        assert.equal(result.diagnostics.some(d => d.message.includes(`references '${id}'`)), !earlier)
      }
      assert.ok(result.diagnostics.some(d => d.message.includes(`references '${missingId}'`)))
      const graph = await loadGraph({ graphPath: graphDir })
      const owner = 'orders.DomainEvent.Linked.schemas.Linked.fields.'
      assert.equal(graph.nodesById.get(owner + 'address')?.properties.$ref, earlier ? schemaId : undefined)
      assert.equal(graph.nodesById.get(owner + 'line')?.properties.$ref, earlier ? fieldId : undefined)
      assert.equal(graph.nodesById.get(owner + 'missing')?.properties.type, 'string')
      assert.ok([...graph.edgesByFrom.values()].flat().some(e => e.from === fieldId && e.to === owner + 'line' && e.type === 'maps-to'))
      if (earlier) {
        const snapshot = () => Object.fromEntries(fs.readdirSync(graphDir, { recursive: true })
          .map(String).filter(p => p.endsWith('.yaml')).sort()
          .map(p => [p, fs.readFileSync(path.join(graphDir, p), 'utf8')]))
        const before = snapshot()
        await runImport({ imports }, runtime)
        assert.deepEqual(snapshot(), before)
        const after = await loadGraph({ graphPath: graphDir })
        for (const id of [schemaId, fieldId]) assert.equal(after.nodesById.get(id)?.state, 'implemented')
      }
    } finally {
      fs.rmSync(graphDir, { recursive: true, force: true })
    }
  })
}
