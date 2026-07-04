import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export type SmokeToolResponse = {
  isError: boolean
  text: string
}

export type SmokeCallTool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<SmokeToolResponse>

type ClusterPayload = {
  root: {
    id: string
    properties: Record<string, unknown>
  }
  descendants: Array<{
    id: string
    properties?: Record<string, unknown>
  }>
  edges?: Array<{
    id: string
    from: string
    to: string
    type: string
    notes?: string
  }>
}

type StartChangesPayload = {
  branch: string
  default_branch: string
  autosave: boolean
}

type WriteSmokeCliOptions = {
  keepTemp: boolean
}

const SMOKE_NODE_ID = 'orders.Schema.smoke-write'
const RENAMED_NODE_ID = 'orders.Schema.bill'
const RETIRED_NODE_ID = 'orders.Schema.invoice'

export async function runFilesystemWriteSmoke(callTool: SmokeCallTool): Promise<void> {
  const started = await expectJson<StartChangesPayload>(callTool, 'start_changes')
  assert.equal(started.branch, started.default_branch)
  assert.equal(started.autosave, true)

  await runCreateReadUpdateReadFlow(callTool)
  await runRenameAndVerifyFlow(callTool)

  const commit = await expectJson<{ committed: boolean }>(callTool, 'commit_changes', {
    message: 'filesystem smoke commit',
  })
  assert.equal(commit.committed, true)

  const reopened = await expectJson<StartChangesPayload>(callTool, 'start_changes')
  assert.equal(reopened.autosave, true)
  await expectJson(callTool, 'update_node', {
    id: SMOKE_NODE_ID,
    properties: { description: 'Discard persists' },
  })
  const discarded = await expectJson<{ discarded: boolean }>(callTool, 'discard_changes')
  assert.equal(discarded.discarded, true)

  const persisted = await getCluster(callTool, SMOKE_NODE_ID)
  assert.equal(persisted.root.properties.description, 'Discard persists')
}

export async function runGitWriteSmoke(
  callTool: SmokeCallTool,
  options: { branch: string; label: string },
): Promise<void> {
  await expectError(callTool, 'start_changes', /read-only|writable branch|default branch/i)

  const started = await expectJson<StartChangesPayload>(callTool, 'start_changes', {
    branch: options.branch,
    create: true,
  })
  assert.equal(started.branch, options.branch)
  assert.equal(started.default_branch, 'main')
  assert.equal(started.autosave, false)

  await runCreateReadUpdateReadFlow(callTool, options.branch)
  await runRenameAndVerifyFlow(callTool, options.branch)

  const pending = await expectJson<{ journal: Array<unknown> }>(callTool, 'pending_changes')
  assert.ok(pending.journal.length >= 3, `${options.label}: expected at least 3 journal entries before commit`)

  const firstCommit = await expectJson<{ committed: boolean }>(callTool, 'commit_changes', {
    message: `${options.label} smoke commit 1`,
  })
  assert.equal(firstCommit.committed, true)

  const firstCluster = await getCluster(callTool, RENAMED_NODE_ID, options.branch)
  assert.deepEqual(firstCluster.root.properties.previousNames, [RETIRED_NODE_ID])
  const firstCreated = await getCluster(callTool, SMOKE_NODE_ID, options.branch)
  assert.equal(firstCreated.root.properties.description, 'Edited by smoke')

  const secondStart = await expectJson<StartChangesPayload>(callTool, 'start_changes', {
    branch: options.branch,
  })
  assert.equal(secondStart.branch, options.branch)

  await expectJson(callTool, 'update_node', {
    id: SMOKE_NODE_ID,
    properties: { description: 'Edited twice' },
  })
  const secondCommit = await expectJson<{ committed: boolean }>(callTool, 'commit_changes', {
    message: `${options.label} smoke commit 2`,
  })
  assert.equal(secondCommit.committed, true)

  const secondCreated = await getCluster(callTool, SMOKE_NODE_ID, options.branch)
  assert.equal(secondCreated.root.properties.description, 'Edited twice')
}

export function parseWriteSmokeCliArgs(args: string[]): WriteSmokeCliOptions {
  return {
    keepTemp: args.includes('--keep-temp'),
  }
}

export async function runWriteSmokeCli(options: WriteSmokeCliOptions = { keepTemp: false }): Promise<void> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

  console.log('Running MCP write smoke checks')
  await runFilesystemSmokeCli(env, options)
  await runLocalGitSmokeCli(env, options)
  await runRemoteGitSmokeCli(env)
  console.log('MCP write smoke checks passed')
}

async function runFilesystemSmokeCli(env: Record<string, string>, options: WriteSmokeCliOptions): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-write-file-'))
  try {
    const graphDir = createFilesystemFixture(tmpDir)
    await withClient({
      ...env,
      CORUM_SOURCE: 'filesystem',
      CORUM_GRAPH_PATH: graphDir,
    }, async callTool => {
      await runFilesystemWriteSmoke(callTool)
    })
    console.log(`- filesystem: passed (${graphDir})`)
  } finally {
    cleanupTempDir(tmpDir, options.keepTemp)
  }
}

async function runLocalGitSmokeCli(env: Record<string, string>, options: WriteSmokeCliOptions): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-write-git-'))
  try {
    await createGitFixture(tmpDir)
    const branch = `corum-smoke/${Date.now()}`
    await withClient({
      ...env,
      CORUM_SOURCE: 'git',
      CORUM_GIT_LOCAL_PATH: tmpDir,
      CORUM_GIT_BRANCH: 'main',
    }, async callTool => {
      await runGitWriteSmoke(callTool, { branch, label: 'local-git' })
    })
    console.log(`- local-git: passed (${tmpDir}, branch ${branch})`)
  } finally {
    cleanupTempDir(tmpDir, options.keepTemp)
  }
}

async function runRemoteGitSmokeCli(env: Record<string, string>): Promise<void> {
  if (!env.CORUM_GIT_REMOTE_URL) {
    console.log('- remote-git: skipped (set CORUM_GIT_REMOTE_URL to enable)')
    return
  }
  const branch = env.CORUM_SMOKE_BRANCH ?? `corum-smoke/${Date.now()}`
  await withClient({
    ...env,
    CORUM_SOURCE: 'git',
    CORUM_GIT_REMOTE_URL: env.CORUM_GIT_REMOTE_URL,
    CORUM_GIT_BRANCH: env.CORUM_GIT_BRANCH ?? 'main',
  }, async callTool => {
    await runGitWriteSmoke(callTool, { branch, label: 'remote-git' })
  })
  console.log(`- remote-git: passed (branch ${branch})`)
}

async function withClient(
  env: Record<string, string>,
  fn: (callTool: SmokeCallTool) => Promise<void>,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/src/mcp/index.js'],
    cwd: process.cwd(),
    env,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'corum-write-smoke', version: '0.1.0' })
  try {
    await client.connect(transport)
    await fn(async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: { ...args, format: 'json' } })
      const first = (result.content as Array<{ type?: string; text?: string }> | undefined)?.[0]
      if (!first || first.type !== 'text') {
        throw new Error(`Expected text content from ${name}, got ${JSON.stringify(result)}`)
      }
      return { isError: result.isError === true, text: first.text ?? '' }
    })
  } finally {
    await transport.close()
  }
}

async function runCreateReadUpdateReadFlow(callTool: SmokeCallTool, branch?: string): Promise<void> {
  const created = await expectJson<{ createdIds: string[] }>(callTool, 'create_node', {
    document: {
      id: SMOKE_NODE_ID,
      template: 'Schema',
      properties: { description: 'Created by smoke' },
      fields: {
        status: {
          type: 'string',
          nullable: false,
        },
      },
    },
  })
  assert.ok(created.createdIds.includes(SMOKE_NODE_ID))

  const firstCluster = await getCluster(callTool, SMOKE_NODE_ID, branch)
  assert.equal(firstCluster.root.properties.description, 'Created by smoke')
  assert.ok(firstCluster.descendants.some(node => node.id === `${SMOKE_NODE_ID}.fields.status`))

  await expectJson(callTool, 'update_node', {
    id: SMOKE_NODE_ID,
    properties: { description: 'Edited by smoke' },
  })

  const secondCluster = await getCluster(callTool, SMOKE_NODE_ID, branch)
  assert.equal(secondCluster.root.properties.description, 'Edited by smoke')
}

async function runRenameAndVerifyFlow(callTool: SmokeCallTool, branch?: string): Promise<void> {
  const renamed = await expectJson<{ newId: string; recordedTrail: boolean }>(callTool, 'rename_node', {
    id: RETIRED_NODE_ID,
    new_name: 'bill',
  })
  assert.equal(renamed.newId, RENAMED_NODE_ID)
  assert.equal(renamed.recordedTrail, true)

  await expectJson(callTool, 'create_edge', {
    from: RENAMED_NODE_ID,
    to: SMOKE_NODE_ID,
    type: 'uses-type',
    notes: 'smoke edge',
  })

  const renamedCluster = await getCluster(callTool, RENAMED_NODE_ID, branch)
  assert.deepEqual(renamedCluster.root.properties.previousNames, [RETIRED_NODE_ID])
  assert.ok(
    (renamedCluster.edges ?? []).some(edge =>
      edge.id === `${RENAMED_NODE_ID}__uses-type__${SMOKE_NODE_ID}`
      && edge.from === RENAMED_NODE_ID
      && edge.to === SMOKE_NODE_ID
      && edge.type === 'uses-type'
      && edge.notes === 'smoke edge'),
  )
}

async function getCluster(callTool: SmokeCallTool, nodeId: string, branch?: string): Promise<ClusterPayload> {
  return expectJson<ClusterPayload>(callTool, 'get_cluster', {
    ...(branch ? { branch } : {}),
    node_id: nodeId,
    collapse_schemas: false,
    include_edges: true,
    include_edge_ids: true,
    edge_types: ['uses-type'],
  })
}

async function expectJson<T>(
  callTool: SmokeCallTool,
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const result = await callTool(name, args)
  if (result.isError) {
    throw new Error(`${name} failed: ${result.text}`)
  }
  return JSON.parse(result.text) as T
}

async function expectError(
  callTool: SmokeCallTool,
  name: string,
  pattern: RegExp,
  args?: Record<string, unknown>,
): Promise<void> {
  const result = await callTool(name, args)
  assert.equal(result.isError, true, `${name} should have failed`)
  assert.match(result.text, pattern)
}

function createFilesystemFixture(tmpDir: string): string {
  writeFixtureFiles(tmpDir, '')
  return path.join(tmpDir, 'graph')
}

async function createGitFixture(tmpDir: string): Promise<void> {
  await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
  const files = writeFixtureFiles(tmpDir, '.corum')
  for (const rel of files) {
    await git.add({ fs, dir: tmpDir, filepath: rel })
  }
  await git.commit({
    fs,
    dir: tmpDir,
    message: 'initial',
    author: { name: 'Test', email: 'test@test.com' },
  })
}

function writeFixtureFiles(root: string, base: string): string[] {
  const files: Record<string, string> = {
    [joinRepo(base, 'packs/testpack/templates/Schema.yaml')]: `name: Schema
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
`,
    [joinRepo(base, 'packs/testpack/templates/Field.yaml')]: `name: Field
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
`,
    [joinRepo(base, 'graph/graph.yaml')]: `schemaVersion: '1'\ntemplatePacks:\n  - name: testpack\n    path: ../packs/testpack\n`,
    [joinRepo(base, 'graph/components/orders/Schemas/customer.yaml')]: `id: orders.Schema.customer
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
`,
    [joinRepo(base, 'graph/components/orders/Schemas/invoice.yaml')]: `id: orders.Schema.invoice
template: Schema
schemaVersion: '1.0'
metadata:
  component: orders
  state: proposed
  stability: unstable
  lastModifiedAt: '2026-07-01'
properties:
  description: 'Invoice'
`,
  }

  const written: string[] = []
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(root, ...rel.split('/').filter(Boolean))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    written.push(rel)
  }
  return written
}

function joinRepo(base: string, rel: string): string {
  return base ? `${base}/${rel}` : rel
}

function cleanupTempDir(tmpDir: string, keepTemp: boolean): void {
  if (keepTemp) {
    console.log(`  kept temp dir: ${tmpDir}`)
    return
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
