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
  options: { edgeCasing?: 'preserve' | 'match'; isStructural?: (type: string) => boolean } = {},
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

    const endpointRedirects = new Map<string, string | null>()
    const resolving = new Set<string>()
    function ownedTarget(owner: string, suffix: string): string | null {
      const candidate = owner + suffix
      const target = primaryNodes.get(candidate)
      if (target) return target.parentId === owner ? candidate : null
      if (options.edgeCasing !== 'match') return null
      const matches = [...primaryNodes.values()].filter(node => node.parentId === owner
        && node.id.toLowerCase() === candidate.toLowerCase())
      return matches.length === 1 ? matches[0].id : null
    }

    // Follow explicit ownership first. For absent endpoints, peel one section/name
    // pair at a time until reaching a known owner. This is independent of edge order.
    function resolve(endpoint: string): string | null | undefined {
      if (endpointRedirects.has(endpoint)) return endpointRedirects.get(endpoint)!
      if (redirects.has(endpoint)) return redirects.get(endpoint)!
      if (resolving.has(endpoint)) return undefined
      resolving.add(endpoint)
      const node = secondaryGraph.nodesById.get(endpoint)
      const parts = endpoint.split('.')
      const owner = node ? node.parentId : parts.length > 4 ? parts.slice(0, -2).join('.') : undefined
      let resolved: string | null | undefined
      if (owner !== undefined) {
        const parent = resolve(owner)
        if (parent !== undefined) {
          resolved = parent === null ? null : ownedTarget(parent, endpoint.slice(owner.length))
          // Interchange schema refs expand the root's own contract into a
          // same-named schema child. Its primary counterpart is the root itself.
          const sourceOwner = secondaryGraph.nodesById.get(owner)
          if (resolved === null && parent !== null && node && sourceOwner
            && node.template === sourceOwner.template
            && endpoint === owner + '.schemas.' + owner.split('.').at(-1)) {
            resolved = parent
          }
        }
      }
      resolving.delete(endpoint)
      if (resolved !== undefined) endpointRedirects.set(endpoint, resolved)
      return resolved
    }
    for (const node of secondaryGraph.nodesById.values()) {
      const target = resolve(node.id)
      if (target !== undefined) endpointRedirects.set(node.id, target)
    }

    for (const r of results) {
      r.edges = r.edges.flatMap(edge => {
        const fromResult = resolve(edge.from)
        const toResult = resolve(edge.to)
        const structural = options.isStructural?.(edge.type) ?? (edge.type === 'has-field' || edge.type === 'has-value')
        if (structural && fromResult !== undefined && toResult !== undefined) return []
        const from = fromResult === undefined ? edge.from : fromResult
        const to = toResult === undefined ? edge.to : toResult
        if (from === null || to === null) {
          const unresolved = [from === null ? edge.from : undefined, to === null ? edge.to : undefined]
            .filter(endpoint => endpoint !== undefined)
          diagnostics.push({
            severity: 'warning',
            file: r.specPath,
            message: `Deduplication dropped edge ${edge.id} (${edge.from} — ${edge.type} → ${edge.to}): no matching primary node for ${unresolved.join(', ')}`,
          })
          return []
        }
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
