import type { Node } from '../schema/index.js'

export interface DiffResult {
  toAdd: Node[]
  toUpdate: Node[]
  toRemove: Node[]
}

const HUMAN_OWNED = new Set(['state', 'stability', 'notes'])

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
    const humanValues = Object.fromEntries(
      Object.entries(current).filter(([k]) => HUMAN_OWNED.has(k)),
    )
    return { ...incoming, ...humanValues }
  }
  return { ...current, ...incoming }
}

function nodesEqual(a: Node, b: Node): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
