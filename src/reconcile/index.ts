import type { Diagnostic, Edge, Graph, Node } from '../schema/index.js'
import { resolveAlias } from '../mutate/alias.js'

export interface DiffResult {
  toAdd: Node[]
  toUpdate: Node[]
  toRemove: Node[]
}

export interface AliasResolutionResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

/**
 * Properties preserved across `derivation: determined` re-imports. Holds both
 * human-owned keys (state, stability, notes) and system-owned bookkeeping
 * (`corum.identity.previousIds` rename trail, design §6a) — a re-import must never erase
 * rename history.
 */
const PRESERVED_PROPERTIES = new Set(['state', 'stability', 'notes'])

export function diffNodes(
  incoming: Node[],
  existing: Map<string, Node>,
  specPath: string,
): DiffResult {
  const toAdd: Node[] = []
  const toUpdate: Node[] = []
  const incomingIds = new Set(incoming.map(n => n.id))

  for (const node of incoming) {
    const current = existing.get(node.id)
    if (!current) {
      toAdd.push(node)
      continue
    }

    const merged: Node = {
      ...current,
      properties: mergeProperties(current.properties, node.properties, node.derivation),
      corum: mergeCorum(current.corum, node.corum, node.derivation),
      extractedFrom: node.extractedFrom,
      derivation: node.derivation,
      derivedBy: node.derivedBy,
      lastModifiedAt: node.lastModifiedAt,
      state: current.state,
      stability: current.stability,
    }

    if (!nodesEqual(current, merged)) {
      toUpdate.push(merged)
    }
  }

  const toRemove: Node[] = []
  for (const [id, node] of existing) {
    if (node.extractedFrom === specPath && !incomingIds.has(id)) {
      toRemove.push({ ...node, state: 'removed' })
    }
  }

  return { toAdd, toUpdate, toRemove }
}

function mergeProperties(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  derivation: string | undefined,
): Record<string, unknown> {
  if (derivation === 'determined') {
    const preservedValues = Object.fromEntries(
      Object.entries(current).filter(([k]) => PRESERVED_PROPERTIES.has(k)),
    )
    return { ...incoming, ...preservedValues }
  }
  return { ...current, ...incoming }
}

function nodesEqual(a: Node, b: Node): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function mergeCorum(
  current: Node['corum'] | undefined,
  incoming: Node['corum'] | undefined,
  derivation: string | undefined,
): Node['corum'] | undefined {
  if (derivation === 'determined' && current?.identity?.previousIds !== undefined && incoming?.identity?.previousIds === undefined) {
    return {
      ...(incoming ?? {}),
      identity: {
        ...(incoming?.identity ?? {}),
        previousIds: current.identity.previousIds,
      },
    }
  }
  return incoming ?? current
}

/**
 * Design §6a / §14d: pass every incoming node ID through the working graph's
 * alias map immediately before `diffNodes`, so a spec still using a retired
 * name merges into the renamed node instead of appearing as add+remove.
 *
 * - Descendant IDs resolve through the alias map's longest-prefix rule; their
 *   `parentId`s are rewritten via the same mapping.
 * - The name difference is reported as intentional in-flight drift — one
 *   warning per rewritten subtree root, not per descendant.
 * - Ambiguity rule (§14d): when the batch contains both a literal ID X and
 *   another ID that resolves to X, the literal one stays authoritative — the
 *   resolution is skipped and a warning names both.
 */
export function resolveIncomingAliases(
  graph: Graph,
  aliasMap: Map<string, string>,
  incoming: Node[],
  incomingEdges: Edge[],
  specPath: string,
): AliasResolutionResult {
  if (aliasMap.size === 0) return { nodes: incoming, edges: incomingEdges, diagnostics: [] }

  const diagnostics: Diagnostic[] = []
  const literalIds = new Set(incoming.map(n => n.id))
  const idMap = new Map<string, string>()

  for (const node of incoming) {
    const resolved = resolveAlias(graph, aliasMap, node.id)
    if (resolved === node.id) continue
    if (literalIds.has(resolved)) {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        nodeId: node.id,
        message: `ambiguous alias: incoming '${node.id}' resolves to '${resolved}', which is also present literally in this import — keeping the literal node authoritative and skipping the resolution`,
      })
      continue
    }
    idMap.set(node.id, resolved)
  }

  if (idMap.size === 0) return { nodes: incoming, edges: incomingEdges, diagnostics }

  const nodes = incoming.map(node => {
    const resolved = idMap.get(node.id)
    const resolvedParent = node.parentId !== undefined ? idMap.get(node.parentId) : undefined
    if (resolved === undefined && resolvedParent === undefined) return node
    return {
      ...node,
      id: resolved ?? node.id,
      ...(resolvedParent !== undefined ? { parentId: resolvedParent } : {}),
    }
  })

  // Rewrite edge endpoints that reference rewritten incoming nodes, and
  // recompute edge IDs ({from}__{type}__{to}).
  const edges = incomingEdges.map(edge => {
    const from = idMap.get(edge.from)
    const to = idMap.get(edge.to)
    if (from === undefined && to === undefined) return edge
    const newFrom = from ?? edge.from
    const newTo = to ?? edge.to
    return { ...edge, from: newFrom, to: newTo, id: `${newFrom}__${edge.type}__${newTo}` }
  })

  // In-flight drift: report per rewritten subtree root (a rewritten node whose
  // parent was not itself rewritten), so a renamed schema yields one entry.
  for (const node of incoming) {
    const resolved = idMap.get(node.id)
    if (resolved === undefined) continue
    if (node.parentId !== undefined && idMap.has(node.parentId)) continue
    diagnostics.push({
      severity: 'warning',
      file: specPath,
      nodeId: resolved,
      message: `in-flight drift: spec still uses '${node.id}', which was renamed to '${resolved}' — merged into the renamed node (update the spec to match)`,
    })
  }

  return { nodes, edges, diagnostics }
}

/**
 * Design §6a: rename suggestion heuristic (warning only). When a single
 * re-import both removes a node and adds another under the same parent with
 * the same template, suggest recording the rename explicitly. No automatic
 * action — renames stay explicit via rename_node.
 */
export function detectPossibleRenames(diff: DiffResult, specPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const addedByGroup = new Map<string, Node[]>()
  const groupKey = (node: Node) => `${node.template}|${node.parentId ?? node.component}`

  for (const added of diff.toAdd) {
    const key = groupKey(added)
    addedByGroup.set(key, [...(addedByGroup.get(key) ?? []), added])
  }

  for (const removed of diff.toRemove) {
    const candidates = addedByGroup.get(groupKey(removed))
    if (!candidates?.length) continue
    const names = candidates.map(n => `'${n.id}'`).join(', ')
    diagnostics.push({
      severity: 'warning',
      file: specPath,
      nodeId: removed.id,
      message: `possible rename: '${removed.id}' was removed and ${names} added under the same parent with the same template — if this is a rename, record it with rename_node`,
    })
  }

  return diagnostics
}
