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
