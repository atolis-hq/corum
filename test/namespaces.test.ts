import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { loadGraph } from '../src/loader/index.js'
import { loadNamespaces } from '../src/loader/namespace-loader.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { GitGraphSource } from '../src/source/git-source.js'
import { serializeGraph, saveGraph } from '../src/writer/graph-writer.js'
import { startSession, discardSession } from '../src/mutate/index.js'
import { runImport } from '../src/import/runner.js'
import type { Diagnostic } from '../src/schema/index.js'

const key = 'nodes/orders/namespace.yaml'
const declaration = '# Keep this comment and key order\ndescription: "Order journey"\nkind: journey\n'
const cluster = `id: orders.Schema.customer
template: Schema
schemaVersion: '1'
metadata:
  component: deliberately-different
  state: proposed
  stability: unstable
  lastModifiedAt: '2026-01-01'
`

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-namespaces-'))
  const files = {
    'graph.yaml': 'templatePacks:\n  - path: packs/core\n',
    'packs/core/templates/Schema.yaml': "name: Schema\ninfo:\n  version: '1'\n",
    'nodes/orders/Schemas/customer.yaml': cluster,
  }
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  const source = new FileGraphSource({ graphDir: dir, defaultBranch: 'main' })
  return { dir, source, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('namespace metadata', () => {
  it('defaults from ID segments without diagnostics or metadata nodes', async () => {
    const f = fixture()
    try {
      const graph = await loadGraph({ source: f.source })
      assert.deepEqual([...graph.namespaces!], [['orders', { kind: 'component' }]])
      assert.deepEqual(graph.diagnostics, [])
      assert.equal(graph.nodesById.size, 1)
    } finally { f.cleanup() }
  })

  it('loads descriptions and preserves declarations byte-for-byte through save/reload', async () => {
    const f = fixture()
    try {
      fs.writeFileSync(path.join(f.dir, key), declaration)
      const graph = await loadGraph({ source: f.source })
      assert.deepEqual(graph.namespaces!.get('orders'), { kind: 'journey', description: 'Order journey' })
      assert.equal(graph.nodesById.size, 1)
      assert.equal(graph.diagnostics.length, 1)
      assert.match(graph.diagnostics[0].message, /unrecognised kind, falling back to generic display/)
      await saveGraph(graph, { sourceGraphPath: f.dir, outputGraphPath: f.dir })
      assert.equal(fs.readFileSync(path.join(f.dir, key), 'utf8'), declaration)
      assert.deepEqual((await loadGraph({ source: f.source })).namespaces, graph.namespaces)
    } finally { f.cleanup() }
  })

  it('collects malformed declaration errors while loading other nodes', async () => {
    for (const text of ['kind: [', 'kind: 42', 'kind: component\nextra: true', 'kind: component\ndescription: []', 'null', '[]', 'description: missing kind', 'kind: a\nkind: b']) {
      const f = fixture()
      try {
        fs.writeFileSync(path.join(f.dir, key), text)
        const graph = await loadGraph({ source: f.source, strict: false })
        assert.equal(graph.nodesById.size, 1)
        assert.equal(graph.diagnostics.filter(d => d.severity === 'error').length, 1)
        assert.equal(graph.diagnostics[0].file, key)
        await assert.rejects(loadGraph({ source: f.source }), /Graph load failed/)
      } finally { f.cleanup() }
    }
  })

  it('lists empty declared namespaces with a warning', () => {
    const diagnostics: Diagnostic[] = []
    const namespaces = loadNamespaces(new Map([['nodes/empty/namespace.yaml', 'kind: component']]), new Map(), diagnostics)
    assert.deepEqual(namespaces.get('empty'), { kind: 'component' })
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0].message, /no nodes/)
  })

  it('retains declarations through apply_cluster, rename, hard delete, and import', async () => {
    const f = fixture()
    try {
      fs.writeFileSync(path.join(f.dir, key), declaration)
      const session = await startSession(f.source, { autosave: true })
      await session.applyCluster({ id: 'orders.Schema.customer', metadata: { state: 'agreed' } }, 'merge')
      assert.equal(fs.readFileSync(path.join(f.dir, key), 'utf8'), declaration)
      await session.renameNode('orders.Schema.customer', 'client', false)
      assert.equal(fs.readFileSync(path.join(f.dir, key), 'utf8'), declaration)
      await session.deleteNode('orders.Schema.client', { purge: true })
      assert.equal(fs.readFileSync(path.join(f.dir, key), 'utf8'), declaration)
      await runImport({ imports: [] }, { source: f.source, kind: 'filesystem', graphPath: f.dir })
      assert.equal(fs.readFileSync(path.join(f.dir, key), 'utf8'), declaration)
      assert.equal((await loadGraph({ source: f.source })).namespaces!.get('orders')!.kind, 'journey')
    } finally { discardSession(); f.cleanup() }
  })

  it('loads and retains declarations in git-backed replacement writes', async () => {
    const f = fixture()
    try {
      fs.writeFileSync(path.join(f.dir, key), declaration)
      const entries = fs.readdirSync(f.dir)
      fs.mkdirSync(path.join(f.dir, 'graph'))
      for (const entry of entries) fs.renameSync(path.join(f.dir, entry), path.join(f.dir, 'graph', entry))
      await git.init({ fs, dir: f.dir, defaultBranch: 'main' })
      await git.add({ fs, dir: f.dir, filepath: '.' })
      const oid = await git.commit({ fs, dir: f.dir, message: 'fixture', author: { name: 'Test', email: 'test@example.com' } })
      await git.writeRef({ fs, dir: f.dir, ref: 'refs/heads/design', value: oid })
      const source = new GitGraphSource({ localPath: f.dir, graphDir: 'graph', defaultBranch: 'main' })
      const graph = await loadGraph({ source, ref: 'design' })
      assert.equal(graph.namespaces!.get('orders')!.kind, 'journey')
      await source.commit('design', serializeGraph(graph), 'save', { replaceGraphContent: true })
      const reloaded = await loadGraph({ source, ref: 'design' })
      assert.deepEqual(reloaded.namespaces, graph.namespaces)
      assert.equal(reloaded.sourceContent!.get(key), declaration)
    } finally { f.cleanup() }
  })
})
