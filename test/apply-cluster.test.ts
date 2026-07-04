import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileGraphSource } from '../src/source/file-source.js'
import {
  MutationError,
  discardSession,
  startSession,
} from '../src/mutate/index.js'
import type { WorkingSession } from '../src/mutate/index.js'

// -- fixture content (mirrors test/session.test.ts) ---------------------------

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

const cleanups: Array<() => void> = []

function makeFileFixture(): FileGraphSource {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-apply-cluster-'))
  cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  const files: Record<string, string> = {
    'packs/testpack/templates/Schema.yaml': SCHEMA_TEMPLATE,
    'packs/testpack/templates/Field.yaml': FIELD_TEMPLATE,
    'graph/graph.yaml': `schemaVersion: '1'\ntemplatePacks:\n  - name: testpack\n    path: ../packs/testpack\n`,
    'graph/components/orders/Schemas/customer.yaml': CUSTOMER_CLUSTER,
    'graph/components/orders/Schemas/invoice.yaml': INVOICE_CLUSTER,
  }
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }
  return new FileGraphSource({ graphDir: path.join(tmpDir, 'graph'), defaultBranch: 'local' })
}

async function openSession(): Promise<WorkingSession> {
  return startSession(makeFileFixture(), { autosave: false })
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

describe('applyCluster (merge mode)', () => {
  it('updates only what the document mentions, patching child properties', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: CUSTOMER,
      properties: { description: 'Updated contact' },
      fields: { email: { nullable: true } },
    }, 'merge')

    assert.deepEqual(result.createdIds, [])
    assert.deepEqual(result.deleted, [])
    assert.deepEqual(result.updatedIds.sort(), [CUSTOMER, EMAIL])

    const customer = session.graph.nodesById.get(CUSTOMER)!
    assert.equal(customer.properties.description, 'Updated contact')
    const email = session.graph.nodesById.get(EMAIL)!
    assert.equal(email.properties.nullable, true)
    assert.equal(email.properties.type, 'string', 'merge patches keys — unmentioned keys survive')
    assert.equal(session.graph.nodesById.get(INVOICE)?.properties.description, 'Invoice', 'other clusters untouched')
  })

  it('leaves absent owned sections and absent children alone', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: CUSTOMER,
      properties: { description: 'Only the root' },
    }, 'merge')

    assert.deepEqual(result.deleted, [])
    assert.ok(session.graph.nodesById.has(EMAIL), 'child in an absent section untouched')
    assert.equal(session.graph.nodesById.get(EMAIL)?.state, 'agreed')
  })

  it('creates children present only in the document, with structural edges', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: CUSTOMER,
      fields: { phone: { type: 'string', nullable: true } },
    }, 'merge')

    assert.deepEqual(result.createdIds, [`${CUSTOMER}.fields.phone`])
    assert.deepEqual(result.deleted, [])
    const phone = session.graph.nodesById.get(`${CUSTOMER}.fields.phone`)
    assert.ok(phone)
    assert.equal(phone.parentId, CUSTOMER)
    assert.equal(phone.template, 'Field')
    assert.ok(
      (session.graph.edgesByFrom.get(CUSTOMER) ?? []).some(e => e.type === 'has-field' && e.to === phone.id),
      'structural has-field edge generated',
    )
    assert.ok(session.graph.nodesById.has(EMAIL), 'existing sibling untouched')
  })

  it('updates root state/stability from the metadata block and child state at the top level', async () => {
    const session = await openSession()
    await session.applyCluster({
      id: CUSTOMER,
      metadata: { state: 'proposed' },
      fields: { email: { state: 'draft' } },
    }, 'merge')

    assert.equal(session.graph.nodesById.get(CUSTOMER)?.state, 'proposed')
    assert.equal(session.graph.nodesById.get(EMAIL)?.state, 'draft')
  })

  it('a no-op apply records no journal entry', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: CUSTOMER,
      properties: { description: 'Customer contact' },
      fields: { email: { type: 'string', nullable: false } },
    }, 'merge')

    assert.deepEqual(result.createdIds, [])
    assert.deepEqual(result.updatedIds, [])
    assert.equal(session.journal.length, 0)
    assert.equal(session.hasPendingChanges(), false)
  })

  it('creates a whole new root cluster when the id is unknown', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: 'orders.Schema.receipt',
      template: 'Schema',
      properties: { description: 'Receipt' },
      fields: { total: { type: 'string', nullable: false } },
    }, 'merge')

    assert.deepEqual(result.createdIds.sort(), ['orders.Schema.receipt', 'orders.Schema.receipt.fields.total'])
    assert.equal(session.graph.nodesById.get('orders.Schema.receipt')?.state, 'proposed', 'defaults applied')
  })
})

describe('applyCluster (replace mode)', () => {
  it('deletes children absent from the document via §6: soft when on the default branch', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: CUSTOMER,
      properties: { description: 'Customer contact' },
      fields: { contactEmail: { type: 'string', nullable: false } },
    }, 'replace')

    assert.deepEqual(result.createdIds, [`${CUSTOMER}.fields.contactEmail`])
    assert.deepEqual(result.deleted, [{ id: EMAIL, tier: 'soft' }])
    assert.equal(session.graph.nodesById.get(EMAIL)?.state, 'removed', 'committed child soft-deleted, not purged')
    assert.ok(session.graph.nodesById.has(`${CUSTOMER}.fields.contactEmail`))
  })

  it('fires the possible-rename warning when the same replace deletes and creates with the same template', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: CUSTOMER,
      fields: { contactEmail: { type: 'string', nullable: false } },
    }, 'replace')

    const renameWarning = result.warnings.find(w => /possible rename/.test(w.message))
    assert.ok(renameWarning, 'possible-rename heuristic warning present')
    assert.match(renameWarning.message, /rename_node/)
    assert.equal(renameWarning.severity, 'warning')
  })

  it('purges children absent from the document when they are not on the default branch', async () => {
    const session = await openSession()
    await session.createNode({
      parentId: CUSTOMER,
      section: 'fields',
      name: 'age',
      document: { type: 'integer', nullable: true },
    })
    assert.ok(session.graph.nodesById.has(`${CUSTOMER}.fields.age`))

    const result = await session.applyCluster({
      id: CUSTOMER,
      fields: { email: { type: 'string', nullable: false } },
    }, 'replace')

    assert.deepEqual(result.deleted, [{ id: `${CUSTOMER}.fields.age`, tier: 'hard' }])
    assert.ok(!session.graph.nodesById.has(`${CUSTOMER}.fields.age`), 'unmaterialised child purged')
    assert.ok(session.graph.nodesById.has(EMAIL), 'child present in the document survives')
    assert.notEqual(session.graph.nodesById.get(EMAIL)?.state, 'removed')
  })

  it('treats an absent owned section as an empty section: all children deleted', async () => {
    const session = await openSession()
    const result = await session.applyCluster({
      id: CUSTOMER,
      properties: { description: 'No more fields' },
    }, 'replace')

    assert.deepEqual(result.deleted, [{ id: EMAIL, tier: 'soft' }])
    assert.equal(session.graph.nodesById.get(EMAIL)?.state, 'removed')
  })

  it('replaces root and child properties wholesale but preserves previousNames', async () => {
    const session = await openSession()
    const rename = await session.renameNode(EMAIL, 'emailAddress')
    assert.equal(rename.recordedTrail, true)
    const newId = rename.newId

    await session.applyCluster({
      id: CUSTOMER,
      properties: { description: 'Replaced' },
      fields: { emailAddress: { type: 'string' } },
    }, 'replace')

    const field = session.graph.nodesById.get(newId)!
    assert.equal(field.properties.nullable, undefined, 'replace is authoritative — unmentioned property dropped')
    assert.deepEqual(field.properties.previousNames, [EMAIL], 'system-owned rename trail survives a replace')
    assert.equal(session.graph.nodesById.get(CUSTOMER)?.properties.description, 'Replaced')
  })

  it('never touches sections the template does not declare as owned', async () => {
    const session = await openSession()
    const before = session.graph.nodesById.size
    const result = await session.applyCluster({
      id: CUSTOMER,
      gadgets: { widget: { foo: 1 } },
      fields: { email: { type: 'string', nullable: false } },
    }, 'replace')

    assert.deepEqual(result.createdIds, [])
    assert.deepEqual(result.deleted, [])
    assert.equal(session.graph.nodesById.size, before)
    assert.ok(!session.graph.nodesById.has(`${CUSTOMER}.gadgets.widget`))
  })
})

describe('applyCluster (validation)', () => {
  it('a validation failure leaves the working graph untouched', async () => {
    const session = await openSession()
    const nodeCount = session.graph.nodesById.size
    const emailBefore = JSON.stringify(session.graph.nodesById.get(EMAIL))

    await assert.rejects(
      () => session.applyCluster({
        id: CUSTOMER,
        properties: { description: 'Should not land' },
        fields: { 'bad name!': { type: 'string' } },
      }, 'replace'),
      (err: unknown) => err instanceof MutationError,
    )

    assert.equal(session.graph.nodesById.size, nodeCount)
    assert.equal(session.graph.nodesById.get(CUSTOMER)?.properties.description, 'Customer contact')
    assert.equal(JSON.stringify(session.graph.nodesById.get(EMAIL)), emailBefore, 'planned delete not applied')
    assert.equal(session.journal.length, 0)
  })

  it('rejects an invalid mode, a missing id, an invalid state, and a template change', async () => {
    const session = await openSession()

    await assert.rejects(
      () => session.applyCluster({ id: CUSTOMER }, 'overwrite' as never),
      (err: unknown) => err instanceof MutationError && /mode must be/.test(err.message),
    )
    await assert.rejects(
      () => session.applyCluster({ properties: {} }, 'merge'),
      (err: unknown) => err instanceof MutationError && /string id/.test(err.message),
    )
    await assert.rejects(
      () => session.applyCluster({ id: CUSTOMER, metadata: { state: 'bogus' } }, 'merge'),
      (err: unknown) => err instanceof MutationError && /invalid state/.test(err.message),
    )
    await assert.rejects(
      () => session.applyCluster({ id: CUSTOMER, template: 'Field' }, 'merge'),
      (err: unknown) => err instanceof MutationError && /cannot change template/.test(err.message),
    )
    assert.equal(session.journal.length, 0)
  })
})
