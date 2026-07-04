import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { loadGraph } from '../src/loader/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { GitGraphSource } from '../src/source/git-source.js'
import type { GraphSource } from '../src/source/index.js'
import {
  MutationError,
  discardSession,
  getActiveSession,
  startSession,
} from '../src/mutate/index.js'
import { insertEdgeIntoIndexes } from '../src/mutate/util.js'
import type { Edge } from '../src/schema/index.js'

// -- fixture content ---------------------------------------------------------

const SCHEMA_TEMPLATE = `name: Schema
info:
  version: '1.0.0'
  role: type-container
properties:
  type: object
  additionalProperties: false
  properties:
    description:
      type: string
fields:
  item-template: Field
edge-types:
  outgoing:
    - has-field
    - uses-type
  incoming:
    - uses-type
`

const FIELD_TEMPLATE = `name: Field
info:
  version: '1.0.0'
  role: field
properties:
  type: object
  additionalProperties: false
  properties:
    type:
      type: string
    nullable:
      type: boolean
edge-types:
  incoming:
    - has-field
  supports:
    - maps-to
    - derived-from
`

const CUSTOMER_CLUSTER = `id: orders.Schema.customer
template: Schema
schemaVersion: '1.0'
metadata:
  component: orders
  state: agreed
  stability: stable
  lastModifiedAt: '2026-07-01'
properties:
  description: 'Customer contact'
fields:
  email:
    type: string
    nullable: false
`

const INVOICE_CLUSTER = `id: orders.Schema.invoice
template: Schema
schemaVersion: '1.0'
metadata:
  component: orders
  state: proposed
  stability: unstable
  lastModifiedAt: '2026-07-01'
properties:
  description: 'Invoice'
`

function graphYaml(packPath: string): string {
  return `schemaVersion: '1'\ntemplatePacks:\n  - name: testpack\n    path: ${packPath}\n`
}

function packFiles(base: string): Record<string, string> {
  return {
    [`${base}/templates/Schema.yaml`]: SCHEMA_TEMPLATE,
    [`${base}/templates/Field.yaml`]: FIELD_TEMPLATE,
  }
}

function graphFiles(base: string, packPath: string): Record<string, string> {
  return {
    [`${base}/graph.yaml`]: graphYaml(packPath),
    [`${base}/components/orders/Schemas/customer.yaml`]: CUSTOMER_CLUSTER,
    [`${base}/components/orders/Schemas/invoice.yaml`]: INVOICE_CLUSTER,
  }
}

function writeFiles(root: string, files: Record<string, string>): string[] {
  const written: string[] = []
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    written.push(rel)
  }
  return written
}

const cleanups: Array<() => void> = []

function makeFileFixture(): { source: FileGraphSource; graphDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-session-file-'))
  cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  writeFiles(tmpDir, { ...packFiles('packs/testpack'), ...graphFiles('graph', '../packs/testpack') })
  const graphDir = path.join(tmpDir, 'graph')
  return { source: new FileGraphSource({ graphDir, defaultBranch: 'local' }), graphDir }
}

async function makeGitFixture(branches: string[] = []): Promise<{ source: GitGraphSource; repoDir: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-session-git-'))
  cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
  const files = writeFiles(tmpDir, {
    ...packFiles('.corum/packs/testpack'),
    ...graphFiles('.corum/graph', '../packs/testpack'),
  })
  for (const rel of files) {
    await git.add({ fs, dir: tmpDir, filepath: rel })
  }
  await git.commit({ fs, dir: tmpDir, message: 'initial', author: { name: 'Test', email: 'test@test.com' } })
  for (const branch of branches) {
    await git.branch({ fs, dir: tmpDir, ref: branch, checkout: false })
  }
  return { source: new GitGraphSource({ localPath: tmpDir }), repoDir: tmpDir }
}

after(() => {
  for (const cleanup of cleanups) cleanup()
})

beforeEach(() => {
  discardSession()
})

const CUSTOMER = 'orders.Schema.customer'
const INVOICE = 'orders.Schema.invoice'
const EMAIL = `${CUSTOMER}.fields.email`

// -- file-source sessions -----------------------------------------------------

describe('working session (file source)', () => {
  it('defaults autosave OFF and keeps mutations in memory until commitChanges', async () => {
    const { source, graphDir } = makeFileFixture()
    const session = await startSession(source)
    assert.equal(session.autosave, false)
    assert.equal(session.branch, 'local')

    const result = await session.renameNode(CUSTOMER, 'client')
    assert.equal(result.newId, 'orders.Schema.client')
    assert.equal(result.recordedTrail, true, 'committed file graph is the default branch — threshold met')

    assert.ok(!fs.existsSync(path.join(graphDir, 'components/orders/Schemas/client.yaml')))
    assert.ok(fs.existsSync(path.join(graphDir, 'components/orders/Schemas/customer.yaml')))

    const commit = await session.commitChanges('rename customer to client')
    assert.equal(commit.committed, true)
    assert.equal(commit.message, 'rename customer to client')
    assert.equal(getActiveSession(), null, 'commit closes the session')

    const reloaded = await loadGraph({ source, strict: false })
    const client = reloaded.nodesById.get('orders.Schema.client')
    assert.ok(client)
    assert.deepEqual(client.corum?.identity?.previousIds, [CUSTOMER])
    assert.ok(reloaded.nodesById.has('orders.Schema.client.fields.email'), 'descendants renamed with the root')
  })

  it('autosave ON writes every mutation through to disk', async () => {
    const { source, graphDir } = makeFileFixture()
    const session = await startSession(source, { autosave: true })
    assert.equal(session.autosave, true)

    const result = await session.renameNode(CUSTOMER, 'client')
    assert.equal(result.newId, 'orders.Schema.client')
    assert.equal(result.recordedTrail, true, 'committed file graph is the default branch — threshold met')

    assert.ok(fs.existsSync(path.join(graphDir, 'components/orders/Schemas/client.yaml')))
    assert.ok(!fs.existsSync(path.join(graphDir, 'components/orders/Schemas/customer.yaml')))

    const commit = await session.commitChanges()
    assert.equal(commit.committed, true)
    assert.match(commit.note ?? '', /write-through/)

    const reloaded = await loadGraph({ source, strict: false })
    const client = reloaded.nodesById.get('orders.Schema.client')
    assert.ok(client)
    assert.deepEqual(client.corum?.identity?.previousIds, [CUSTOMER])
    assert.ok(reloaded.nodesById.has('orders.Schema.client.fields.email'), 'descendants renamed with the root')
  })

  it('rejects create: file sources have a single branch', async () => {
    const { source } = makeFileFixture()
    await assert.rejects(
      () => startSession(source, { branch: 'feat/x', create: true }),
      (err: unknown) => err instanceof MutationError && /single branch/.test(err.message),
    )
  })

  it('detects a moved head at commit (no autosave)', async () => {
    const { source, graphDir } = makeFileFixture()
    const session = await startSession(source, { autosave: false })
    await session.updateNode(INVOICE, { properties: { description: 'Invoices' } })

    // External edit lands while the session is open.
    fs.appendFileSync(path.join(graphDir, 'components/orders/Schemas/customer.yaml'), '# external edit\n')

    await assert.rejects(
      () => session.commitChanges(),
      (err: unknown) => err instanceof MutationError && /head moved/.test(err.message),
    )
    assert.ok(session.hasPendingChanges(), 'session stays open for discard/replay')
  })

  it('captures the trail threshold set at session start: in-session nodes rename without a trail', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })

    await session.createNode({
      document: {
        id: 'orders.Schema.draft',
        template: 'Schema',
        properties: { description: 'Draft' },
      },
    })
    const rename = await session.renameNode('orders.Schema.draft', 'sketch')
    assert.equal(rename.recordedTrail, false, 'node not on the default branch head at session start')
    const sketch = session.graph.nodesById.get('orders.Schema.sketch')
    assert.ok(sketch)
    assert.equal(sketch.corum?.identity?.previousIds, undefined)

    const rename2 = await session.renameNode(INVOICE, 'bill')
    assert.equal(rename2.recordedTrail, true, 'default-branch node records a trail')
  })

  it('createNode materialises a root cluster with nested owned children and structural edges', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })

    const result = await session.createNode({
      document: {
        id: 'orders.Schema.receipt',
        template: 'Schema',
        properties: { description: 'Receipt' },
        fields: {
          total: { type: 'string', nullable: false },
        },
      },
    })
    assert.deepEqual(result.createdIds.sort(), ['orders.Schema.receipt', 'orders.Schema.receipt.fields.total'])
    assert.equal(session.graph.nodesById.get('orders.Schema.receipt')?.state, 'proposed', 'state defaults applied')
    assert.ok(
      (session.graph.edgesByFrom.get('orders.Schema.receipt') ?? []).some(e => e.type === 'has-field'),
      'structural has-field edge generated',
    )
  })

  it('createNode creates an owned child under an existing parent', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })

    const result = await session.createNode({
      parentId: CUSTOMER,
      section: 'fields',
      name: 'age',
      document: { type: 'integer', nullable: true },
    })
    assert.deepEqual(result.createdIds, [`${CUSTOMER}.fields.age`])
    const node = session.graph.nodesById.get(`${CUSTOMER}.fields.age`)
    assert.ok(node)
    assert.equal(node.parentId, CUSTOMER)
    assert.equal(node.template, 'Field')
    assert.ok(
      (session.graph.edgesByFrom.get(CUSTOMER) ?? []).some(e => e.type === 'has-field' && e.to === node.id),
      'structural edge from parent generated',
    )
  })

  it('createNode validation failures leave the working graph untouched', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })
    const nodeCount = session.graph.nodesById.size

    await assert.rejects(
      () => session.createNode({ document: { id: CUSTOMER, template: 'Schema' } }),
      (err: unknown) => err instanceof MutationError && /already exists/.test(err.message),
    )
    await assert.rejects(
      () => session.createNode({ parentId: CUSTOMER, section: 'nope', name: 'x', document: {} }),
      (err: unknown) => err instanceof MutationError && /does not own/.test(err.message),
    )
    assert.equal(session.graph.nodesById.size, nodeCount)
    assert.equal(session.journal.length, 0)
  })

  it('createEdge validates endpoints, type, and duplicates; constraint violations are warnings', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })

    const created = await session.createEdge({ from: INVOICE, to: CUSTOMER, type: 'uses-type' })
    assert.equal(created.edge.state, 'proposed')
    assert.equal(created.edge.stability, 'unstable')

    await assert.rejects(
      () => session.createEdge({ from: INVOICE, to: CUSTOMER, type: 'uses-type' }),
      (err: unknown) => err instanceof MutationError && /already exists/.test(err.message),
    )
    await assert.rejects(
      () => session.createEdge({ from: 'orders.Schema.ghost', to: CUSTOMER, type: 'uses-type' }),
      (err: unknown) => err instanceof MutationError && /'from' node not found/.test(err.message),
    )
    await assert.rejects(
      () => session.createEdge({ from: INVOICE, to: CUSTOMER, type: 'not-a-type' }),
      (err: unknown) => err instanceof MutationError && /unknown edge type/.test(err.message),
    )

    // maps-to is supported by Field but not declared on Schema — warning, not error.
    const warned = await session.createEdge({ from: INVOICE, to: EMAIL, type: 'maps-to' })
    assert.ok(warned.warnings.some(w => /not declared/.test(w.message)))
  })

  it('updateNode patches properties (null clears) and state; updateEdge patches without touching endpoints', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })

    await session.updateNode(INVOICE, { properties: { description: 'All invoices' }, state: 'agreed' })
    let invoice = session.graph.nodesById.get(INVOICE)!
    assert.equal(invoice.properties.description, 'All invoices')
    assert.equal(invoice.state, 'agreed')

    await session.updateNode(INVOICE, { properties: { description: null } })
    invoice = session.graph.nodesById.get(INVOICE)!
    assert.equal(invoice.properties.description, undefined)

    await assert.rejects(
      () => session.updateNode(INVOICE, { state: 'bogus' as never }),
      (err: unknown) => err instanceof MutationError && /invalid state/.test(err.message),
    )
    await assert.rejects(
      () => session.updateNode('orders.Schema.ghost', { state: 'agreed' }),
      (err: unknown) => err instanceof MutationError,
    )

    const { edge } = await session.createEdge({ from: INVOICE, to: CUSTOMER, type: 'uses-type', notes: 'draft link' })
    const updated = await session.updateEdge(edge.id, { state: 'agreed', notes: null, properties: { via: 'body' } })
    assert.equal(updated.edge.state, 'agreed')
    assert.equal(updated.edge.notes, undefined)
    assert.deepEqual(updated.edge.properties, { via: 'body' })
    assert.equal(updated.edge.from, INVOICE, 'endpoints immutable')

    await assert.rejects(
      () => session.updateEdge('nope__uses-type__nada', { state: 'agreed' }),
      (err: unknown) => err instanceof MutationError && /edge not found/.test(err.message),
    )
  })

  it('deleteNode soft-deletes materialised nodes and purges on request; deleteEdge is hard', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })

    const soft = await session.deleteNode(CUSTOMER)
    assert.equal(soft.tier, 'soft')
    assert.equal(session.graph.nodesById.get(CUSTOMER)?.state, 'removed')
    assert.equal(session.graph.nodesById.get(EMAIL)?.state, 'removed')

    const hard = await session.deleteNode(CUSTOMER, { purge: true })
    assert.equal(hard.tier, 'hard')
    assert.ok(!session.graph.nodesById.has(CUSTOMER))
    assert.ok(!session.graph.nodesById.has(EMAIL))

    const { edge } = await session.createEdge({ from: INVOICE, to: INVOICE, type: 'uses-type' })
    await session.deleteEdge(edge.id)
    assert.ok(!(session.graph.edgesByFrom.get(INVOICE) ?? []).some(e => e.id === edge.id))
  })

  it('commitChanges is blocked by error-severity lint diagnostics and keeps the session open', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })
    await session.updateNode(INVOICE, { properties: { description: 'x' } })

    // Manufacture the one error-severity lint rule: a hidden (renamed-from)
    // edge whose live end does not resolve.
    const badEdge: Edge = {
      id: 'orders.Schema.ghost__renamed-from__orders.Schema.older',
      from: 'orders.Schema.ghost',
      to: 'orders.Schema.older',
      type: 'renamed-from',
      state: 'proposed',
      stability: 'unstable',
    }
    insertEdgeIntoIndexes(session.graph, badEdge)

    await assert.rejects(
      () => session.commitChanges(),
      (err: unknown) => err instanceof MutationError && /live 'from' node/.test(err.message),
    )
    assert.ok(session.hasPendingChanges(), 'session stays open after a blocked commit')
    assert.equal(getActiveSession(), session)
  })

  it('enforces one session per process: pending changes block, clean sessions reset', async () => {
    const { source } = makeFileFixture()
    const first = await startSession(source, { autosave: false })
    assert.equal(getActiveSession(), first)

    // No pending changes: starting again resets cleanly.
    const second = await startSession(source, { autosave: false })
    assert.notEqual(second, first)
    assert.ok(first.isClosed())

    await second.updateNode(INVOICE, { properties: { description: 'y' } })
    await assert.rejects(
      () => startSession(source, { autosave: false }),
      (err: unknown) => err instanceof MutationError && /pending changes/.test(err.message),
    )

    second.discard()
    assert.equal(getActiveSession(), null)
    const third = await startSession(source, { autosave: false })
    assert.equal(getActiveSession(), third)
  })

  it('operations on a closed session throw', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })
    session.discard()
    await assert.rejects(
      () => session.updateNode(INVOICE, { state: 'agreed' }),
      (err: unknown) => err instanceof MutationError && /closed/.test(err.message),
    )
  })

  it('commitChanges with an empty journal closes the session without committing', async () => {
    const { source } = makeFileFixture()
    const session = await startSession(source, { autosave: false })
    const result = await session.commitChanges()
    assert.equal(result.committed, false)
    assert.equal(getActiveSession(), null)
  })
})

// -- git sessions --------------------------------------------------------------

describe('working session (local git source)', () => {
  it('fails fast when startSession defaults to the read-only default branch', async () => {
    const { source } = await makeGitFixture()
    await assert.rejects(
      () => startSession(source),
      (err: unknown) => err instanceof MutationError && /default branch/.test(err.message),
    )
  })

  it('defaults autosave OFF, commits once on commitChanges, and round-trips', async () => {
    const { source, repoDir } = await makeGitFixture(['feat/work'])
    const baseSha = await source.head('feat/work')

    const session = await startSession(source, { branch: 'feat/work' })
    assert.equal(session.autosave, false)

    const rename = await session.renameNode(CUSTOMER, 'client')
    assert.equal(rename.recordedTrail, true, 'node exists on the default branch head')
    assert.equal(await source.head('feat/work'), baseSha, 'no WIP commits without autosave')

    const commit = await session.commitChanges('rename customer to client')
    assert.equal(commit.committed, true)
    assert.equal(commit.squashed, false)

    const shas = await source.log('feat/work', baseSha)
    assert.equal(shas.length, 1, 'exactly one commit')
    const { commit: head } = await git.readCommit({ fs, dir: repoDir, oid: shas[0] })
    assert.match(head.message, /rename customer to client/)

    const reloaded = await loadGraph({ source, ref: 'feat/work', strict: false })
    assert.ok(reloaded.nodesById.has('orders.Schema.client'))
    assert.deepEqual(reloaded.nodesById.get('orders.Schema.client')?.corum?.identity?.previousIds, [CUSTOMER])
    assert.ok(!reloaded.nodesById.has(CUSTOMER))

    // Default branch untouched.
    const main = await loadGraph({ source, ref: 'main', strict: false })
    assert.ok(main.nodesById.has(CUSTOMER))
  })

  it('autosave ON lands a corum-wip checkpoint per mutation and squashes at commit when the guard holds', async () => {
    const { source, repoDir } = await makeGitFixture(['feat/wip'])
    const baseSha = await source.head('feat/wip')

    const session = await startSession(source, { branch: 'feat/wip', autosave: true })
    await session.renameNode(CUSTOMER, 'client')
    await session.updateNode(INVOICE, { properties: { description: 'Invoices' } })

    const wips = await source.log('feat/wip', baseSha)
    assert.equal(wips.length, 2, 'one WIP checkpoint per mutation')
    for (const sha of wips) {
      const { commit } = await git.readCommit({ fs, dir: repoDir, oid: sha })
      assert.match(commit.message, /^corum-wip: /)
    }

    const result = await session.commitChanges('one logical change')
    assert.equal(result.squashed, true)

    const after = await source.log('feat/wip', baseSha)
    assert.equal(after.length, 1, 'WIP run squashed into a single commit')
    const { commit: head } = await git.readCommit({ fs, dir: repoDir, oid: after[0] })
    assert.deepEqual(head.parent, [baseSha])
    assert.match(head.message, /one logical change/)

    const reloaded = await loadGraph({ source, ref: 'feat/wip', strict: false })
    assert.ok(reloaded.nodesById.has('orders.Schema.client'))
    assert.equal(reloaded.nodesById.get(INVOICE)?.properties.description, 'Invoices')
  })

  it('does not squash when an external commit interleaved with the WIP run', async () => {
    const { source, repoDir } = await makeGitFixture(['feat/interleave'])
    const baseSha = await source.head('feat/interleave')

    const session = await startSession(source, { branch: 'feat/interleave', autosave: true })
    await session.renameNode(CUSTOMER, 'client')

    // External writer commits directly to the branch between WIPs.
    const external = new GitGraphSource({ localPath: repoDir })
    await external.commit('feat/interleave', new Map([
      ['components/orders/Schemas/external.yaml', INVOICE_CLUSTER.replace(/invoice/g, 'external')],
    ]), 'external edit')
    const externalSha = await external.head('feat/interleave')

    await session.updateNode(INVOICE, { properties: { description: 'Invoices' } })

    const result = await session.commitChanges()
    assert.equal(result.squashed, false)
    assert.match(result.note ?? '', /WIP checkpoints preserved/)

    const shas = await source.log('feat/interleave', baseSha)
    assert.ok(shas.includes(externalSha), 'external commit preserved in history')
    assert.ok(shas.length >= 4, 'WIP checkpoints + external + final all preserved')
  })

  it('fails commit when the head moved externally and no WIPs exist', async () => {
    const { source, repoDir } = await makeGitFixture(['feat/conflict'])
    const session = await startSession(source, { branch: 'feat/conflict' })
    await session.updateNode(INVOICE, { properties: { description: 'mine' } })

    const external = new GitGraphSource({ localPath: repoDir })
    await external.commit('feat/conflict', new Map([
      ['components/orders/Schemas/external.yaml', INVOICE_CLUSTER.replace(/invoice/g, 'external')],
    ]), 'external edit')

    await assert.rejects(
      () => session.commitChanges(),
      (err: unknown) => err instanceof MutationError && /head moved/.test(err.message),
    )
    assert.ok(session.hasPendingChanges())
  })

  it('create: true forks a new branch from the default head at first commit', async () => {
    const { source, repoDir } = await makeGitFixture()
    const mainSha = await source.head('main')

    const session = await startSession(source, { branch: 'feat/created', create: true })
    await session.renameNode(CUSTOMER, 'client')
    const result = await session.commitChanges()
    assert.equal(result.committed, true)

    const headSha = await source.head('feat/created')
    const { commit } = await git.readCommit({ fs, dir: repoDir, oid: headSha })
    assert.deepEqual(commit.parent, [mainSha], 'branch forked from the default branch head')

    const reloaded = await loadGraph({ source, ref: 'feat/created', strict: false })
    assert.ok(reloaded.nodesById.has('orders.Schema.client'))
  })

  it('create: true rejects an existing branch', async () => {
    const { source } = await makeGitFixture(['feat/existing'])
    await assert.rejects(
      () => startSession(source, { branch: 'feat/existing', create: true }),
      (err: unknown) => err instanceof MutationError && /already exists/.test(err.message),
    )
  })

  it('threshold basis is the default branch head even when working on another branch', async () => {
    const { source, repoDir } = await makeGitFixture(['feat/threshold'])

    // Add a branch-only node to feat/threshold before the session starts.
    const seeder = new GitGraphSource({ localPath: repoDir })
    const seedSession = await startSession(seeder, { branch: 'feat/threshold' })
    await seedSession.createNode({
      document: { id: 'orders.Schema.branchOnly', template: 'Schema', properties: { description: 'branch only' } },
    })
    await seedSession.commitChanges('seed branch-only node')

    const session = await startSession(source, { branch: 'feat/threshold' })
    const branchOnly = await session.renameNode('orders.Schema.branchOnly', 'branchLocal')
    assert.equal(branchOnly.recordedTrail, false, 'not on the default branch: free rewrite')

    const shared = await session.renameNode(CUSTOMER, 'client')
    assert.equal(shared.recordedTrail, true, 'present on the default branch head: trail recorded')

    // Manual override wins over the threshold.
    const forced = await session.renameNode('orders.Schema.branchLocal', 'branchFinal', true)
    assert.equal(forced.recordedTrail, true)
  })
})
