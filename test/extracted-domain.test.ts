import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { loadGraph } from '../src/loader/index.js'
import { getLineage } from '../src/graph/index.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

it('shipped packs support extracted projection operations and actor-to-target relationships', async () => {
  const graphPath = await mkdtemp(path.join(tmpdir(), 'corum-extracted-'))
  try {
    await mkdir(path.join(graphPath, 'nodes'))
    await mkdir(path.join(graphPath, 'edges'))
    const clusters = [
      { template: 'Command', name: 'update' },
      { template: 'ReadModel', name: 'view', operations: {
        apply: { description: 'Apply an event', state: 'proposed', stability: 'unstable' },
      } },
      { template: 'DomainEvent', name: 'changed' },
      { template: 'APIEndpoint', name: 'fetch', properties: {
        method: 'GET', path: '/view', responses: { '200': '#/schemas/result' },
      }, schemas: { result: { fields: {} } } },
    ]
    for (const { template, name, ...content } of clusters) {
      await writeFile(path.join(graphPath, 'nodes', name + '.yaml'), stringify({
        id: 'orders.' + template + '.' + name, template, schemaVersion: '1',
        metadata: { component: 'orders', state: 'proposed', stability: 'unstable', lastModifiedAt: '2026-11-27' },
        ...content,
      }))
    }
    const relationships = [
      ['orders.Command.update', 'writes', 'orders.ReadModel.view'],
      ['orders.DomainEvent.changed', 'triggers', 'orders.ReadModel.view'],
      ['orders.ReadModel.view', 'produces', 'orders.DomainEvent.changed'],
      ['orders.Command.update', 'calls', 'orders.APIEndpoint.fetch'],
      ['orders.ReadModel.view.operations.apply', 'calls', 'orders.APIEndpoint.fetch'],
      ['orders.APIEndpoint.fetch', 'reads', 'orders.ReadModel.view'],
    ]
    await writeFile(path.join(graphPath, 'edges', 'relationships.yaml'), stringify({
      edges: relationships.map(([from, type, to]) => ({
        from, type, to, state: 'proposed', stability: 'unstable',
      })),
    }))
    const graph = await loadGraph({ graphPath, packsPath: path.join(repoRoot, '.corum/packs') })
    assert.deepEqual(graph.diagnostics, [])
    assert.equal(graph.edgeTypes?.get('writes')?.category, 'semantic')
    assert.equal(graph.edgeTypes?.get('writes')?.traversal, 'bidirectional')
    assert.equal(graph.edgeTypes?.get('reads')?.traversal, 'outbound-only')
    const operation = graph.nodesById.get('orders.ReadModel.view.operations.apply')
    assert.equal(operation?.template, 'DomainOperation')
    assert.equal(operation?.parentId, 'orders.ReadModel.view')
    for (const [from, type, to] of relationships) {
      assert.ok(graph.edgesByFrom.get(from)?.some(edge => edge.type === type && edge.to === to))
    }
    const upstream = getLineage(graph, ['orders.ReadModel.view'], {
      direction: 'upstream', edgeTypes: ['writes', 'reads'],
    }).nodes.map(node => node.id)
    assert.ok(upstream.includes('orders.Command.update'))
    assert.ok(!upstream.includes('orders.APIEndpoint.fetch'))
  } finally {
    await rm(graphPath, { recursive: true, force: true })
  }
})
