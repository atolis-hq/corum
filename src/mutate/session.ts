import type { Diagnostic, Edge, Graph, Node, Stability, State } from '../schema/index.js'
import type { GraphSource } from '../source/index.js'
import { FileGraphSource } from '../source/file-source.js'
import { loadGraph } from '../loader/index.js'
import { serializeGraph } from '../writer/graph-writer.js'
import { lintEdge, lintGraph, lintNode } from '../linter/index.js'
import { CORE_EDGE_TYPE_MAP, VALID_STABILITY_SET, VALID_STATE_SET } from '../loader/constants.js'
import { validateSegment } from '../loader/id-grammar.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import { materialiseChildren } from '../loader/cluster-loader.js'
import type { ClusterResult } from '../loader/cluster-loader.js'
import { MutationError } from './errors.js'
import { applyClusterToGraph, materialiseRootDocument } from './apply-cluster.js'
import type { ApplyClusterMode, ApplyClusterOutcome } from './apply-cluster.js'
import { renameNode as renameNodePrimitive, shouldRecordTrail } from './rename.js'
import { deleteEdge as deleteEdgePrimitive, deleteNode as deleteNodePrimitive } from './delete.js'
import type { DeleteNodeOptions } from './delete.js'
import { findEdgeById, insertEdgeIntoIndexes, mutationDiagnostic, mutationTimestamp } from './util.js'

/**
 * Working session (design §7): mutations apply to an in-memory working graph
 * loaded from a branch head, plus a change journal. The session is the
 * transaction — per-operation validation, atomicity at commit,
 * `discard()` aborts. MCP write tools are thin wrappers over this class;
 * no mutation logic lives in `src/mcp/`.
 *
 * One session per process (design §7 concurrency): `startSession` while a
 * session with pending changes is open throws; with no pending changes the
 * old session is reset cleanly.
 */

export interface StartSessionOptions {
  /** Branch to load and commit to. Default: the source's default branch. */
  branch?: string
  /** Fork a new branch from the default branch head (git sources only). */
  create?: boolean
  /**
   * Autosave (design §7 table). Default: ON for file sources (write-through
   * to disk per mutation), OFF for git sources (WIP checkpoint commit per
   * mutation when ON, message `corum-wip: <op summary>`).
   */
  autosave?: boolean
}

export interface JournalEntry {
  op: string
  args: Record<string, unknown>
  summary: string
}

export interface ChangeCounts {
  added: number
  modified: number
  removed: number
}

export interface PendingChanges {
  branch: string
  baseSha: string
  autosave: boolean
  journal: JournalEntry[]
  diff: {
    nodes: ChangeCounts
    edges: ChangeCounts
  }
}

/** Every operation returns its journal summary plus lint warnings (never errors — errors throw). */
export interface OperationResult {
  summary: string
  warnings: Diagnostic[]
}

export interface RenameNodeResult extends OperationResult {
  newId: string
  recordedTrail: boolean
}

export interface DeleteNodeResult extends OperationResult {
  tier: 'soft' | 'hard'
  affectedIds: string[]
}

export interface DeleteEdgeResult extends OperationResult {
  edge: Edge
}

export interface CreateEdgeInput {
  from: string
  to: string
  type: string
  state?: State
  stability?: Stability
  notes?: string
  properties?: Record<string, unknown>
}

export interface CreateEdgeResult extends OperationResult {
  edge: Edge
}

export interface UpdateEdgePatch {
  state?: State
  stability?: Stability
  /** `null` clears the notes. */
  notes?: string | null
  /** Property patch — `null` clears a key. Endpoints and type are immutable. */
  properties?: Record<string, unknown>
}

export interface UpdateEdgeResult extends OperationResult {
  edge: Edge
}

export interface UpdateNodePatch {
  /** Property patch — `null` clears a key. Cannot change the name (use renameNode). */
  properties?: Record<string, unknown>
  state?: State
  stability?: Stability
}

export interface UpdateNodeResult extends OperationResult {
  node: Node
}

export interface CreateNodeInput {
  /**
   * Cluster-style document. Roots: `{ id, template, schemaVersion?, metadata?,
   * properties?, ...ownedSections }` (metadata defaults are filled in). Owned
   * children: the child body (`properties` flattened at the top level plus
   * optional nested owned sections), created as `parentId`+`section`+`name`.
   */
  document: Record<string, unknown>
  /** Owning parent id — omit to create a root cluster. */
  parentId?: string
  /** Owned section under the parent (e.g. `fields`, `schemas`); required with parentId. */
  section?: string
  /** Local name for the new owned child; required with parentId. */
  name?: string
}

export interface CreateNodeResult extends OperationResult {
  /** IDs of every node created (the requested node first). */
  createdIds: string[]
}

export interface ApplyClusterResult extends OperationResult, ApplyClusterOutcome {}

export interface CommitResult {
  committed: boolean
  /** The commit message used (absent for file write-through, which has already committed per-mutation). */
  message?: string
  /** True when the WIP run was squashed into a single commit parented at baseSha (design §14e). */
  squashed: boolean
  /** Extra outcome context, e.g. "WIP checkpoints preserved". */
  note?: string
  /** Full-graph lint warnings that rode along with the commit. */
  warnings: Diagnostic[]
}

let currentSession: WorkingSession | null = null

/** The open working session, if any — MCP reads serve `session.graph` while one is open. */
export function getActiveSession(): WorkingSession | null {
  return currentSession
}

/** Discard the active session, if any (design §7: abort, no writes). */
export function discardSession(): void {
  currentSession?.discard()
}

/**
 * Open a working session on `source` (design §7). Loads the working graph
 * from the branch head, captures the trail-threshold ID set of the default
 * branch and the base head marker once (design §14c), and registers the
 * session as the process-wide active session.
 */
export async function startSession(
  source: GraphSource,
  options: StartSessionOptions = {},
): Promise<WorkingSession> {
  if (currentSession) {
    if (currentSession.hasPendingChanges()) {
      throw new MutationError([mutationDiagnostic(
        'error',
        'a working session with pending changes is already open — commit or discard it first',
      )])
    }
    currentSession.discard() // clean reset (design §7)
  }

  const isFileSource = source instanceof FileGraphSource
  const defaultBranch = await source.defaultBranch()
  const branch = options.branch ?? defaultBranch

  if (options.create) {
    if (isFileSource) {
      throw new MutationError([mutationDiagnostic(
        'error',
        `file sources have a single branch ('${defaultBranch}') and cannot create '${branch}' (design §9)`,
      )])
    }
    if (branch === defaultBranch) {
      throw new MutationError([mutationDiagnostic(
        'error',
        `create requires a branch name different from the default branch '${defaultBranch}'`,
      )])
    }
    if ((await source.listBranches()).includes(branch)) {
      throw new MutationError([mutationDiagnostic('error', `cannot create branch '${branch}': it already exists`)])
    }
  }

  // In create mode the branch does not exist yet: the base is the default
  // branch head; the branch itself is created on first commit.
  const baseRef = options.create ? defaultBranch : branch
  const graph = await loadGraph({ source, ref: baseRef, strict: false })

  // Trail threshold set (design §14c): captured once, from the DEFAULT branch
  // head — even when the session works on another branch.
  const defaultGraph = baseRef === defaultBranch
    ? graph
    : await loadGraph({ source, ref: defaultBranch, strict: false })
  const defaultBranchIds = new Set(defaultGraph.nodesById.keys())

  const baseSha = await source.head(baseRef)
  const autosave = options.autosave ?? isFileSource

  const session = new WorkingSession(
    source, branch, defaultBranch, isFileSource, options.create === true, autosave,
    graph, baseSha, defaultBranchIds,
  )
  currentSession = session
  return session
}

export class WorkingSession {
  readonly journal: JournalEntry[] = []
  private readonly wipShas = new Set<string>()
  private readonly baseNodes: Map<string, string>
  private readonly baseEdges: Map<string, string>
  private closed = false

  constructor(
    private readonly source: GraphSource,
    readonly branch: string,
    readonly defaultBranch: string,
    private readonly isFileSource: boolean,
    private readonly createBranch: boolean,
    readonly autosave: boolean,
    readonly graph: Graph,
    readonly baseSha: string,
    private readonly defaultBranchIds: Set<string>,
  ) {
    this.baseNodes = snapshotNodes(graph)
    this.baseEdges = snapshotEdges(graph)
  }

  isClosed(): boolean {
    return this.closed
  }

  hasPendingChanges(): boolean {
    return !this.closed && this.journal.length > 0
  }

  /**
   * Rename a node (design §3). Trail threshold (design §4): when
   * `recordTrail` is not given, a trail is recorded iff the node's ID exists
   * on the default branch head captured at session start.
   */
  async renameNode(id: string, newName: string, recordTrail?: boolean): Promise<RenameNodeResult> {
    this.assertOpen()
    const trail = shouldRecordTrail(this.defaultBranchIds, id, recordTrail)
    const { newId, warnings } = renameNodePrimitive(this.graph, id, newName, trail)
    const summary = `rename ${id} -> ${newId}${trail ? ' (trail recorded)' : ''}`
    await this.record('rename_node', { id, newName, recordTrail: trail }, summary)
    return { newId, recordedTrail: trail, warnings, summary }
  }

  /** Delete a node and its owned subtree (design §6); tier per trail threshold unless overridden. */
  async deleteNode(id: string, opts: DeleteNodeOptions = {}): Promise<DeleteNodeResult> {
    this.assertOpen()
    const result = deleteNodePrimitive(this.graph, id, opts, this.defaultBranchIds)
    const summary = `delete ${id} (${result.tier}, ${result.affectedIds.length} node${result.affectedIds.length === 1 ? '' : 's'})`
    await this.record('delete_node', { id, ...opts }, summary)
    return { ...result, warnings: [], summary }
  }

  /** Delete an edge — always hard (design §6). */
  async deleteEdge(id: string): Promise<DeleteEdgeResult> {
    this.assertOpen()
    const edge = deleteEdgePrimitive(this.graph, id)
    const summary = `delete edge ${id}`
    await this.record('delete_edge', { id }, summary)
    return { edge, warnings: [], summary }
  }

  /**
   * Create an explicit edge. Errors: unknown endpoints (a hidden edge type's
   * `to` may dangle), unknown edge type, duplicate edge, invalid
   * state/stability. Edge-type constraint and property-schema violations are
   * lint warnings on the result.
   */
  async createEdge(input: CreateEdgeInput): Promise<CreateEdgeResult> {
    this.assertOpen()
    const errors: Diagnostic[] = []
    const edgeTypes = this.graph.edgeTypes ?? CORE_EDGE_TYPE_MAP
    const typeDef = edgeTypes.get(input.type)

    if (!typeDef) {
      errors.push(mutationDiagnostic('error', `unknown edge type '${input.type}'`))
    }
    if (!this.graph.nodesById.has(input.from)) {
      errors.push(mutationDiagnostic('error', `cannot create edge: 'from' node not found: ${input.from}`, input.from))
    }
    if (!this.graph.nodesById.has(input.to) && typeDef?.hidden !== true) {
      errors.push(mutationDiagnostic('error', `cannot create edge: 'to' node not found: ${input.to}`, input.to))
    }
    validateStateStability(input.state, input.stability, errors)

    const id = `${input.from}__${input.type}__${input.to}`
    if (findEdgeById(this.graph, id)) {
      errors.push(mutationDiagnostic('error', `edge already exists: ${id}`))
    }
    if (errors.length > 0) throw new MutationError(errors)

    const edge: Edge = {
      id,
      from: input.from,
      to: input.to,
      type: input.type,
      state: input.state ?? 'proposed',
      stability: input.stability ?? 'unstable',
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.properties !== undefined && { properties: { ...input.properties } }),
    }
    const warnings = lintEdge(this.graph, edge).filter(d => d.severity === 'warning')
    insertEdgeIntoIndexes(this.graph, edge)

    const summary = `create edge ${id}`
    await this.record('create_edge', { from: input.from, to: input.to, type: input.type }, summary)
    return { edge, warnings, summary }
  }

  /** Patch an explicit edge. Endpoints and type are immutable (delete + create instead). */
  async updateEdge(id: string, patch: UpdateEdgePatch): Promise<UpdateEdgeResult> {
    this.assertOpen()
    const edge = findEdgeById(this.graph, id)
    if (!edge) {
      throw new MutationError([mutationDiagnostic('error', `cannot update: edge not found: ${id}`)])
    }
    const errors: Diagnostic[] = []
    validateStateStability(patch.state, patch.stability, errors)
    if (errors.length > 0) throw new MutationError(errors)

    if (patch.state !== undefined) edge.state = patch.state
    if (patch.stability !== undefined) edge.stability = patch.stability
    if (patch.notes !== undefined) {
      if (patch.notes === null) delete edge.notes
      else edge.notes = patch.notes
    }
    if (patch.properties !== undefined) {
      const merged = { ...(edge.properties ?? {}) }
      applyPropertyPatch(merged, patch.properties)
      if (Object.keys(merged).length === 0) delete edge.properties
      else edge.properties = merged
    }

    const warnings = lintEdge(this.graph, edge).filter(d => d.severity === 'warning')
    const summary = `update edge ${id}`
    await this.record('update_edge', { id, ...patch }, summary)
    return { edge, warnings, summary }
  }

  /** Patch a node's properties/state/stability. `null` clears a property key. Names change via renameNode only. */
  async updateNode(id: string, patch: UpdateNodePatch): Promise<UpdateNodeResult> {
    this.assertOpen()
    const node = this.graph.nodesById.get(id)
    if (!node) {
      throw new MutationError([mutationDiagnostic('error', `cannot update: node not found: ${id}`, id)])
    }
    const errors: Diagnostic[] = []
    validateStateStability(patch.state, patch.stability, errors)
    if (errors.length > 0) throw new MutationError(errors)

    if (patch.state !== undefined) node.state = patch.state
    if (patch.stability !== undefined) node.stability = patch.stability
    if (patch.properties !== undefined) applyPropertyPatch(node.properties, patch.properties)
    node.lastModifiedAt = mutationTimestamp()

    const warnings = lintNode(this.graph, node).filter(d => d.severity === 'warning')
    const summary = `update ${id}`
    await this.record('update_node', { id, ...patch }, summary)
    return { node, warnings, summary }
  }

  /**
   * Create a root cluster or an owned child (with nested children in one
   * call), reusing the loader's cluster materialisation so structural edges
   * and defaults match load semantics exactly (design §8 create_node).
   */
  async createNode(input: CreateNodeInput): Promise<CreateNodeResult> {
    this.assertOpen()
    const result = input.parentId !== undefined
      ? this.materialiseChild(input)
      : this.materialiseRoot(input.document)

    // Collision check before merging — the working graph is untouched on failure.
    const errors: Diagnostic[] = []
    for (const nodeId of result.nodes.keys()) {
      if (this.graph.nodesById.has(nodeId)) {
        errors.push(mutationDiagnostic('error', `node already exists: ${nodeId}`, nodeId))
      }
    }
    if (errors.length > 0) throw new MutationError(errors)

    const timestamp = mutationTimestamp()
    const warnings: Diagnostic[] = []
    for (const node of result.nodes.values()) {
      node.lastModifiedAt = timestamp
      this.graph.nodesById.set(node.id, node)
    }
    for (const edges of result.edgesByFrom.values()) {
      for (const edge of edges) {
        if (!findEdgeById(this.graph, edge.id)) insertEdgeIntoIndexes(this.graph, edge)
      }
    }
    for (const node of result.nodes.values()) {
      warnings.push(...lintNode(this.graph, node).filter(d => d.severity === 'warning'))
    }

    const createdIds = [...result.nodes.keys()]
    const summary = `create ${createdIds[0]}${createdIds.length > 1 ? ` (+${createdIds.length - 1} owned)` : ''}`
    await this.record('create_node', {
      id: createdIds[0],
      ...(input.parentId !== undefined && { parentId: input.parentId, section: input.section, name: input.name }),
    }, summary)
    return { createdIds, warnings, summary }
  }

  /**
   * Upsert a cluster-style nested document (design §8/§14f). `merge` updates
   * only what the document mentions; `replace` makes the document
   * authoritative for every owned section — absent children (and every child
   * of an absent owned section) are deleted via §6 semantics against the
   * session's trail-threshold set. A changed key is never a rename
   * (delete+add plus a possible-rename warning). Validates before applying;
   * a no-op apply records no journal entry.
   */
  async applyCluster(document: Record<string, unknown>, mode: ApplyClusterMode): Promise<ApplyClusterResult> {
    this.assertOpen()
    const outcome = applyClusterToGraph(this.graph, document, mode, this.defaultBranchIds)
    const changeCount = outcome.createdIds.length + outcome.updatedIds.length + outcome.deleted.length
    const summary = `apply_cluster ${outcome.rootId} (${mode}): ` +
      `+${outcome.createdIds.length} ~${outcome.updatedIds.length} -${outcome.deleted.length}`
    if (changeCount > 0) {
      await this.record('apply_cluster', { rootId: outcome.rootId, mode }, summary)
    }
    return { ...outcome, summary }
  }

  /** Journal + working-graph-vs-base summary diff (design §8 pending_changes). */
  pendingChanges(): PendingChanges {
    this.assertOpen()
    return {
      branch: this.branch,
      baseSha: this.baseSha,
      autosave: this.autosave,
      journal: [...this.journal],
      diff: {
        nodes: diffCounts(this.baseNodes, snapshotNodes(this.graph)),
        edges: diffCounts(this.baseEdges, snapshotEdges(this.graph)),
      },
    }
  }

  /**
   * Abort the session (design §7). No further writes; with file-source
   * autosave, write-through mutations already on disk are NOT rolled back —
   * autosave trades checkpoint durability for commit-level atomicity.
   */
  discard(): void {
    this.closed = true
    if (currentSession === this) currentSession = null
  }

  /**
   * Lint-gate, serialise, and commit the working graph (design §7/§10/§14e).
   *
   * - Full `lintGraph` first: error diagnostics BLOCK the commit
   *   (MutationError; the session stays open so the caller can fix and
   *   retry); warnings ride along on the result.
   * - File-source autosave (write-through): every mutation is already on
   *   disk, so after the lint gate this just closes the session. A lint
   *   failure here leaves the session open with the content still on disk —
   *   per-operation validation makes error-severity drift unlikely, and the
   *   caller can repair and re-commit.
   * - Moved-head detection (design §10): if the branch head moved since
   *   session start and the intervening commits are not all session WIP
   *   checkpoints, the commit fails; discard and replay.
   * - Squash guard (design §14e): with git autosave, when every commit since
   *   baseSha is a session WIP (compared by SHA set), the run is squashed
   *   into one commit parented at baseSha (force-push where needed);
   *   otherwise the final commit lands on top and WIP checkpoints are
   *   preserved.
   */
  async commitChanges(message?: string): Promise<CommitResult> {
    this.assertOpen()

    const lint = lintGraph(this.graph)
    if (lint.some(d => d.severity === 'error')) {
      throw new MutationError(lint)
    }
    const warnings = lint.filter(d => d.severity === 'warning')

    if (this.journal.length === 0) {
      this.discard()
      return { committed: false, squashed: false, warnings, note: 'no pending changes' }
    }

    if (this.isFileSource && this.autosave) {
      // Write-through: content already persisted per mutation; commit closes the session.
      this.discard()
      return {
        committed: true,
        squashed: false,
        warnings,
        note: 'autosave write-through: changes already persisted per mutation; session closed',
      }
    }

    const msg = message ?? this.defaultCommitMessage()

    let shas: string[] = []
    try {
      shas = await this.source.log(this.branch, this.baseSha)
    } catch {
      shas = [] // create-mode: the branch does not exist until the first commit
    }
    const externals = shas.filter(sha => !this.wipShas.has(sha))

    if (externals.length > 0 && this.wipShas.size === 0) {
      throw new MutationError([mutationDiagnostic(
        'error',
        `branch '${this.branch}' head moved since session start (base ${this.baseSha}) — discard the session and replay`,
      )])
    }

    let squashed = false
    let note: string | undefined
    if (externals.length === 0 && shas.length > 0) {
      // Guard holds: every commit since baseSha is a session WIP — squash.
      await this.source.commit(this.branch, serializeGraph(this.graph), msg, {
        replaceGraphContent: true,
        createBranchIfMissing: this.createBranch,
        parentSha: this.baseSha,
        force: true,
      })
      squashed = true
      note = 'WIP checkpoints squashed into a single commit'
    } else {
      await this.source.commit(this.branch, serializeGraph(this.graph), msg, {
        replaceGraphContent: true,
        createBranchIfMissing: this.createBranch,
      })
      if (externals.length > 0) note = 'WIP checkpoints preserved (external commit interleaved)'
    }

    this.discard()
    return { committed: true, message: msg, squashed, warnings, note }
  }

  // -- internals ------------------------------------------------------------

  private assertOpen(): void {
    if (this.closed) {
      throw new MutationError([mutationDiagnostic('error', 'working session is closed — start a new session')])
    }
  }

  private async record(op: string, args: Record<string, unknown>, summary: string): Promise<void> {
    this.journal.push({ op, args, summary })
    if (!this.autosave) return

    // Autosave checkpoint (design §7 table): file sources write through to
    // disk; git sources land a WIP checkpoint commit whose SHA is recorded
    // for the squash guard.
    await this.source.commit(this.branch, serializeGraph(this.graph), `corum-wip: ${summary}`, {
      replaceGraphContent: true,
      createBranchIfMissing: this.createBranch,
    })
    if (!this.isFileSource) {
      this.wipShas.add(await this.source.head(this.branch))
    }
  }

  private defaultCommitMessage(): string {
    const summaries = this.journal.map(entry => entry.summary)
    const MAX = 3
    const shown = summaries.slice(0, MAX).join('; ')
    const more = summaries.length > MAX ? ` (+${summaries.length - MAX} more)` : ''
    return `corum: ${shown}${more}`
  }

  /** Parse a root cluster document through the loader (same semantics as loading the YAML file). */
  private materialiseRoot(document: Record<string, unknown>): ClusterResult {
    return materialiseRootDocument(document, this.graph.templates)
  }

  /** Materialise one owned child (plus nested children) via the loader's machinery. */
  private materialiseChild(input: CreateNodeInput): ClusterResult {
    const { parentId, section, name, document } = input
    const errors: Diagnostic[] = []

    const parent = this.graph.nodesById.get(parentId!)
    if (!parent) {
      throw new MutationError([mutationDiagnostic('error', `cannot create node: parent not found: ${parentId}`, parentId)])
    }
    if (typeof section !== 'string' || typeof name !== 'string') {
      throw new MutationError([mutationDiagnostic('error', 'create node: owned-child creation requires section and name', parentId)])
    }
    const segmentError = validateSegment(name)
    if (segmentError) {
      throw new MutationError([mutationDiagnostic('error', `create node: ${segmentError}`, parentId)])
    }
    const template = this.graph.templates.get(parent.template)
    const ownedSections = template ? getOwnedSections(template) : {}
    if (!(section in ownedSections)) {
      throw new MutationError([mutationDiagnostic(
        'error',
        `template '${parent.template}' does not own a '${section}' section`,
        parentId,
      )])
    }

    const result: ClusterResult = { nodes: new Map(), edgesByFrom: new Map(), edgesByTo: new Map() }
    const diagnostics: Diagnostic[] = []
    materialiseChildren(
      result,
      parent,
      this.clusterRootOf(parent),
      { [section]: { [name]: document } },
      this.graph.templates,
      '<mutation>',
      diagnostics,
    )
    errors.push(...diagnostics.filter(d => d.severity === 'error'))
    if (errors.length > 0) throw new MutationError([...errors, ...diagnostics.filter(d => d.severity === 'warning')])
    return result
  }

  private clusterRootOf(node: Node): Node {
    let current = node
    while (current.parentId !== undefined) {
      const parent = this.graph.nodesById.get(current.parentId)
      if (!parent) break
      current = parent
    }
    return current
  }
}

// -- helpers ----------------------------------------------------------------

function validateStateStability(state: string | undefined, stability: string | undefined, errors: Diagnostic[]): void {
  if (state !== undefined && !VALID_STATE_SET.has(state)) {
    errors.push(mutationDiagnostic('error', `invalid state '${state}'`))
  }
  if (stability !== undefined && !VALID_STABILITY_SET.has(stability)) {
    errors.push(mutationDiagnostic('error', `invalid stability '${stability}'`))
  }
}

function applyPropertyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key]
    else target[key] = value
  }
}

function snapshotNodes(graph: Graph): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of graph.nodesById.values()) map.set(node.id, JSON.stringify(node))
  return map
}

function snapshotEdges(graph: Graph): Map<string, string> {
  const map = new Map<string, string>()
  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) map.set(edge.id, JSON.stringify(edge))
  }
  return map
}

function diffCounts(base: Map<string, string>, current: Map<string, string>): ChangeCounts {
  let added = 0
  let modified = 0
  let removed = 0
  for (const [id, value] of current) {
    const before = base.get(id)
    if (before === undefined) added++
    else if (before !== value) modified++
  }
  for (const id of base.keys()) {
    if (!current.has(id)) removed++
  }
  return { added, modified, removed }
}

