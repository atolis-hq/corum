import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpHandlers } from '../src/mcp/index.js'
import type { Graph, MultiGraph } from '../src/schema/index.js'
import type { GraphSource, ContentMap } from '../src/source/index.js'
import type { MultiGraphCache } from '../src/web/server.js'

function makeMinimalGraph(): Graph {
  const templates = new Map()
  templates.set('Widget', {
    name: 'Widget',
    info: { version: '1', core: false, description: 'A widget' },
    ui: { displayName: 'Widget' },
  })
  templates.set('Field', {
    name: 'Field',
    info: { version: '1', core: true },
    ui: { displayName: 'Field' },
  })
  const nodesById = new Map()
  nodesById.set('comp.Widget.first', {
    id: 'comp.Widget.first',
    template: 'Widget',
    component: 'comp',
    state: 'draft' as const,
    stability: 'unstable' as const,
    schemaVersion: '1',
    lastModifiedAt: '2026-05-01',
    properties: {},
  })
  return { nodesById, edgesByFrom: new Map(), edgesByTo: new Map(), templates, diagnostics: [] }
}

describe('MCP handlers - list_templates', () => {
  const handlers = createMcpHandlers(makeMinimalGraph())

  it('returns non-core templates without branch param', async () => {
    const result = await handlers.list_templates({})
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text, /Widget/)
    assert.match(result.content[0].text, /\bField\b/)
  })

  it('with branch param and no source - falls back to default graph without error', async () => {
    const result = await handlers.list_templates({ branch: 'main' })
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text, /Widget/)
  })

  it('with unknown branch and no source - falls back to default graph without error', async () => {
    const result = await handlers.list_templates({ branch: 'nonexistent' })
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text, /Widget/)
  })
})

describe('MCP handlers - get_cluster overlay_refs', () => {
  const handlers = createMcpHandlers(makeMinimalGraph())

  it('returns cluster without overlay when overlay_refs not provided', async () => {
    const result = await handlers.get_cluster({ node_id: 'comp.Widget.first' })
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text, /comp\.Widget\.first/)
  })

  it('with overlay_refs but no source - returns cluster without overlay field, no error', async () => {
    const result = await handlers.get_cluster({ node_id: 'comp.Widget.first', overlay_refs: ['main'] })
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text, /comp\.Widget\.first/)
  })

  it('with unknown branch - returns error', async () => {
    const result = await handlers.get_cluster({ node_id: 'comp.Widget.first', branch: 'nonexistent' })
    assert.equal(result.isError, true)
  })
})

describe('MCP handlers - MultiGraphCache support', () => {
  class BrokenSource implements GraphSource {
    async defaultBranch(): Promise<string> { return 'main' }
    async listBranches(): Promise<string[]> { throw new Error('broken source: should not be called') }
    async loadPackContent(): Promise<ContentMap> { return new Map() }
    async loadGraphContent(): Promise<ContentMap> { return new Map() }
    async commit(): Promise<void> { throw new Error('not implemented') }
    async head(): Promise<string> { return 'fake-head' }
    async log(): Promise<string[]> { return [] }
  }

  function makeFakeMulti(graph: Graph): MultiGraph {
    const branch = { ref: 'main', graph, isDefault: true }
    return {
      default: branch,
      branches: [branch],
      branchResults: [{ ref: 'main', status: 'loaded' as const }],
      overlay: () => { throw new Error('not used') },
      diff: () => { throw new Error('not used') },
    }
  }

  it('list_branches uses provided cache instead of calling loadMultiGraph', async () => {
    const graph = makeMinimalGraph()
    let cacheGetCalls = 0
    const cache: MultiGraphCache = {
      get: async () => { cacheGetCalls++; return makeFakeMulti(graph) },
      invalidate: () => {},
    }
    const handlers = createMcpHandlers(graph, new BrokenSource(), cache)
    const result = await handlers.list_branches({})
    assert.equal(result.isError, undefined)
    assert.equal(cacheGetCalls, 1)
    assert.match(result.content[0].text, /main/)
  })

  it('list_branches without cache calls loadMultiGraph (source error propagates)', async () => {
    const graph = makeMinimalGraph()
    const handlers = createMcpHandlers(graph, new BrokenSource())
    const result = await handlers.list_branches({})
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /broken source/)
  })
})
