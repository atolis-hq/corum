import { stringify as stringifyYaml } from 'yaml'
import type { Diagnostic, Graph, Node, Stability, State, Template } from '../schema/index.js'
import { loadClusters, materialiseChildren } from '../loader/cluster-loader.js'
import type { ClusterResult } from '../loader/cluster-loader.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import { VALID_STABILITY_SET, VALID_STATE_SET } from '../loader/constants.js'
import { lintNode } from '../linter/index.js'
import { detectPossibleRenames } from '../reconcile/index.js'
import { MutationError } from './errors.js'
import { deleteNode } from './delete.js'
import { findEdgeById, insertEdgeIntoIndexes, mutationDiagnostic, mutationTimestamp } from './util.js'

/**
 * `apply_cluster` (design §8/§14f): upsert a cluster-style nested document —
 * the same shape as cluster YAML (root node plus owned sections keyed by
 * child local name, child properties flattened at the top level).
 *
 * Diffed against the working graph per owned section, matched by local name:
 * present in both → update; only in the document → create; only in the graph
 * → delete via §6 semantics (`replace` mode only). `merge` never touches
 * absent children or absent sections; in `replace` an absent owned section
 * means an EMPTY section — every child is deleted. Sections the template does
 * not declare as owned are never touched.
 *
 * A changed key is NEVER a rename: it is delete+add, and the outcome carries
 * the §6a possible-rename heuristic warning (mirrors the import reconciler).
 *
 * Validate-before-apply: all planning is pure reads; a MutationError is
 * thrown before the first write, leaving the graph untouched.
 */

export type ApplyClusterMode = 'merge' | 'replace'

export interface ApplyClusterOutcome {
  rootId: string
  createdIds: string[]
  updatedIds: string[]
  deleted: Array<{ id: string; tier: 'soft' | 'hard' }>
  warnings: Diagnostic[]
}

interface PlannedUpdate {
  node: Node
  properties: Record<string, unknown>
  corum?: Node['corum']
  state?: State
  stability?: Stability
}

interface Plan {
  errors: Diagnostic[]
  creates: Array<{ result: ClusterResult; topNode: Node }>
  updates: PlannedUpdate[]
  deletes: Node[]
}

export function applyClusterToGraph(
  graph: Graph,
  document: Record<string, unknown>,
  mode: ApplyClusterMode,
  defaultBranchIds: Set<string>,
): ApplyClusterOutcome {
  if (mode !== 'merge' && mode !== 'replace') {
    throw new MutationError([mutationDiagnostic('error', `apply_cluster: mode must be 'merge' or 'replace', got '${String(mode)}'`)])
  }
  const rootId = document.id
  if (typeof rootId !== 'string') {
    throw new MutationError([mutationDiagnostic('error', 'apply_cluster: document requires a string id')])
  }

  const plan: Plan = { errors: [], creates: [], updates: [], deletes: [] }
  const root = graph.nodesById.get(rootId)

  if (!root) {
    // New root: the whole document is a create (same path as create_node roots).
    const result = materialiseRootDocument(document, graph.templates)
    const topNode = result.nodes.get(rootId)
    if (!topNode) {
      throw new MutationError([mutationDiagnostic('error', `apply_cluster: document did not materialise root '${rootId}'`, rootId)])
    }
    for (const nodeId of result.nodes.keys()) {
      if (graph.nodesById.has(nodeId)) {
        plan.errors.push(mutationDiagnostic('error', `node already exists: ${nodeId}`, nodeId))
      }
    }
    plan.creates.push({ result, topNode })
  } else {
    if (typeof document.template === 'string' && document.template !== root.template) {
      throw new MutationError([mutationDiagnostic(
        'error',
        `apply_cluster: cannot change template of ${rootId} from '${root.template}' to '${document.template}' — delete and recreate instead`,
        rootId,
      )])
    }
    planNode(graph, plan, mode, root, document, true)
  }

  if (plan.errors.length > 0) throw new MutationError(plan.errors)

  // -- apply (deletes → creates → updates; the name sets are disjoint) --------
  const deleted: Array<{ id: string; tier: 'soft' | 'hard' }> = []
  for (const node of plan.deletes) {
    const result = deleteNode(graph, node.id, {}, defaultBranchIds)
    deleted.push({ id: node.id, tier: result.tier })
  }

  const timestamp = mutationTimestamp()
  const createdIds: string[] = []
  for (const { result } of plan.creates) {
    for (const node of result.nodes.values()) {
      node.lastModifiedAt = timestamp
      graph.nodesById.set(node.id, node)
      createdIds.push(node.id)
    }
    for (const edges of result.edgesByFrom.values()) {
      for (const edge of edges) {
        if (!findEdgeById(graph, edge.id)) insertEdgeIntoIndexes(graph, edge)
      }
    }
  }

  const updatedIds: string[] = []
  for (const update of plan.updates) {
    update.node.properties = update.properties
    update.node.corum = update.corum
    if (update.state !== undefined) update.node.state = update.state
    if (update.stability !== undefined) update.node.stability = update.stability
    update.node.lastModifiedAt = timestamp
    updatedIds.push(update.node.id)
  }

  // -- warnings ----------------------------------------------------------------
  const warnings: Diagnostic[] = []
  for (const { result } of plan.creates) {
    for (const node of result.nodes.values()) {
      warnings.push(...lintNode(graph, node).filter(d => d.severity === 'warning'))
    }
  }
  for (const update of plan.updates) {
    warnings.push(...lintNode(graph, update.node).filter(d => d.severity === 'warning'))
  }
  // §6a heuristic, mirrored from the import reconciler: a delete plus a create
  // with the same template under the same parent suggests an unrecorded rename.
  warnings.push(...detectPossibleRenames(
    { toAdd: plan.creates.map(c => c.topNode), toUpdate: [], toRemove: plan.deletes },
    '<mutation>',
  ))

  return { rootId, createdIds, updatedIds, deleted, warnings }
}

/**
 * Plan updates/creates/deletes for `node` against its cluster-style `doc`
 * record, recursing into owned sections. Pure — collects into `plan` only.
 */
function planNode(
  graph: Graph,
  plan: Plan,
  mode: ApplyClusterMode,
  node: Node,
  doc: Record<string, unknown>,
  isRoot: boolean,
): void {
  const template = graph.templates.get(node.template)
  const ownedSections = template ? getOwnedSections(template) : {}
  const ownedSectionNames = new Set(Object.keys(ownedSections))

  // state/stability: root documents carry them under metadata (cluster YAML)
  // or at the top level; children carry them at the top level.
  const meta = isRoot && isRecord(doc.metadata) ? doc.metadata : undefined
  const state = readEnum<State>(doc.state ?? meta?.state, VALID_STATE_SET, 'state', node.id, plan.errors)
  const stability = readEnum<Stability>(doc.stability ?? meta?.stability, VALID_STABILITY_SET, 'stability', node.id, plan.errors)

  // Properties: roots use the explicit `properties:` block; children flatten
  // property keys at the top level (everything except state/stability and
  // owned-section keys — loader semantics).
  const docProps = isRoot
    ? (isRecord(doc.properties) ? doc.properties : undefined)
    : Object.fromEntries(Object.entries(doc).filter(([key]) =>
        !ownedSectionNames.has(key) && key !== 'state' && key !== 'stability'))

  let newProps: Record<string, unknown>
  let newCorum: Node['corum'] | undefined
  if (mode === 'merge') {
    newProps = { ...node.properties }
    if (docProps) {
      for (const [key, value] of Object.entries(docProps)) {
        if (value === null) delete newProps[key]
        else newProps[key] = value
      }
    }
    newCorum = node.corum
  } else {
    newProps = { ...(docProps ?? {}) }
    newCorum = node.corum
  }

  const changed =
    JSON.stringify(newProps) !== JSON.stringify(node.properties) ||
    JSON.stringify(newCorum) !== JSON.stringify(node.corum) ||
    (state !== undefined && state !== node.state) ||
    (stability !== undefined && stability !== node.stability)
  if (changed) {
    plan.updates.push({ node, properties: newProps, corum: newCorum, state, stability })
  }

  // -- owned sections ----------------------------------------------------------
  for (const sectionName of ownedSectionNames) {
    const docSection = doc[sectionName]
    const sectionPrefix = `${node.id}.${sectionName}.`
    const graphChildren = sectionChildren(graph, node.id, sectionPrefix)

    if (docSection === undefined) {
      // merge: absent section untouched; replace: absent section = empty section.
      if (mode === 'replace') plan.deletes.push(...graphChildren)
      continue
    }
    if (!isRecord(docSection)) {
      plan.errors.push(mutationDiagnostic('error', `apply_cluster: section '${sectionName}' of ${node.id} must be an object of named children`, node.id))
      continue
    }

    for (const [localName, value] of Object.entries(docSection)) {
      if (!isRecord(value)) {
        plan.errors.push(mutationDiagnostic('error', `apply_cluster: child '${localName}' in ${sectionName} of ${node.id} must be an object`, node.id))
        continue
      }
      const childId = `${sectionPrefix}${localName}`
      const existing = graph.nodesById.get(childId)
      if (existing) {
        planNode(graph, plan, mode, existing, value, false)
      } else {
        planCreateChild(graph, plan, node, sectionName, localName, value)
      }
    }

    if (mode === 'replace') {
      for (const child of graphChildren) {
        const localName = child.id.slice(sectionPrefix.length)
        if (!(localName in docSection)) plan.deletes.push(child)
      }
    }
  }
}

/** Materialise a new owned child (plus nested children) purely into the plan. */
function planCreateChild(
  graph: Graph,
  plan: Plan,
  parent: Node,
  sectionName: string,
  localName: string,
  value: Record<string, unknown>,
): void {
  const result: ClusterResult = { nodes: new Map(), edgesByFrom: new Map(), edgesByTo: new Map() }
  const diagnostics: Diagnostic[] = []
  materialiseChildren(
    result,
    parent,
    clusterRootOf(graph, parent),
    { [sectionName]: { [localName]: value } },
    graph.templates,
    '<mutation>',
    diagnostics,
  )
  plan.errors.push(...diagnostics.filter(d => d.severity === 'error'))

  const childId = `${parent.id}.${sectionName}.${localName}`
  const topNode = result.nodes.get(childId)
  for (const nodeId of result.nodes.keys()) {
    if (graph.nodesById.has(nodeId)) {
      plan.errors.push(mutationDiagnostic('error', `node already exists: ${nodeId}`, nodeId))
    }
  }
  if (topNode) plan.creates.push({ result, topNode })
}

/**
 * Parse a root cluster document through the loader — the exact semantics of
 * loading the equivalent YAML file (structural edges, defaults, owned-child
 * materialisation). Shared by `createNode` and `applyCluster`.
 */
export function materialiseRootDocument(
  document: Record<string, unknown>,
  templates: Map<string, Template>,
): ClusterResult {
  const doc: Record<string, unknown> = { ...document }
  const id = doc.id
  if (typeof id !== 'string') {
    throw new MutationError([mutationDiagnostic('error', 'create node: root document requires a string id')])
  }
  if (typeof doc.template !== 'string') {
    throw new MutationError([mutationDiagnostic('error', `create node: document for ${id} requires a template`, id)])
  }
  if (typeof doc.schemaVersion !== 'string') doc.schemaVersion = '1.0'
  const metadata: Record<string, unknown> = isRecord(doc.metadata) ? { ...doc.metadata } : {}
  if (typeof metadata.component !== 'string') metadata.component = id.split('.')[0]
  if (typeof metadata.lastModifiedAt !== 'string') metadata.lastModifiedAt = mutationTimestamp()
  doc.metadata = metadata

  const parts = id.split('.')
  if (parts.length < 3) {
    throw new MutationError([mutationDiagnostic(
      'error',
      `create node: '${id}' is not a valid cluster root id (component.Template.name)`,
      id,
    )])
  }
  const filePath = `components/${parts[0]}/${parts[1]}s/${parts.slice(2).join('/')}.yaml`

  const diagnostics: Diagnostic[] = []
  const result = loadClusters(new Map([[filePath, stringifyYaml(doc)]]), templates, diagnostics)
  if (diagnostics.some(d => d.severity === 'error')) throw new MutationError(diagnostics)
  return result
}

// -- helpers ----------------------------------------------------------------

/** Direct children of `parentId` in one owned section (exactly one extra segment). */
function sectionChildren(graph: Graph, parentId: string, sectionPrefix: string): Node[] {
  const children: Node[] = []
  for (const node of graph.nodesById.values()) {
    if (node.parentId !== parentId) continue
    if (!node.id.startsWith(sectionPrefix)) continue
    if (node.id.slice(sectionPrefix.length).includes('.')) continue
    children.push(node)
  }
  return children
}

function clusterRootOf(graph: Graph, node: Node): Node {
  let current = node
  while (current.parentId !== undefined) {
    const parent = graph.nodesById.get(current.parentId)
    if (!parent) break
    current = parent
  }
  return current
}

function readEnum<T extends string>(
  value: unknown,
  valid: Set<string>,
  label: string,
  nodeId: string,
  errors: Diagnostic[],
): T | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && valid.has(value)) return value as T
  errors.push(mutationDiagnostic('error', `invalid ${label} '${String(value)}'`, nodeId))
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
