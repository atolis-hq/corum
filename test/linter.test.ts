import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintGraph } from '../src/linter/index.js'
import { loadGraph } from '../src/loader/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import type { Edge, EdgeTypeDef, Graph, Node, Template } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

function makeTemplate(name: string, overrides: Partial<Template> = {}): Template {
  return { name, info: { version: '1.0.0' }, ...overrides }
}

function makeNode(overrides: Partial<Node> & { id: string; template: string }): Node {
  return {
    component: 'orders',
    state: 'proposed',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: '2026-01-01',
    properties: {},
    ...overrides,
  }
}

function makeGraph(templates: Template[], nodes: Node[], edges: Edge[] = [], edgeTypes?: Map<string, EdgeTypeDef>): Graph {
  const nodesById = new Map(nodes.map(n => [n.id, n]))
  const edgesByFrom = new Map<string, Edge[]>()
  const edgesByTo = new Map<string, Edge[]>()
  for (const edge of edges) {
    edgesByFrom.set(edge.from, [...(edgesByFrom.get(edge.from) ?? []), edge])
    edgesByTo.set(edge.to, [...(edgesByTo.get(edge.to) ?? []), edge])
  }
  return {
    nodesById,
    edgesByFrom,
    edgesByTo,
    templates: new Map(templates.map(t => [t.name, t])),
    edgeTypes,
    diagnostics: [],
  }
}

describe('lintGraph — node property validation', () => {
  it('flags missing required property', () => {
    const template = makeTemplate('Field', {
      properties: { type: 'object', additionalProperties: false, required: ['nullable'], properties: { nullable: { type: 'boolean' } } },
    })
    const node = makeNode({ id: 'orders.Field.x', template: 'Field', properties: {} })
    const diagnostics = lintGraph(makeGraph([template], [node]))

    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.nodeId === 'orders.Field.x' && d.message.includes('nullable')))
  })

  it('does not flag a present required property', () => {
    const template = makeTemplate('Field', {
      properties: { type: 'object', additionalProperties: false, required: ['nullable'], properties: { nullable: { type: 'boolean' } } },
    })
    const node = makeNode({ id: 'orders.Field.x', template: 'Field', properties: { nullable: false } })
    const diagnostics = lintGraph(makeGraph([template], [node]))
    assert.equal(diagnostics.length, 0)
  })

  it('flags wrong primitive type', () => {
    const template = makeTemplate('Field', {
      properties: { type: 'object', properties: { nullable: { type: 'boolean' } } },
    })
    const node = makeNode({ id: 'orders.Field.x', template: 'Field', properties: { nullable: 'not-a-boolean' } })
    const diagnostics = lintGraph(makeGraph([template], [node]))

    assert.ok(diagnostics.some(d => d.message.includes("expected type 'boolean'")))
  })

  it('flags unknown property when additionalProperties is false', () => {
    const template = makeTemplate('Field', {
      properties: { type: 'object', additionalProperties: false, properties: { nullable: { type: 'boolean' } } },
    })
    const node = makeNode({ id: 'orders.Field.x', template: 'Field', properties: { nullable: false, bogus: 'x' } })
    const diagnostics = lintGraph(makeGraph([template], [node]))

    assert.ok(diagnostics.some(d => d.message.includes("unknown property 'bogus'")))
  })

  it('does not flag unknown property when additionalProperties is not false', () => {
    const template = makeTemplate('Field', {
      properties: { type: 'object', properties: { nullable: { type: 'boolean' } } },
    })
    const node = makeNode({ id: 'orders.Field.x', template: 'Field', properties: { nullable: false, extra: 'x' } })
    const diagnostics = lintGraph(makeGraph([template], [node]))
    assert.equal(diagnostics.length, 0)
  })

  it('merges required and properties across allOf inheritance chain', () => {
    const template = makeTemplate('DomainEvent', {
      properties: {
        allOf: [
          { type: 'object', additionalProperties: false, required: ['topic'], properties: { topic: { type: 'string' } } },
          { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string' } } },
        ],
      },
    })
    const node = makeNode({ id: 'orders.DomainEvent.x', template: 'DomainEvent', properties: { topic: 'orders.events' } })
    const diagnostics = lintGraph(makeGraph([template], [node]))

    assert.ok(diagnostics.some(d => d.message.includes("missing required property 'description'")))
    assert.ok(!diagnostics.some(d => d.message.includes("missing required property 'topic'")))
  })

  it('skips nodes whose template is unresolved', () => {
    const node = makeNode({ id: 'orders.Field.x', template: 'Missing', properties: { anything: true } })
    const diagnostics = lintGraph(makeGraph([], [node]))
    assert.equal(diagnostics.length, 0)
  })
})

describe('lintGraph — edge type endpoint enforcement', () => {
  it('flags an outgoing edge type not declared by the source template', () => {
    const source = makeTemplate('Field', { 'edge-types': { supports: ['maps-to'] } })
    const target = makeTemplate('Field', { name: 'Field' })
    const fromNode = makeNode({ id: 'orders.Field.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'orders.Field.a__reads__orders.Field.b', from: fromNode.id, to: toNode.id, type: 'reads', state: 'proposed', stability: 'unstable' }

    const diagnostics = lintGraph(makeGraph([source], [fromNode, toNode], [edge]))
    assert.ok(diagnostics.some(d => d.nodeId === fromNode.id && d.message.includes('reads')))
  })

  it('flags an incoming edge type not declared by the target template', () => {
    const template = makeTemplate('Field', { 'edge-types': { incoming: ['has-field'] } })
    const fromNode = makeNode({ id: 'orders.Schema.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'orders.Schema.a__reads__orders.Field.b', from: fromNode.id, to: toNode.id, type: 'reads', state: 'proposed', stability: 'unstable' }

    const diagnostics = lintGraph(makeGraph([template], [fromNode, toNode], [edge]))
    assert.ok(diagnostics.some(d => d.nodeId === toNode.id && d.message.includes('reads')))
  })

  it('allows an edge type declared in supports on both endpoints', () => {
    const template = makeTemplate('Field', { 'edge-types': { supports: ['maps-to'] } })
    const fromNode = makeNode({ id: 'orders.Field.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'orders.Field.a__maps-to__orders.Field.b', from: fromNode.id, to: toNode.id, type: 'maps-to', state: 'proposed', stability: 'unstable' }

    const diagnostics = lintGraph(makeGraph([template], [fromNode, toNode], [edge]))
    assert.equal(diagnostics.length, 0)
  })

  it('does not constrain templates with no edge-types block', () => {
    const template = makeTemplate('Field')
    const fromNode = makeNode({ id: 'orders.Field.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'orders.Field.a__weird__orders.Field.b', from: fromNode.id, to: toNode.id, type: 'weird', state: 'proposed', stability: 'unstable' }

    const diagnostics = lintGraph(makeGraph([template], [fromNode, toNode], [edge]))
    assert.equal(diagnostics.length, 0)
  })

  it('resolves edge-types through the extends chain', () => {
    const parent = makeTemplate('Event', { 'edge-types': { incoming: ['produces'] } })
    const child = makeTemplate('DomainEvent', { extends: 'Event' })
    const fromNode = makeNode({ id: 'orders.DomainOperation.op', template: 'DomainEvent' })
    const toNode = makeNode({ id: 'orders.DomainEvent.x', template: 'DomainEvent' })
    const edge: Edge = { id: 'e1', from: fromNode.id, to: toNode.id, type: 'triggers', state: 'proposed', stability: 'unstable' }

    const diagnostics = lintGraph(makeGraph([parent, child], [fromNode, toNode], [edge]))
    assert.ok(diagnostics.some(d => d.nodeId === toNode.id))
  })

  it('skips generated (structural) edges', () => {
    const template = makeTemplate('Field', { 'edge-types': { incoming: ['has-field'] } })
    const fromNode = makeNode({ id: 'orders.Schema.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'e1', from: fromNode.id, to: toNode.id, type: 'reads', state: 'proposed', stability: 'unstable', generated: true }

    const diagnostics = lintGraph(makeGraph([template], [fromNode, toNode], [edge]))
    assert.equal(diagnostics.length, 0)
  })
})

describe('lintGraph — edge property validation', () => {
  it('flags missing required edge property', () => {
    const edgeTypes = new Map<string, EdgeTypeDef>([
      ['maps-to', { name: 'maps-to', category: 'lineage', properties: { type: 'object', required: ['transform'], properties: { transform: { type: 'string' } } } }],
    ])
    const fromNode = makeNode({ id: 'orders.Field.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'e1', from: fromNode.id, to: toNode.id, type: 'maps-to', state: 'proposed', stability: 'unstable' }

    const diagnostics = lintGraph(makeGraph([], [fromNode, toNode], [edge], edgeTypes))
    assert.ok(diagnostics.some(d => d.message.includes("missing required property 'transform'")))
  })

  it('flags wrong type for an edge property', () => {
    const edgeTypes = new Map<string, EdgeTypeDef>([
      ['maps-to', { name: 'maps-to', category: 'lineage', properties: { type: 'object', properties: { transform: { type: 'string' } } } }],
    ])
    const fromNode = makeNode({ id: 'orders.Field.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'e1', from: fromNode.id, to: toNode.id, type: 'maps-to', state: 'proposed', stability: 'unstable', properties: { transform: 123 } }

    const diagnostics = lintGraph(makeGraph([], [fromNode, toNode], [edge], edgeTypes))
    assert.ok(diagnostics.some(d => d.message.includes("expected type 'string'")))
  })

  it('flags unknown edge property when additionalProperties is false', () => {
    const edgeTypes = new Map<string, EdgeTypeDef>([
      ['maps-to', { name: 'maps-to', category: 'lineage', properties: { type: 'object', additionalProperties: false, properties: { transform: { type: 'string' } } } }],
    ])
    const fromNode = makeNode({ id: 'orders.Field.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'e1', from: fromNode.id, to: toNode.id, type: 'maps-to', state: 'proposed', stability: 'unstable', properties: { bogus: true } }

    const diagnostics = lintGraph(makeGraph([], [fromNode, toNode], [edge], edgeTypes))
    assert.ok(diagnostics.some(d => d.message.includes("unknown property 'bogus'")))
  })

  it('is a no-op when the edge type has no properties schema', () => {
    const edgeTypes = new Map<string, EdgeTypeDef>([['maps-to', { name: 'maps-to', category: 'lineage' }]])
    const fromNode = makeNode({ id: 'orders.Field.a', template: 'Field' })
    const toNode = makeNode({ id: 'orders.Field.b', template: 'Field' })
    const edge: Edge = { id: 'e1', from: fromNode.id, to: toNode.id, type: 'maps-to', state: 'proposed', stability: 'unstable', properties: { anything: true } }

    const diagnostics = lintGraph(makeGraph([], [fromNode, toNode], [edge], edgeTypes))
    assert.equal(diagnostics.length, 0)
  })
})

describe('lintGraph — fixture graph integration', () => {
  it('lints the fixture sample graph cleanly (warnings only, none expected)', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const graph = await loadGraph({ source })
    const diagnostics = lintGraph(graph)
    assert.equal(diagnostics.length, 0, `unexpected lint diagnostics: ${JSON.stringify(diagnostics, null, 2)}`)
  })
})

describe('loadGraph — linter integration', () => {
  it('appends linter diagnostics without affecting strict success', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir, strict: true })
    assert.equal(graph.diagnostics.filter(d => d.severity === 'error').length, 0)
  })
})
