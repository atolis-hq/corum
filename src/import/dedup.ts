import type { Diagnostic, Edge, Node } from '../schema/index.js'
import type { DeduplicationRule } from './config.js'

export interface EntryResult {
  adapterId: string
  specPath: string
  nodes: Node[]
  edges: Edge[]
}

export interface DedupResult {
  results: EntryResult[]
  diagnostics: Diagnostic[]
}

export function deduplicateResults(
  results: EntryResult[],
  rules: DeduplicationRule[],
): DedupResult {
  const diagnostics: Diagnostic[] = []

  for (const rule of rules) {
    const primaryNodes = new Map<string, Node>()
    for (const r of results) {
      if (r.adapterId === rule.primary) {
        for (const node of r.nodes) primaryNodes.set(node.id, node)
      }
    }

    const primaryNodeIds = new Set<string>(primaryNodes.keys())

    const redirects = new Map<string, string>()

    // Phase 1a: x-aka matching
    for (const r of results) {
      if (r.adapterId !== rule.secondary) continue
      for (const node of r.nodes) {
        if (redirects.has(node.id)) continue

        const aka = node.properties['x-aka']
        if (Array.isArray(aka)) {
          const parts = node.id.split('.')
          const component = parts[0]
          const template = parts[1]
          for (const alias of aka as string[]) {
            const candidate = `${component}.${template}.${alias}`
            if (primaryNodes.has(candidate)) {
              redirects.set(node.id, candidate)
              break
            }
          }
        }
      }
    }

    // Phase 1b: collect raw same-ID collisions
    const rawSameIds: string[] = []
    for (const r of results) {
      if (r.adapterId !== rule.secondary) continue
      for (const node of r.nodes) {
        if (!redirects.has(node.id) && primaryNodes.has(node.id)) {
          rawSameIds.push(node.id)
        }
      }
    }

    // Phase 2: add only root collisions (those not covered by another collision)
    for (const nodeId of rawSameIds) {
      const coveredByRoot = rawSameIds.some(id => id !== nodeId && nodeId.startsWith(id + '.'))
      if (!coveredByRoot) {
        redirects.set(nodeId, nodeId)
        diagnostics.push({
          severity: 'warning',
          file: '',
          message: `Duplicate node ID from adapters ${rule.primary} and ${rule.secondary}: ${nodeId} — ${rule.secondary} node dropped`,
        })
      }
    }

    if (redirects.size === 0) continue

    for (const r of results) {
      r.edges = r.edges.flatMap(edge => {
        const rewritten = rewriteEdge(edge, redirects, primaryNodeIds)
        return rewritten === null ? [] : [rewritten]
      })
    }

    for (const r of results) {
      if (r.adapterId !== rule.secondary) continue
      r.nodes = r.nodes.filter(node => {
        if (redirects.has(node.id)) return false
        for (const secondaryId of redirects.keys()) {
          if (node.id.startsWith(secondaryId + '.')) return false
        }
        return true
      })
    }
  }

  for (const r of results) {
    for (const node of r.nodes) {
      delete node.properties['x-aka']
    }
  }

  return { results, diagnostics }
}

function rewriteEdge(edge: Edge, redirects: Map<string, string>, primaryNodeIds: Set<string>): Edge | null {
  const from = rewriteEndpoint(edge.from, redirects, primaryNodeIds)
  const to = rewriteEndpoint(edge.to, redirects, primaryNodeIds)
  if (from === null || to === null) return null
  if (from === edge.from && to === edge.to) return edge
  return { ...edge, from, to, id: `${from}__${edge.type}__${to}` }
}

function rewriteEndpoint(endpoint: string, redirects: Map<string, string>, primaryNodeIds: Set<string>): string | null {
  const exact = redirects.get(endpoint)
  if (exact !== undefined && exact !== endpoint) return exact

  for (const [secondaryId, primaryId] of redirects) {
    if (secondaryId === primaryId) continue
    const prefix = secondaryId + '.'
    if (endpoint.startsWith(prefix)) {
      const rewritten = primaryId + '.' + endpoint.slice(prefix.length)
      if (!primaryNodeIds.has(rewritten)) return null
      return rewritten
    }
  }

  return endpoint
}
