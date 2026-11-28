import { it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { ImportEntry } from '../../src/import/config.js'

for (const adapter of ['openapi', 'asyncapi'] as const) {
  it(`${adapter}: preserves same-source standalone schemas and foreign-source authority`, async () => {
    const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-reimport-'))
    const fixture = path.resolve('fixtures/sample-graph')
    const spec = path.join(graphDir, 'source.json')
    const schemaId = 'orders.Schema.Address'
    const document = (fields: Record<string, unknown>, count = 2) => {
      const components = { schemas: { Address: { type: 'object', properties: fields } } }
      const ref = { $ref: '#/components/schemas/Address' }
      if (adapter === 'openapi') return {
        openapi: '3.0.3', info: { title: 'Orders', version: '1' }, components,
        paths: Object.fromEntries(Array.from({ length: count }, (_, i) => [
          `/orders/op${i}`, { post: { operationId: `op${i}`, requestBody: { content: { 'application/json': { schema: ref } } }, responses: { '200': { description: 'ok' } } } },
        ])),
      }
      return {
        asyncapi: '3.0.0', info: { title: 'Orders', version: '1' }, components,
        channels: Object.fromEntries(Array.from({ length: count }, (_, i) => [
          `orders.op${i}`, { address: `orders.op${i}`, messages: { event: { name: `Op${i}`, payload: ref } } },
        ])),
        operations: Object.fromEntries(Array.from({ length: count }, (_, i) => [
          `op${i}`, { action: 'send', channel: { $ref: `#/channels/orders.op${i}` }, messages: [{ $ref: `#/channels/orders.op${i}/messages/event` }] },
        ])),
      }
    }
    const entry = (source: string): ImportEntry => adapter === 'openapi'
      ? { adapter, spec: source, componentMapping: { strategy: 'hardcoded', component: 'orders' } }
      : { adapter, spec: source, componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 } }
    const snapshot = () => Object.fromEntries(fs.readdirSync(graphDir, { recursive: true })
      .map(String).filter(p => p.endsWith('.yaml')).sort()
      .map(p => [p, fs.readFileSync(path.join(graphDir, p), 'utf8')]))
    try {
      const initial = await loadGraph({ graphPath: fixture })
      await saveGraph(initial, { sourceGraphPath: fixture, outputGraphPath: graphDir })
      const runtime = createGraphRuntimeConfig({ CORUM_GRAPH_PATH: graphDir })
      const linkedSpec = path.join(graphDir, 'linked.json')
      fs.writeFileSync(linkedSpec, JSON.stringify({
        corum: '1.0',
        nodes: { 'orders.DomainEvent.Linked': { type: 'DomainEvent', schema: { $ref: '#/components/schemas/Linked' } } },
        components: { schemas: { Linked: { type: 'object', properties: { address: { $ref: schemaId } } } } },
      }))
      const run = async (source = path.relative(process.cwd(), spec)) => {
        const result = await runImport({ imports: [entry(source)] }, runtime)
        assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), [])
        return result
      }
      fs.writeFileSync(spec, JSON.stringify(document({ line1: { type: 'string' } })))
      await run()
      const before = snapshot()
      // Equivalent relative spelling exercises the provenance key used by reconciliation.
      await run('./' + path.relative(process.cwd(), spec))
      assert.deepEqual(snapshot(), before)
      const linked = await runImport({ imports: [entry(path.relative(process.cwd(), spec)), { adapter: 'corum', spec: linkedSpec }] }, runtime)
      assert.ok(!linked.diagnostics.some(d => d.message.includes('is not an existing node')))
      let graph = await loadGraph({ graphPath: graphDir })
      assert.equal(graph.nodesById.get('orders.DomainEvent.Linked.schemas.Linked.fields.address')?.properties.$ref, schemaId)
      assert.equal(graph.nodesById.get(schemaId)?.state, 'implemented')
      assert.equal(graph.nodesById.get(schemaId + '.fields.line1')?.state, 'implemented')

      // Existing standalone identity remains sticky even after usage drops to one.
      fs.writeFileSync(spec, JSON.stringify(document({ line1: { type: 'integer' }, postcode: { type: 'integer' } }, 1)))
      const changed = await run()
      assert.ok(!changed.diagnostics.some(d => d.message.includes('shape drift')))
      graph = await loadGraph({ graphPath: graphDir })
      assert.equal(graph.nodesById.get(schemaId)?.state, 'implemented')
      assert.equal(graph.nodesById.get(schemaId + '.fields.postcode')?.properties.type, 'integer')
      assert.equal(graph.nodesById.get(schemaId + '.fields.line1')?.properties.type, 'integer')

      const foreign = path.join(graphDir, 'foreign.json')
      fs.writeFileSync(foreign, JSON.stringify(document({ foreignField: { type: 'string' } }, 1)))
      const reused = await run(foreign)
      assert.ok(reused.diagnostics.some(d => d.message.includes('shape drift')))
      graph = await loadGraph({ graphPath: graphDir })
      assert.equal(graph.nodesById.get(schemaId)?.extractedFrom, path.relative(process.cwd(), spec))
      assert.equal(graph.nodesById.has(schemaId + '.fields.foreignField'), false)
      assert.ok([...graph.edgesByTo.get(schemaId) ?? []].some(e => e.type === 'uses-type'))
    } finally {
      fs.rmSync(graphDir, { recursive: true, force: true })
    }
  })
}
