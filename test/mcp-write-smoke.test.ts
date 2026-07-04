import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

type SmokeToolResponse = {
  isError: boolean
  text: string
}

type SmokeCallTool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<SmokeToolResponse>

type SmokeModule = {
  parseWriteSmokeCliArgs: (args: string[]) => { keepTemp: boolean }
  runFilesystemWriteSmoke: (callTool: SmokeCallTool) => Promise<void>
  runGitWriteSmoke: (callTool: SmokeCallTool, options: { branch: string; label: string }) => Promise<void>
}

const {
  parseWriteSmokeCliArgs,
  runFilesystemWriteSmoke,
  runGitWriteSmoke,
} = await import(new URL('../../scripts/mcp-write-smoke.mjs', import.meta.url).href) as SmokeModule

type Mode = 'filesystem' | 'git'
const CREATED_NODE_ID = 'orders.Schema.smoke-write'

type State = {
  mode: Mode
  sessionOpen: boolean
  branch: string
  pendingJournal: string[]
  commitCount: number
  nodes: Map<string, { description: string; previousIds?: string[] }>
  edges: Array<{ id: string; from: string; to: string; type: string; notes?: string }>
  sawCreatedNodeRead: boolean
}

function ok(data: unknown) {
  return { isError: false, text: JSON.stringify(data) }
}

function err(message: string) {
  return { isError: true, text: message }
}

function makeCallTool(mode: Mode): { callTool: SmokeCallTool; calls: string[]; state: State } {
  const calls: string[] = []
  const state: State = {
    mode,
    sessionOpen: false,
    branch: mode === 'filesystem' ? 'local' : 'feat/smoke',
    pendingJournal: [],
    commitCount: 0,
    nodes: new Map([
      ['orders.Schema.invoice', { description: 'Invoice' }],
      ['orders.Schema.customer', { description: 'Customer contact' }],
    ]),
    edges: [],
    sawCreatedNodeRead: false,
  }

  const callTool: SmokeCallTool = async (name, args = {}) => {
    calls.push(name)
    switch (name) {
      case 'start_changes': {
        if (mode === 'git' && typeof args.branch !== 'string') {
          return err("cannot start a write session on the default branch 'main' - it is read-only")
        }
        state.sessionOpen = true
        const autosave = typeof args.autosave === 'boolean' ? args.autosave : false
        return ok({
          branch: typeof args.branch === 'string' ? args.branch : state.branch,
          default_branch: mode === 'filesystem' ? 'local' : 'main',
          autosave: mode === 'filesystem' ? autosave : false,
        })
      }
      case 'create_node': {
        const id = String((args.document as Record<string, unknown>).id)
        const properties = ((args.document as Record<string, unknown>).properties ?? {}) as Record<string, unknown>
        state.nodes.set(id, { description: String(properties.description ?? '') })
        state.pendingJournal.push(name)
        return ok({ id, createdIds: [id, `${id}.fields.status`] })
      }
      case 'get_cluster': {
        const id = String(args.node_id)
        const node = state.nodes.get(id)
        assert.ok(node, `unknown node requested in stub: ${id}`)
        if (id === CREATED_NODE_ID && node.description === 'Created by smoke') {
          state.sawCreatedNodeRead = true
        }
        return ok({
          root: {
            id,
            properties: {
              description: node.description,
            },
            ...(node.previousIds ? { corum: { identity: { previousIds: node.previousIds } } } : {}),
          },
          descendants: id === 'orders.Schema.smoke-write'
            ? [{ id: `${id}.fields.status`, properties: { type: 'string' } }]
            : [],
          edges: state.edges.filter(edge => edge.from === id || edge.to === id),
        })
      }
      case 'update_node': {
        const id = String(args.id)
        const node = state.nodes.get(id)
        assert.ok(node, `unknown update node in stub: ${id}`)
        const properties = (args.properties ?? {}) as Record<string, unknown>
        if (typeof properties.description === 'string') node.description = properties.description
        state.pendingJournal.push(name)
        return ok({ id })
      }
      case 'rename_node': {
        const oldId = String(args.id)
        const newId = `orders.Schema.${String(args.new_name)}`
        const node = state.nodes.get(oldId)
        assert.ok(node, `unknown rename node in stub: ${oldId}`)
        state.nodes.delete(oldId)
        state.nodes.set(newId, { description: node.description, previousIds: [oldId] })
        state.edges = state.edges.map(edge => ({
          ...edge,
          from: edge.from === oldId ? newId : edge.from,
          to: edge.to === oldId ? newId : edge.to,
        }))
        state.pendingJournal.push(name)
        return ok({ newId, recordedTrail: true })
      }
      case 'create_edge': {
        assert.equal(state.sawCreatedNodeRead, true, 'edge must be created only after reading the created node back')
        const from = String(args.from)
        const to = String(args.to)
        const type = String(args.type)
        const notes = typeof args.notes === 'string' ? args.notes : undefined
        const id = `${from}__${type}__${to}`
        state.edges.push({ id, from, to, type, notes })
        state.pendingJournal.push(name)
        return ok({ edge: { id, from, to, type, notes } })
      }
      case 'pending_changes':
        return ok({ journal: state.pendingJournal.map((entry, index) => ({ index, op: entry })) })
      case 'commit_changes':
        state.sessionOpen = false
        state.pendingJournal = []
        state.commitCount += 1
        return ok({ committed: true, message: String(args.message ?? 'commit') })
      case 'discard_changes':
        state.sessionOpen = false
        state.pendingJournal = []
        return ok({ discarded: true, branch: state.branch })
      default:
        throw new Error(`unexpected tool call in stub: ${name}`)
    }
  }

  return { callTool, calls, state }
}

describe('MCP write smoke scenarios', () => {
  it('parses --keep-temp for the CLI runner', () => {
    assert.deepEqual(parseWriteSmokeCliArgs([]), { keepTemp: false })
    assert.deepEqual(parseWriteSmokeCliArgs(['--keep-temp']), { keepTemp: true })
  })

  it('filesystem scenario creates, edits, renames, commits, then verifies autosave-on-discard state', async () => {
    const { callTool, calls, state } = makeCallTool('filesystem')

    await runFilesystemWriteSmoke(callTool)

    assert.equal(state.nodes.get('orders.Schema.smoke-write')?.description, 'Discard persists')
    assert.deepEqual(state.nodes.get('orders.Schema.bill')?.previousIds, ['orders.Schema.invoice'])
    assert.ok(state.edges.some(edge => edge.id === 'orders.Schema.bill__uses-type__orders.Schema.smoke-write'))
    assert.ok(calls.includes('create_node'))
    assert.ok(calls.includes('create_edge'))
    assert.equal(calls.filter(name => name === 'update_node').length, 2)
    assert.ok(calls.includes('discard_changes'))
  })

  it('git scenario rejects the default branch and performs two committed sessions on the same branch', async () => {
    const { callTool, calls, state } = makeCallTool('git')

    await runGitWriteSmoke(callTool, { branch: 'feat/smoke', label: 'local-git' })

    assert.equal(state.commitCount, 2)
    assert.equal(state.nodes.get('orders.Schema.smoke-write')?.description, 'Edited twice')
    assert.deepEqual(state.nodes.get('orders.Schema.bill')?.previousIds, ['orders.Schema.invoice'])
    assert.ok(state.edges.some(edge => edge.id === 'orders.Schema.bill__uses-type__orders.Schema.smoke-write'))
    assert.equal(calls[0], 'start_changes')
    assert.equal(calls.filter(name => name === 'commit_changes').length, 2)
  })
})
