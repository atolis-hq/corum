import { it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadGraph } from '../src/loader/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { serializeGraph, saveGraph } from '../src/writer/graph-writer.js'

const fixture = path.resolve('fixtures/sample-graph')

it('defaults all namespaces from ID prefixes without declarations or new diagnostics', async () => {
  const graph = await loadGraph({ graphPath: fixture })
  assert.deepEqual([...graph.namespaces!.keys()].sort(), [...new Set([...graph.nodesById.keys()].map(id => id.split('.')[0]))].sort())
  assert.ok([...graph.namespaces!.values()].every(ns => ns.kind === 'component'))
  assert.ok(![...serializeGraph(graph).keys()].some(key => key.endsWith('/namespace.yaml')))
})

it('loads declarations as metadata, isolates malformed declarations, and saves byte-stably', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-namespaces-'))
  try {
    const source = new FileGraphSource({ graphDir: fixture })
    const content = await source.loadGraphContent('main')
    const original = await loadGraph({ graphPath: fixture })
    const declaration = '# kept verbatim\ndescription: "A journey"\nkind: journey\n'
    content.set('nodes/orders/namespace.yaml', declaration)
    content.set('nodes/empty/namespace.yaml', 'kind: component\n')
    for (const [name, text] of Object.entries({ bad: 'kind: [', extra: 'kind: component\nunknown: true', number: 'kind: 2', description: 'kind: component\ndescription: 2' })) {
      content.set(`nodes/${name}/namespace.yaml`, text)
    }
    const graph = await loadGraph({ source: {
      defaultBranch: async () => 'main', listBranches: async () => ['main'],
      head: async () => 'test', log: async () => [],
      loadGraphContent: async () => content, loadPackContent: ref => source.loadPackContent(ref), commit: async () => {},
    }, strict: false })
    assert.equal(graph.nodesById.size, original.nodesById.size)
    assert.deepEqual(graph.namespaces!.get('orders'), { kind: 'journey', description: 'A journey' })
    assert.equal(graph.diagnostics.filter(d => d.message.startsWith('invalid namespace declaration')).length, 4)
    assert.ok(graph.diagnostics.some(d => d.file === 'nodes/empty/namespace.yaml' && d.severity === 'warning'))
    assert.ok(graph.diagnostics.some(d => d.message.includes('unrecognised kind')))
    // Remove deliberately malformed files before strict reload.
    for (const name of ['bad', 'extra', 'number', 'description']) content.delete(`nodes/${name}/namespace.yaml`)
    await saveGraph(graph, { sourceGraphPath: fixture, outputGraphPath: tmp })
    assert.equal(fs.readFileSync(path.join(tmp, 'nodes/orders/namespace.yaml'), 'utf8'), declaration)
    const reloaded = await loadGraph({ graphPath: tmp })
    assert.deepEqual(reloaded.namespaces, graph.namespaces)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})
