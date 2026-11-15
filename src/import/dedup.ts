import { isOwnedDescendant } from '../graph/index.js'
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

    const secondaryGraph = {
      nodesById: new Map(results
        .filter(result => result.adapterId === rule.secondary)
        .flatMap(result => result.nodes.map(node => [node.id, node] as const))),
    }

    const primaryGraph = { nodesById: primaryNodes }

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
      const coveredByRoot = rawSameIds.some(id => isOwnedDescendant(secondaryGraph, nodeId, id))
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

    // Build exact endpoint mappings from ownership before dropping secondary nodes.
    // Prefix replacement derives the new spelling only after ownership is known.
    const endpointRedirects = new Map<string, string | null>()
    for (const node of secondaryGraph.nodesById.values()) {
      let current: Node | undefined = node
      const seen = new Set<string>()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        const primaryId = redirects.get(current.id)
        if (primaryId !== undefined) {
          const rewritten = primaryId + node.id.slice(current.id.length)
          const targetExists = primaryNodes.has(rewritten)
            && (node.id === current.id || isOwnedDescendant(primaryGraph, rewritten, primaryId))
          endpointRedirects.set(node.id, primaryId === current.id || targetExists ? rewritten : null)
          break
        }
        current = current.parentId === undefined ? undefined : secondaryGraph.nodesById.get(current.parentId)
      }
    }

    for (const r of results) {
      r.edges = r.edges.flatMap(edge => {
        const from = endpointRedirects.has(edge.from) ? endpointRedirects.get(edge.from)! : edge.from
        const to = endpointRedirects.has(edge.to) ? endpointRedirects.get(edge.to)! : edge.to
        if (from === null || to === null) return []
        if (from === edge.from && to === edge.to) return [edge]
        return [{ ...edge, from, to, id: `${from}__${edge.type}__${to}` }]
      })
      if (r.adapterId === rule.secondary) {
        r.nodes = r.nodes.filter(node => !endpointRedirects.has(node.id))
      }
    }
  }

  for (const r of results) {
    for (const node of r.nodes) {
      delete node.properties['x-aka']
    }
  }

  return { results, diagnostics }
}
