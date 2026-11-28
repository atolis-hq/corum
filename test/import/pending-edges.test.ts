import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify as stringifyYaml } from 'yaml'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { loadImportConfig } from '../../src/import/config.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { Graph } from '../../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

const FROM = 'orders.DomainModel.OrderAggregate'

const MAP = {
  rules: [{ from: 'clr:{area}.Contracts.{type}', to: 'orders.DomainModel.{type|lower}' }],
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-pending-'))
  const graphDir = path.join(dir, 'graph')
  const graph = await loadGraph({ graphPath: fixtureGraphDir })
  await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
  const write = (name: string, content: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), stringifyYaml(content))
  }
  write('maps/map.yaml', MAP)
  process.env.CORUM_GRAPH_PATH = graphDir
  const importA = (edges: unknown[]) => {
    write('a.corum.yaml', {
      corum: '1.0',
      nodes: { [FROM]: { type: 'DomainModel', title: 'OrderAggregate' } },
      edges,
    })
    write('a.yaml', { idMaps: ['./maps/map.yaml'], imports: [{ adapter: 'corum', spec: path.join(dir, 'a.corum.yaml') }] })
    return runImport(loadImportConfig(path.join(dir, 'a.yaml')), createGraphRuntimeConfig())
  }
  const importB = (nodes: Record<string, unknown>) => {
    write('b.corum.yaml', { corum: '1.0', nodes })
    write('b.yaml', { idMaps: ['./maps/map.yaml'], imports: [{ adapter: 'corum', spec: path.join(dir, 'b.corum.yaml') }] })
    return runImport(loadImportConfig(path.join(dir, 'b.yaml')), createGraphRuntimeConfig())
  }
  const load = (): Promise<Graph> => loadGraph({ graphPath: graphDir })
  const readEdges = () => fs.readFileSync(path.join(graphDir, 'edges', 'corum.edges.yaml'), 'utf-8')
  return { dir, graphDir, importA, importB, load, readEdges, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

const explicit = (g: Graph) => [...g.edgesByFrom.values()].flat().filter(e => e.from === FROM)

describe('pending edges', () => {
  it('warns on import and keeps the edge pending with the reference as written', async () => {
    const t = await setup()
    try {
      const result = await t.importA([{ type: 'derived-from', from: FROM, to: 'clr:Orders.Contracts.Missing#f' }])
      const warning = result.diagnostics.find(d => d.severity === 'warning' && d.message.includes('clr:Orders.Contracts.Missing#f'))
      assert.ok(warning, result.diagnostics.map(d => d.message).join('\n'))
      const g = await t.load()
      const edges = explicit(g)
      assert.equal(edges.length, 1)
      assert.deepEqual(edges[0].pending, { to: 'clr:Orders.Contracts.Missing#f' })
      assert.ok(g.diagnostics.some(d => d.message.includes('edge pending resolution')))
      assert.ok(!g.diagnostics.some(d => d.message.includes('unresolved node')))
    } finally {
      t.cleanup()
    }
  })

  it('names the ID map rule and the ID it produced', async () => {
    const t = await setup()
    try {
      const result = await t.importA([{ type: 'derived-from', from: FROM, to: 'clr:Orders.Contracts.Missing' }])
      const warning = result.diagnostics.find(d => d.message.includes('does not resolve'))
      assert.ok(warning?.message.includes('orders.DomainModel.missing'), warning?.message)
      assert.ok(warning?.message.includes('rule'), warning?.message)
    } finally {
      t.cleanup()
    }
  })

  it('leaves pending edges untouched when nothing changes', async () => {
    const t = await setup()
    try {
      const edges = [{ type: 'derived-from', from: FROM, to: 'clr:Orders.Contracts.Missing' }]
      await t.importA(edges)
      const first = t.readEdges()
      await t.importA(edges)
      assert.equal(t.readEdges(), first)
    } finally {
      t.cleanup()
    }
  })

  it('resolves through an ID map rule on a later import, without re-importing the source', async () => {
    const t = await setup()
    try {
      await t.importA([{ type: 'derived-from', from: FROM, to: 'clr:Orders.Contracts.Later' }])
      await t.importB({ 'orders.DomainModel.later': { type: 'DomainModel', title: 'Later' } })
      const g = await t.load()
      const edges = explicit(g)
      assert.equal(edges.length, 1, edges.map(e => e.id).join('\n'))
      assert.equal(edges[0].to, 'orders.DomainModel.later')
      assert.equal(edges[0].pending, undefined)
      assert.equal(edges[0].state === 'removed', false)
      assert.ok(!/^\s+pending:/m.test(t.readEdges()))
    } finally {
      t.cleanup()
    }
  })

  it('resolves through a declared ID persisted on the node by an earlier import', async () => {
    const t = await setup()
    try {
      await t.importA([{ type: 'derived-from', from: FROM, to: 'clr:Other.Thing#x' }])
      await t.importB({ 'orders.DomainModel.thing': { type: 'DomainModel', title: 'Thing', ids: ['clr:Other.Thing#x'] } })
      let g = await t.load()
      assert.equal(explicit(g)[0].to, 'orders.DomainModel.thing')
      assert.deepEqual(g.nodesById.get('orders.DomainModel.thing')?.corum?.identity?.sourceIds, ['clr:Other.Thing#x'])

      // Persisted IDs resolve a reference from a later run that does not include the declaring file.
      await t.importA([
        { type: 'derived-from', from: FROM, to: 'clr:Other.Thing#x' },
        { type: 'reads', from: FROM, to: 'clr:Other.Thing#x' },
      ])
      g = await t.load()
      const edges = explicit(g).filter(e => e.state !== 'removed')
      assert.ok(edges.every(e => e.pending === undefined && e.to === 'orders.DomainModel.thing'), edges.map(e => e.id).join('\n'))
    } finally {
      t.cleanup()
    }
  })

  it('resolves a plain Corum node ID endpoint once the node exists', async () => {
    const t = await setup()
    try {
      await t.importA([{ type: 'derived-from', from: FROM, to: 'orders.DomainModel.plain' }])
      assert.deepEqual(explicit(await t.load())[0].pending, { to: 'orders.DomainModel.plain' })
      await t.importB({ 'orders.DomainModel.plain': { type: 'DomainModel', title: 'Plain' } })
      const edges = explicit(await t.load())
      assert.equal(edges.length, 1)
      assert.equal(edges[0].pending, undefined)
    } finally {
      t.cleanup()
    }
  })

  it('re-importing the source after resolution leaves one edge', async () => {
    const t = await setup()
    try {
      const edges = [{ type: 'derived-from', from: FROM, to: 'clr:Orders.Contracts.Later' }]
      await t.importA(edges)
      await t.importB({ 'orders.DomainModel.later': { type: 'DomainModel', title: 'Later' } })
      const before = t.readEdges()
      await t.importA(edges)
      assert.equal(t.readEdges(), before)
      assert.equal(explicit(await t.load()).length, 1)
    } finally {
      t.cleanup()
    }
  })

  it('keeps the existing edge when a pending edge resolves onto one that already exists', async () => {
    const t = await setup()
    try {
      await t.importA([
        { type: 'derived-from', from: FROM, to: 'clr:Orders.Contracts.Later' },
        { type: 'derived-from', from: FROM, to: 'orders.DomainModel.later' },
      ])
      const result = await t.importB({ 'orders.DomainModel.later': { type: 'DomainModel', title: 'Later' } })
      assert.ok(result.diagnostics.some(d => d.message.includes('already exists')), result.diagnostics.map(d => d.message).join('\n'))
      assert.equal(explicit(await t.load()).length, 1)
    } finally {
      t.cleanup()
    }
  })
})
