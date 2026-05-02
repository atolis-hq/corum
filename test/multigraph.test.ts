import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as git from 'isomorphic-git'
import { computeDiff, computeOverlay } from '../src/graph/overlay.js'
import { loadMultiGraph } from '../src/loader/index.js'
import { QueryError } from '../src/schema/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { GitGraphSource } from '../src/source/git-source.js'
import type { ContentMap, GraphSource } from '../src/source/index.js'
import type { BranchGraph, Edge, GhostState, MultiGraph, Node, OverlayNode } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('schema types (compile check)', () => {
  it('GhostState covers all expected values', () => {
    const states: GhostState[] = [
      'local', 'local-modified', 'shared',
      'default-only', 'ghost-single', 'ghost-consensus', 'ghost-conflict',
    ]
    assert.equal(states.length, 7)
  })
})

describe('computeOverlay', () => {
  const defaultBranch = branch('main', true, [
    node('shared'),
    node('default-only'),
    node('modified', { version: 1 }),
    node('consensus'),
    node('conflict', { source: 'main' }),
  ])
  const featureBranch = branch('feat/current', false, [
    node('shared'),
    node('local'),
    node('modified', { version: 2 }),
  ])
  const otherBranch = branch('feat/other', false, [
    node('shared'),
    node('single'),
    node('consensus'),
    node('conflict', { source: 'other' }),
  ])
  const thirdBranch = branch('feat/third', false, [
    node('shared'),
    node('consensus'),
    node('conflict', { source: 'third' }),
  ])

  it('classifies local nodes on the viewing branch only', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.equal(overlay.nodes.get('local')?.ghostState, 'local')
  })

  it('classifies default-only nodes when only default has them', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.equal(overlay.nodes.get('default-only')?.ghostState, 'default-only')
  })

  it('classifies shared nodes when all presences match the viewing branch', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.equal(overlay.nodes.get('shared')?.ghostState, 'shared')
  })

  it('classifies local-modified nodes when another presence differs', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.equal(overlay.nodes.get('modified')?.ghostState, 'local-modified')
  })

  it('classifies ghost-single nodes when one non-default branch has them and default does not', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.equal(overlay.nodes.get('single')?.ghostState, 'ghost-single')
  })

  it('classifies ghost-consensus nodes when multiple other branches match', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.equal(overlay.nodes.get('consensus')?.ghostState, 'ghost-consensus')
  })

  it('classifies ghost-conflict nodes when multiple other branches differ', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.equal(overlay.nodes.get('conflict')?.ghostState, 'ghost-conflict')
  })

  it('classifies ghost-conflict when only default and one non-default branch disagree', () => {
    // Minimal case: default has x{v:1}, feat/a has x{v:2}, viewing branch has neither
    const def = branch('main', true, [node('x', { v: 1 })])
    const featA = branch('feat/a', false, [node('x', { v: 2 })])
    const viewing = branch('feat/view', false, [])
    const overlay = computeOverlay('feat/view', def, [def, featA, viewing])
    assert.equal(overlay.nodes.get('x')?.ghostState, 'ghost-conflict')
  })

  it('records a presence map for every branch containing the node', () => {
    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch, otherBranch, thirdBranch])
    assert.deepEqual([...overlay.nodes.get('shared')!.presence.keys()], ['main', 'feat/current', 'feat/other', 'feat/third'])
  })

  it('uses edge equality when classifying overlay edges', () => {
    const defaultWithEdge = branch('main', true, [node('a'), node('b')], [edge('a__calls__b', 'a', 'b', 'calls')])
    const viewingWithEdge = branch('feat/current', false, [node('a'), node('b')], [edge('a__calls__b', 'a', 'b', 'calls')])
    const otherWithEdge = branch('feat/other', false, [node('a'), node('b')], [edge('a__calls__b', 'a', 'b', 'calls', 'changed')])

    const overlay = computeOverlay('feat/current', defaultWithEdge, [defaultWithEdge, viewingWithEdge, otherWithEdge])
    assert.equal(overlay.edges.get('a__calls__b')?.ghostState, 'local-modified')
  })

  it('classifies nodes with reordered object properties as shared', () => {
    const defaultBranch = branch('main', true, [
      node('ordered', { config: { a: 1, b: 2 } }),
    ])
    const featureBranch = branch('feat/current', false, [
      node('ordered', { config: { b: 2, a: 1 } }),
    ])

    const overlay = computeOverlay('feat/current', defaultBranch, [defaultBranch, featureBranch])

    assert.equal(overlay.nodes.get('ordered')?.ghostState, 'shared')
  })

  it('throws QueryError for an unknown viewing ref', () => {
    assert.throws(
      () => computeOverlay('feat/missing', defaultBranch, [defaultBranch, featureBranch]),
      (err: unknown) => err instanceof QueryError,
    )
  })
})

describe('computeDiff', () => {
  it('reports added, removed, and modified nodes against default', () => {
    const defaultBranch = branch('main', true, [
      node('kept'),
      node('removed'),
      node('changed', { version: 1 }),
    ])
    const featureBranch = branch('feat/current', false, [
      node('kept'),
      node('added'),
      node('changed', { version: 2 }),
    ])

    const diff = computeDiff(featureBranch, defaultBranch)
    assert.deepEqual(diff.added.map(n => n.id), ['added'])
    assert.deepEqual(diff.removed.map(n => n.id), ['removed'])
    assert.deepEqual(diff.modified.map(n => n.id), ['changed'])
  })

  it('does not report nodes with reordered object properties as modified', () => {
    const defaultBranch = branch('main', true, [
      node('ordered', { config: { a: 1, b: 2 } }),
    ])
    const featureBranch = branch('feat/current', false, [
      node('ordered', { config: { b: 2, a: 1 } }),
    ])

    const diff = computeDiff(featureBranch, defaultBranch)

    assert.deepEqual(diff.modified.map(n => n.id), [])
  })
})

describe('loadMultiGraph', () => {
  it('loads one branch from FileGraphSource and records it as loaded', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    assert.equal(multi.branches.length, 1)
    assert.equal(multi.branchResults.length, 1)
    assert.equal(multi.branchResults[0].status, 'loaded')
  })

  it('overlay on FileGraphSource default has all nodes local', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    const overlay = multi.overlay(await source.defaultBranch())
    assert.deepEqual(new Set([...overlay.nodes.values()].map(n => n.ghostState)), new Set(['local']))
  })

  it('diff on FileGraphSource default is empty', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    const diff = multi.diff(await source.defaultBranch())
    assert.equal(diff.added.length, 0)
    assert.equal(diff.removed.length, 0)
    assert.equal(diff.modified.length, 0)
  })

  it('overlay and diff throw QueryError for an unknown ref', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    assert.throws(() => multi.overlay('feat/missing'), (err: unknown) => err instanceof QueryError)
    assert.throws(() => multi.diff('feat/missing'), (err: unknown) => err instanceof QueryError)
  })

  it('records failed non-default branch loads without throwing', async () => {
    const source = new FailingBranchSource()

    const multi = await loadMultiGraph({ source })

    assert.deepEqual(multi.branches.map(b => b.ref), ['main', 'feat/loaded'])
    assert.deepEqual(multi.branchResults, [
      { ref: 'main', status: 'loaded' },
      { ref: 'feat/loaded', status: 'loaded' },
      { ref: 'feat/fails', status: 'failed', error: 'boom' },
    ])
  })

  it('loads GitGraphSource branches and overlays local and shared nodes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-multi-'))
    try {
      await createMultiBranchRepo(tmpDir)

      const multi = await loadMultiGraph({ source: new GitGraphSource({ localPath: tmpDir }), strict: false })
      assert.deepEqual(multi.branches.map(b => b.ref), ['main', 'feat/add-payment'])
      assert.ok(multi.branchResults.every(r => r.status === 'loaded'))

      const overlay = multi.overlay('feat/add-payment')
      assert.equal(overlay.nodes.get('orders.DomainModel.payment')?.ghostState, 'local')
      assert.equal(overlay.nodes.get('orders.DomainModel.order')?.ghostState, 'shared')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

function node(id: string, properties: Record<string, unknown> = {}): Node {
  return {
    id,
    template: 'DomainModel',
    component: 'test',
    state: 'proposed',
    stability: 'unstable',
    schemaVersion: '1.0',
    lastModifiedAt: '2026-01-01',
    properties,
  }
}

function edge(id: string, from: string, to: string, type: Edge['type'], notes?: string): Edge {
  return {
    id,
    from,
    to,
    type,
    state: 'proposed',
    stability: 'unstable',
    notes,
  }
}

function branch(ref: string, isDefault: boolean, nodes: Node[], edges: Edge[] = []): BranchGraph {
  const edgesByFrom = new Map<string, Edge[]>()
  const edgesByTo = new Map<string, Edge[]>()
  for (const item of edges) {
    edgesByFrom.set(item.from, [...(edgesByFrom.get(item.from) ?? []), item])
    edgesByTo.set(item.to, [...(edgesByTo.get(item.to) ?? []), item])
  }
  return {
    ref,
    isDefault,
    graph: {
      nodesById: new Map(nodes.map(item => [item.id, item])),
      edgesByFrom,
      edgesByTo,
      templates: new Map(),
      diagnostics: [],
    },
  }
}

async function createMultiBranchRepo(tmpDir: string): Promise<void> {
  await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
  const graphDir = path.join(tmpDir, '.corum', 'graph')
  const componentsDir = path.join(graphDir, 'components', 'orders')
  fs.mkdirSync(componentsDir, { recursive: true })
  fs.writeFileSync(path.join(graphDir, 'graph.yaml'), 'templatePacks: []\n')
  fs.writeFileSync(path.join(componentsDir, 'order.yaml'), clusterYaml('orders.DomainModel.order', 'agreed', 'stable'))

  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/graph.yaml' })
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/order.yaml' })
  await git.commit({ fs, dir: tmpDir, message: 'initial', author: { name: 'Test', email: 'test@test.com' } })

  await git.branch({ fs, dir: tmpDir, ref: 'feat/add-payment', checkout: true })
  fs.writeFileSync(path.join(componentsDir, 'payment.yaml'), clusterYaml('orders.DomainModel.payment', 'proposed', 'unstable'))
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/payment.yaml' })
  await git.commit({ fs, dir: tmpDir, message: 'add payment', author: { name: 'Test', email: 'test@test.com' } })
  await git.checkout({ fs, dir: tmpDir, ref: 'main' })
}

function clusterYaml(id: string, state: string, stability: string): string {
  return `id: ${id}
template: DomainModel
schemaVersion: "1.0"
metadata:
  component: orders
  state: ${state}
  stability: ${stability}
  lastModifiedAt: "2026-01-01"
`
}

class FailingBranchSource implements GraphSource {
  async defaultBranch(): Promise<string> {
    return 'main'
  }

  async listBranches(): Promise<string[]> {
    return ['main', 'feat/loaded', 'feat/fails']
  }

  async loadPackContent(): Promise<ContentMap> {
    return new Map([
      ['graph.yaml', 'templatePacks: []\n'],
      ['packs/test/templates/domain-model.yaml', `name: DomainModel
info:
  version: "1.0"
`],
    ])
  }

  async loadGraphContent(ref: string): Promise<ContentMap> {
    if (ref === 'feat/fails') throw new Error('boom')
    return new Map([
      ['graph.yaml', 'templatePacks: []\n'],
      ['components/orders/order.yaml', clusterYaml(`orders.DomainModel.${ref.replaceAll('/', '-')}`, 'agreed', 'stable')],
    ])
  }

  async commit(): Promise<void> {
    throw new Error('not implemented')
  }
}
