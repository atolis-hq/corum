import { isOwnedDescendant } from '../graph/index.js'
import type { Diagnostic, Edge, Node } from '../schema/index.js'
import type { DeduplicationRule } from './config.js'
import type { IdResolver } from './id-map.js'
import type { SourceId } from '../adapters/index.js'

export interface EntryResult {
  adapterId: string
  specPath: string
  nodes: Node[]
  edges: Edge[]
  /** Source-native and declared IDs this entry registered against its nodes. */
  sourceIds?: SourceId[]
}

export interface DedupResult {
  results: EntryResult[]
  diagnostics: Diagnostic[]
  /** Secondary node ID -> surviving node ID, for every node merged or carried by deduplication. */
  redirects: Map<string, string>
}

export function deduplicateResults(
  results: EntryResult[],
  rules: DeduplicationRule[],
  options: { edgeCasing?: 'preserve' | 'match'; isStructural?: (type: string) => boolean; idResolver?: IdResolver } = {},
): DedupResult {
  const diagnostics: Diagnostic[] = []
  const allRedirects = new Map<string, string>()

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
    // Secondary nodes merged because an ID map paired them with a primary node,
    // and the declared IDs of secondary nodes (used to match their fields).
    const mappedMerge = new Set<string>()
    const declared = new Map<string, string[]>()
    for (const r of results) {
      if (r.adapterId !== rule.secondary) continue
      for (const sid of r.sourceIds ?? []) declared.set(sid.target, [...(declared.get(sid.target) ?? []), sid.id])
    }
    const carried = new Map<string, { newId: string; parentId: string }>()

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

    // Phase 1a': ID-map pairing. A declared ID that an ID map resolves to a
    // primary node merges the declared node into it (only under a dedup rule).
    if (options.idResolver?.hasMaps) {
      for (const r of results) {
        if (r.adapterId !== rule.secondary) continue
        for (const node of r.nodes) {
          if (redirects.has(node.id)) continue
          const targets = new Set<string>()
          for (const id of declared.get(node.id) ?? []) {
            const res = options.idResolver.resolve(id, true)
            if (res.kind === 'resolved' && primaryNodes.has(res.target)) targets.add(res.target)
          }
          if (targets.size === 1) {
            redirects.set(node.id, [...targets][0])
            mappedMerge.add(node.id)
          } else if (targets.size > 1) {
            diagnostics.push({
              severity: 'warning', file: r.specPath,
              message: `ID map pairs ${node.id} with more than one ${rule.primary} node (${[...targets].sort().join(', ')}); not merged`,
            })
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
    // Field match through the map: `{declared id}#{field name}` for each ID the owner declares.
    function mappedField(owner: string, suffix: string): string | undefined {
      const resolver = options.idResolver
      if (!resolver?.hasMaps || !mappedMerge.has(owner)) return undefined
      const segments = suffix.split('.').filter(Boolean)
      const fieldName = segments.at(-1)
      if (segments.length !== 2 || fieldName === undefined) return undefined
      const ids = declared.get(owner) ?? declared.get(owner.split('.').slice(0, -2).join('.')) ?? []
      for (const id of ids) {
        const res = resolver.resolve(`${id}#${fieldName}`)
        if (res.kind === 'resolved' && primaryNodes.has(res.target)) return res.target
      }
      return undefined
    }

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
          const suffix = endpoint.slice(owner.length)
          const ownerIsMapped = parent !== null && mappedMerge.has(owner)
          resolved = parent === null ? null : mappedField(owner, suffix) ?? ownedTarget(parent, suffix)
          // Interchange schema refs expand the root's own contract into a
          // same-named schema child. Its primary counterpart is the root itself.
          const sourceOwner = secondaryGraph.nodesById.get(owner)
          if (resolved === null && ownerIsMapped && endpoint === owner + '.schemas.' + owner.split('.').at(-1)) {
            resolved = parent
          }
          if (resolved === null && parent !== null && node && sourceOwner
            && node.template === sourceOwner.template
            && endpoint === owner + '.schemas.' + owner.split('.').at(-1)) {
            resolved = parent
          }
        }
      }
      if (resolved === null && node && owner !== undefined && mappedMerge.has(owner)) {
        // The map paired the owner, but nothing on the primary matches this node:
        // keep it (reported, not lost) under the primary owner.
        const parent = resolve(owner)
        if (parent) {
          const newId = parent + endpoint.slice(owner.length)
          carried.set(endpoint, { newId, parentId: parent })
          diagnostics.push({
            severity: 'warning',
            file: '',
            message: `ID map merge of ${owner} into ${parent}: ${endpoint} has no match in the ${rule.primary} node; carried over as ${newId}`,
          })
          resolved = newId
        }
      }
      if (typeof resolved === 'string' && owner !== undefined && mappedMerge.has(owner)) mappedMerge.add(endpoint)
      resolving.delete(endpoint)
      if (resolved !== undefined) endpointRedirects.set(endpoint, resolved)
      return resolved
    }
    for (const node of secondaryGraph.nodesById.values()) {
      const target = resolve(node.id)
      if (target !== undefined) endpointRedirects.set(node.id, target)
    }
    for (const [from, to] of endpointRedirects) if (to !== null) allRedirects.set(from, to)

    for (const r of results) {
      r.edges = r.edges.flatMap(edge => {
        const fromResult = resolve(edge.from)
        const toResult = resolve(edge.to)
        const structural = options.isStructural?.(edge.type) ?? (edge.type === 'has-field' || edge.type === 'has-value')
        if (structural && fromResult !== undefined && toResult !== undefined && !carried.has(edge.to)) return []
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
        r.nodes = r.nodes.flatMap(node => {
          const c = carried.get(node.id)
          if (c) return [{ ...node, id: c.newId, parentId: c.parentId }]
          return endpointRedirects.has(node.id) ? [] : [node]
        })
      }
    }
  }

  for (const r of results) {
    for (const node of r.nodes) {
      delete node.properties['x-aka']
    }
  }

  return { results, diagnostics, redirects: allRedirects }
}
