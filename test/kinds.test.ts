import { it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { loadKinds, getKindLabel } from '../src/loader/kind-loader.js'
import { loadGraph } from '../src/loader/index.js'
import { lintGraph } from '../src/linter/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import type { Diagnostic } from '../src/schema/index.js'

it('merges pack kinds, accepts identical definitions and diagnoses conflicts', () => {
  const diagnostics: Diagnostic[] = []
  const kinds = loadKinds(new Map([
    ['a/kinds.yaml', 'kinds:\n  journey:\n    label: Journey\n    templates: [Schema, DomainModel]\n  event-model:\n    label: Event model\n  "Any exact.string":\n    label: Exact\n'],
    ['b/kinds.yaml', 'kinds:\n  journey:\n    templates: [DomainModel, Schema]\n    label: Journey\n'],
    ['c/kinds.yaml', 'kinds:\n  journey:\n    label: Different\n'],
  ]), diagnostics)
  assert.equal(kinds.get('component')?.label, 'Component')
  assert.equal(kinds.get('journey')?.label, 'Journey')
  assert.equal(kinds.get('event-model')?.label, 'Event model')
  assert.equal(kinds.get('Any exact.string')?.label, 'Exact')
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].severity, 'error')
  assert.match(diagnostics[0].message, /conflicting/)
  assert.equal(getKindLabel(kinds, 'unknown'), 'unknown')
  assert.equal(loadKinds(new Map(), []).get('component')?.label, 'Component')
})

it('isolates malformed kind files and definitions', () => {
  for (const yaml of ['kinds: [', 'kinds: []', 'kinds: null', 'kinds:\n  bad: []', 'kinds:\n  bad:\n    label: 4', 'kinds:\n  bad:\n    label: Bad\n    templates: [4]']) {
    const diagnostics: Diagnostic[] = []
    assert.equal(loadKinds(new Map([['test/kinds.yaml', yaml]]), diagnostics).size, 1)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
  }
})

it('loads registered and unknown kinds and only advises about unexpected templates', async () => {
  const source = new FileGraphSource({ graphDir: path.resolve('fixtures/sample-graph') })
  const content = await source.loadGraphContent('main')
  const packs = await source.loadPackContent('main')
  packs.set('test/kinds.yaml', 'kinds:\n  journey:\n    label: Journey\n    templates: [DomainModel]\n  event-model:\n    label: Event model\n')
  content.set('nodes/orders/namespace.yaml', 'kind: journey\ndescription: Preserved\n')
  content.set('nodes/unknown/namespace.yaml', 'kind: Unknown.Kind\n')
  const testSource = {
    defaultBranch: async () => 'main', listBranches: async () => ['main'],
    head: async () => 'test', log: async () => [], commit: async () => {},
    loadGraphContent: async () => content, loadPackContent: async () => packs,
  }
  const graph = await loadGraph({ source: testSource })
  assert.equal(graph.kinds?.get('journey')?.label, 'Journey')
  assert.equal(graph.kinds?.get('event-model')?.label, 'Event model')
  assert.deepEqual(graph.namespaces?.get('orders'), { kind: 'journey', description: 'Preserved' })
  assert.equal(graph.namespaces?.get('unknown')?.kind, 'Unknown.Kind')
  assert.ok(graph.diagnostics.some(d => d.message.includes("unrecognised kind 'Unknown.Kind'") && d.severity === 'warning'))
  assert.ok(!graph.diagnostics.some(d => d.message.includes("unrecognised kind 'journey'")))
  const unexpected = graph.diagnostics.filter(d => d.message.includes('unexpected template'))
  assert.ok(unexpected.length > 0)
  assert.ok(unexpected.every(d => d.severity === 'warning'))
  graph.namespaces!.set('orders', { kind: 'component' })
  assert.ok(!lintGraph(graph).some(d => d.message.includes('unexpected template')))
  packs.set('broken/kinds.yaml', 'kinds: [')
  const tolerant = await loadGraph({ source: testSource, strict: false })
  assert.equal(tolerant.kinds?.get('journey')?.label, 'Journey')
  assert.equal(tolerant.nodesById.size, graph.nodesById.size)
  assert.ok(tolerant.diagnostics.some(d => d.file === 'broken/kinds.yaml' && d.severity === 'error'))
})
