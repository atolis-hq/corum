import { it } from 'node:test'
import assert from 'node:assert/strict'
import { loadGraph } from '../src/loader/index.js'
import { searchNodesRanked, RANKED_SEARCH_MAX_RESULTS, RANKED_SEARCH_MAX_PER_TEMPLATE } from '../src/graph/index.js'
import type { Node } from '../src/schema/index.js'

async function fixture() {
  return loadGraph({ graphPath: 'fixtures/sample-graph' })
}
function node(id: string, template = 'Example', parentId?: string): Node {
  return { id, template, parentId, namespace: 'test', state: 'proposed', stability: 'unstable', schemaVersion: '1', lastModifiedAt: '', properties: {} }
}
it('ranks name tiers, roots before owned nodes, then alphabetical ids; reports owning roots', async () => {
  const graph = await fixture()
  const root = node('test.Root.owner')
  const nodes = [root, node('z.Example.place'), node('a.Example.place'), node('test.Root.owner.operations.place', 'Operation', root.id), node('a.Example.placement'), node('a.Example.replace'), node('place.Example.other')]
  graph.nodesById = new Map(nodes.map(n => [n.id, n]))
  const results = searchNodesRanked(graph, 'PLACE')
  assert.deepEqual(results.map(r => r.node.id), [
    'a.Example.place', 'z.Example.place', 'test.Root.owner.operations.place',
    'a.Example.placement', 'a.Example.replace', 'place.Example.other',
  ])
  assert.deepEqual(results[2].owner, { id: root.id, template: root.template })
  assert.equal(results[0].owner, undefined)
  assert.deepEqual(results.map(r => r.match), ['exact', 'exact', 'exact', 'prefix', 'substring', 'id'])
  assert.deepEqual(searchNodesRanked(graph, '  '), [])
})
it('caps every template at eight and the overall list at fifty', async () => {
  const graph = await fixture()
  const nodes = Array.from({ length: 100 }, (_, i) => node(`test.Type${Math.floor(i / 10)}.match${i}`, `Type${Math.floor(i / 10)}`))
  graph.nodesById = new Map(nodes.map(n => [n.id, n]))
  const results = searchNodesRanked(graph, 'match')
  assert.equal(RANKED_SEARCH_MAX_RESULTS, 50)
  assert.equal(RANKED_SEARCH_MAX_PER_TEMPLATE, 8)
  assert.equal(results.length, 50)
  assert.equal(results.filter(r => r.node.template === 'Type0').length, 8)
  assert.ok([...new Set(results.map(r => r.node.template))].every(t => results.filter(r => r.node.template === t).length <= 8))
})
it('finds deep children with their cluster root as owner', async () => {
  const results = searchNodesRanked(await fixture(), 'customerId')
  assert.ok(results.some(r => r.node.parentId && r.owner?.id === 'orders.DomainModel.order'))
})
