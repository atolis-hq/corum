import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { loadKinds } from '../src/loader/kind-loader.js'
import { loadGraph } from '../src/loader/index.js'
import { getKindLabel, getNamespaces } from '../src/graph/index.js'
import { lintGraph } from '../src/linter/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import type { Diagnostic } from '../src/schema/index.js'
import type { ContentMap } from '../src/source/index.js'

const fixture = path.resolve('fixtures/sample-graph')

const JOURNEYS = `kinds:
  journey:
    label: Journey
    templates: [Journey]
  event-model:
    label: Event Model
`

describe('kind loader', () => {
  it('always has the built-in component default', () => {
    const diagnostics: Diagnostic[] = []
    const kinds = loadKinds(new Map(), diagnostics)
    assert.equal(diagnostics.length, 0)
    assert.equal(kinds.get('component')?.label, 'Component')
  })

  it('accepts pack-declared kinds with labels', () => {
    const diagnostics: Diagnostic[] = []
    const kinds = loadKinds(new Map([['journeys/kinds.yaml', JOURNEYS]]), diagnostics)
    assert.equal(diagnostics.length, 0)
    assert.equal(kinds.get('journey')?.label, 'Journey')
    assert.equal(kinds.get('event-model')?.label, 'Event Model')
    assert.deepEqual(kinds.get('journey')?.templates, ['Journey'])
  })

  it('accepts identical redeclarations and errors on conflicting ones', () => {
    const diagnostics: Diagnostic[] = []
    loadKinds(new Map([
      ['a/kinds.yaml', JOURNEYS],
      ['b/kinds.yaml', JOURNEYS],
      ['core/kinds.yaml', 'kinds:\n  component:\n    label: Component\n'],
    ]), diagnostics)
    assert.equal(diagnostics.length, 0)

    const conflict: Diagnostic[] = []
    loadKinds(new Map([
      ['a/kinds.yaml', JOURNEYS],
      ['b/kinds.yaml', 'kinds:\n  journey:\n    label: Trip\n'],
    ]), conflict)
    assert.equal(conflict.length, 1)
    assert.equal(conflict[0].severity, 'error')
  })

  it('reports malformed files as errors without throwing', () => {
    const diagnostics: Diagnostic[] = []
    const content: ContentMap = new Map([
      ['a/kinds.yaml', 'kinds: ['],
      ['b/kinds.yaml', 'nope: 1\n'],
      ['c/kinds.yaml', 'kinds:\n  bad.id:\n    label: X\n  nolabel: {}\n  ok:\n    label: Ok\n'],
    ])
    const kinds = loadKinds(content, diagnostics)
    assert.equal(diagnostics.length, 4)
    assert.ok(diagnostics.every(d => d.severity === 'error'))
    assert.equal(kinds.get('ok')?.label, 'Ok')
  })
})

describe('kinds in a loaded graph', () => {
  async function loadWith(declaration: string | undefined, packKinds: string | undefined) {
    const source = new FileGraphSource({ graphDir: fixture })
    const content = await source.loadGraphContent('main')
    const packs = await source.loadPackContent('main')
    if (declaration) content.set('nodes/orders/namespace.yaml', declaration)
    if (packKinds) packs.set('journeys/kinds.yaml', packKinds)
    return loadGraph({ strict: false, source: {
      defaultBranch: async () => 'main', listBranches: async () => ['main'],
      head: async () => 'test', log: async () => [],
      loadGraphContent: async () => content, loadPackContent: async () => packs, commit: async () => {},
    } })
  }

  it('exposes core component kind in the registry', async () => {
    const graph = await loadGraph({ graphPath: fixture })
    assert.equal(graph.kinds?.get('component')?.label, 'Component')
    assert.equal(graph.diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('loads a namespace of a pack kind without kind warnings', async () => {
    const graph = await loadWith('kind: event-model\n', JOURNEYS)
    assert.equal(getNamespaces(graph).get('orders')?.kind, 'event-model')
    assert.equal(getKindLabel(graph, 'event-model'), 'Event Model')
    assert.ok(!graph.diagnostics.some(d => d.message.includes('unrecognised kind')))
  })

  it('warns on unknown kinds, still loads, and falls back to the id as label', async () => {
    const graph = await loadWith('kind: mystery\n', undefined)
    assert.equal(getNamespaces(graph).get('orders')?.kind, 'mystery')
    assert.ok(graph.diagnostics.some(d => d.severity === 'warning' && d.message.includes("'mystery'")))
    assert.equal(getKindLabel(graph, 'mystery'), 'mystery')
  })

  it('warns advisorily when a namespace owns templates a kind does not list', async () => {
    const graph = await loadWith('kind: journey\n', JOURNEYS)
    const warnings = lintGraph(graph).filter(d => d.message.includes('expected one of'))
    assert.ok(warnings.length > 0)
    assert.ok(warnings.every(d => d.severity === 'warning'))
    assert.ok(graph.nodesById.size > 0)
  })

  it('does not restrict component namespaces', async () => {
    const graph = await loadGraph({ graphPath: fixture })
    assert.equal(lintGraph(graph).filter(d => d.message.includes('expected one of')).length, 0)
  })
})
