import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import { loadGraph } from '../loader/index.js'
import { isStructuralEdgeType } from '../graph/index.js'
import { serializeGraph } from '../writer/graph-writer.js'
import { getAdapter } from '../adapters/index.js'
import { reconcileEdges, diffNodes, detectPossibleRenames, resolveIncomingAliases } from '../reconcile/index.js'
import { buildAliasMap } from '../mutate/alias.js'
import { deduplicateResults } from './dedup.js'
import type { EntryResult } from './dedup.js'
import { buildExistingSchemaIndex, detectSchemaPromotions, rewritePromotedSchemaEdges } from './schema-promotion.js'
import { resolveEdgeCasing } from './edge-casing.js'
import { specKey } from './spec-key.js'
import { IdResolver, loadIdMaps } from './id-map.js'
import type { IdMapSummary } from './id-map.js'
import type { DeferredRef } from '../adapters/index.js'
import type { ImportConfig } from './config.js'
import type { AdapterPackConfig } from '../adapters/index.js'
import type { Diagnostic } from '../schema/index.js'
import type { ContentMap } from '../source/index.js'
import type { GraphRuntimeConfig } from '../source/config.js'

export interface RunResult {
  diagnostics: Diagnostic[]
  /** Per-rule/exact-entry resolution counts when `idMaps` are configured. */
  idMapSummary?: IdMapSummary
}

export interface RunImportOptions {
  /** Target branch to commit the import to. Defaults to the source's default branch. */
  branch?: string
}

export async function runImport(
  config: ImportConfig,
  runtimeConfig: GraphRuntimeConfig,
  options: RunImportOptions = {},
): Promise<RunResult> {
  const allDiagnostics: Diagnostic[] = []
  const source = runtimeConfig.source
  const defaultBranch = await source.defaultBranch()
  const targetBranch = options.branch ?? defaultBranch

  if (runtimeConfig.kind === 'git' && targetBranch === defaultBranch) {
    return {
      diagnostics: [{
        severity: 'error',
        file: runtimeConfig.graphPath,
        message: `git sources are read-only on the default branch '${defaultBranch}' — pass --branch <name> to import into a design branch`,
      }],
    }
  }

  let idMaps: ReturnType<typeof loadIdMaps>
  try {
    idMaps = loadIdMaps(config.idMaps ?? [])
  } catch (err) {
    return { diagnostics: [{ severity: 'error', file: '', message: err instanceof Error ? err.message : String(err) }] }
  }

  let targetBranchExists = targetBranch === defaultBranch
  if (!targetBranchExists) {
    try {
      targetBranchExists = (await source.listBranches()).includes(targetBranch)
    } catch {
      targetBranchExists = false
    }
  }

  // Diff against the branch we are importing into, so repeated imports to the
  // same design branch stay idempotent; a new branch starts from the default.
  const graph = await loadGraph({ source, ref: targetBranchExists ? targetBranch : defaultBranch, strict: false })
  const targetLoadErrors = graph.diagnostics.filter(d => d.severity === 'error')
  allDiagnostics.push(...targetLoadErrors)

  // ADR-009b: snapshot of node identities before this run, and the shared
  // reuse-before-inline index (target graph + same-run entries as they land).
  const priorNodes = new Map(graph.nodesById)
  const existingSchemas = buildExistingSchemaIndex(graph)

  const nodeRefs = {
    ids: new Set([...graph.nodesById.values()].filter(n => n.state !== 'removed').map(n => n.id)),
    aliases: buildAliasMap(graph),
  }

  const entryResults: EntryResult[] = []
  const deferredByEntry = new Map<EntryResult, DeferredRef[]>()
  // Source-native and declared IDs registered this run (not persisted). The
  // resolver reads these and `liveIds` lazily, so it sees the state at call time.
  const sourceIdIndex = new Map<string, Set<string>>()
  let liveIds: ReadonlySet<string> = nodeRefs.ids
  const idAliases = buildAliasMap(graph)
  const idResolver = new IdResolver({
    hasNode: id => liveIds.has(id),
    aliases: idAliases,
    sourceIds: sourceIdIndex,
    maps: idMaps,
  })

  for (const entry of config.imports) {
    const packConfig = await loadPackAdapterConfig(runtimeConfig, entry.adapter)
    if (!packConfig) {
      allDiagnostics.push({
        severity: 'error',
        file: runtimeConfig.graphPath,
        message: `No ${entry.adapter} adapter config found in active packs — is the ${entry.adapter === 'openapi' ? 'rest' : entry.adapter} pack active?`,
      })
      continue
    }

    const absSpec = path.resolve(entry.spec)
    const specPath = specKey(entry.spec)
    const resolvedEntry = { ...entry, spec: absSpec }
    const adapter = getAdapter(resolvedEntry.adapter)
    const result = await adapter.import(resolvedEntry, {
      packConfig,
      templates: graph.templates,
      edgeTypes: graph.edgeTypes,
      componentNameReplacements: config.componentNameReplacements ?? [],
      existingSchemas,
      ownedSchemaIds: new Set([...graph.nodesById.values()]
        .filter(n => n.extractedFrom !== undefined && specKey(n.extractedFrom) === specPath)
        .map(n => n.id)),
      nodeRefs,
    })
    allDiagnostics.push(...result.diagnostics)

    if (result.diagnostics.some(d => d.severity === 'error')) continue

    const nodes = result.nodes.map(n => (n.extractedFrom === absSpec ? { ...n, extractedFrom: specPath } : n))
    const entryResult: EntryResult = { adapterId: entry.adapter, specPath, nodes, edges: result.edges, sourceIds: result.sourceIds }
    entryResults.push(entryResult)
    if (result.deferredRefs?.length) deferredByEntry.set(entryResult, result.deferredRefs)
    for (const sid of result.sourceIds ?? []) {
      const targets = sourceIdIndex.get(sid.id) ?? new Set<string>()
      targets.add(sid.target)
      sourceIdIndex.set(sid.id, targets)
    }
    // Only successful earlier entries contribute identities to later adapters.
    for (const node of nodes) {
      if (node.state !== 'removed') nodeRefs.ids.add(node.id)
    }
  }

  // x-aka is transient: always stripped after import, even with no dedup rules.
  let dedupRedirects = new Map<string, string>()
  {
    // Merged-away nodes still count as live while dedup pairs declared IDs with primaries.
    liveIds = new Set([...nodeRefs.ids, ...entryResults.flatMap(er => er.nodes.map(n => n.id))])
    const { results: deduped, diagnostics, redirects } = deduplicateResults(entryResults, config.deduplication ?? [], {
      edgeCasing: config.edgeCasing,
      isStructural: type => isStructuralEdgeType(graph, type),
      idResolver,
    })
    allDiagnostics.push(...diagnostics)
    entryResults.splice(0, entryResults.length, ...deduped)
    dedupRedirects = redirects
  }

  // Design §6a: resolve incoming IDs through the target graph's rename-trail
  // alias map before diffing, so specs still using retired names merge into
  // the renamed nodes (reported as in-flight drift, not add+remove).
  const aliasMap = idAliases
  for (const er of entryResults) {
    const { nodes, edges, diagnostics } = resolveIncomingAliases(graph, aliasMap, er.nodes, er.edges, er.specPath)
    er.nodes = nodes
    er.edges = edges
    allDiagnostics.push(...diagnostics)
  }

  // ID resolution post-pass: runs once every adapter has finished (and dedup
  // has settled), so mapped references see nodes created earlier in this run.
  // A reference only resolves; no node is declared, merged or dropped here.
  {
    const live = new Set([...graph.nodesById.values()].filter(n => n.state !== 'removed').map(n => n.id))
    for (const er of entryResults) for (const n of er.nodes) if (n.state !== 'removed') live.add(n.id)
    liveIds = live
    const followRedirect = (id: string): string => {
      let cur = id
      for (let i = 0; i < 8; i++) {
        const next = dedupRedirects.get(cur) ?? aliasMap.get(cur)
        if (next === undefined || next === cur) break
        cur = next
      }
      return cur
    }
    // Retarget registered IDs of nodes that dedup merged away.
    for (const [id, targets] of sourceIdIndex) {
      sourceIdIndex.set(id, new Set([...targets].map(followRedirect)))
    }
    const reported = new Set<string>()
    const resolveRef = (ref: string, file: string, context: string): string | undefined => {
      const res = idResolver.resolve(ref)
      if (res.kind === 'resolved') return res.target
      if (res.kind === 'ambiguous' && !reported.has(ref)) {
        reported.add(ref)
        allDiagnostics.push({ severity: 'warning', file, message: `Ambiguous reference ${context}: ${res.message}; not resolved` })
      }
      return undefined
    }

    for (const er of entryResults) {
      // Field/mapping $refs left as type-string fallbacks during mapping.
      for (const deferred of deferredByEntry.get(er) ?? []) {
        const nodeId = followRedirect(deferred.nodeId)
        const idx = er.nodes.findIndex(n => n.id === nodeId)
        // Bare Corum IDs resolve only from the target graph and earlier entries (decided while
        // mapping); a node of a later entry stays a warned fallback. Only mapped/source IDs get a retry.
        if (live.has(deferred.ref) || aliasMap.has(deferred.ref)) continue
        const res = idResolver.resolve(deferred.ref)
        if (res.kind === 'resolved' && idx !== -1) {
          const { type: _type, ...rest } = er.nodes[idx].properties
          er.nodes[idx] = { ...er.nodes[idx], properties: { ...rest, $ref: res.target } }
          // The adapter's "not found" warning no longer applies.
          const at = allDiagnostics.findIndex(d => d.file === deferred.file && d.message === deferred.message)
          if (at !== -1) allDiagnostics.splice(at, 1)
        } else if (res.kind === 'ambiguous') {
          allDiagnostics.push({
            severity: 'warning', file: deferred.file,
            message: `Field '${deferred.owner}' reference '${deferred.ref}' is ambiguous (${res.message}); falling back to type string`,
          })
        }
      }

      // Edge endpoints that are not nodes (source-native IDs, mapped IDs).
      const seen = new Set<string>()
      er.edges = er.edges.flatMap(edge => {
        const isLive = (id: string) => live.has(id) || aliasMap.has(id)
        let { from, to } = edge
        if (!isLive(from)) from = resolveRef(from, er.specPath, `edge endpoint of ${edge.id}`) ?? from
        if (!isLive(to)) to = resolveRef(to, er.specPath, `edge endpoint of ${edge.id}`) ?? to
        const next = from === edge.from && to === edge.to ? edge : { ...edge, from, to, id: `${from}__${edge.type}__${to}` }
        if (seen.has(next.id)) return []
        seen.add(next.id)
        return [next]
      })
    }
  }

  const newlyCreatedSchemaIds = new Set<string>()
  for (const er of entryResults) {
    for (const node of er.nodes) {
      if (node.parentId === undefined && node.template === 'Schema') newlyCreatedSchemaIds.add(node.id)
    }
  }

  // Merge every entry's nodes first, so casing resolution below sees the
  // fully-merged node set regardless of import order among entries.
  for (const er of entryResults) {
    const diff = diffNodes(er.nodes, graph.nodesById, er.specPath)
    // Design §6a: warning-only rename suggestion (delete+add, same parent +
    // template). Renames stay explicit via rename_node.
    allDiagnostics.push(...detectPossibleRenames(diff, er.specPath))
    for (const node of [...diff.toAdd, ...diff.toUpdate, ...diff.toRemove]) {
      graph.nodesById.set(node.id, node)
    }
  }

  const edgesBySource = new Map<string, typeof entryResults[number]['edges']>()
  for (const er of entryResults) {
    let edges = er.edges.filter(edge => !isStructuralEdgeType(graph, edge.type))
    if (config.edgeCasing === 'match') {
      edges = resolveEdgeCasing(graph, edges, allDiagnostics)
    }
    edgesBySource.set(er.specPath, [...(edgesBySource.get(er.specPath) ?? []), ...edges])
  }
  for (const [specPath, edges] of edgesBySource) {
    reconcileEdges(graph, edges, specPath)
  }

  // ADR-009b rule 4: mechanically rewrite edges when a schema was promoted
  // inline → standalone by this run.
  const promotions = detectSchemaPromotions(priorNodes, newlyCreatedSchemaIds)
  rewritePromotedSchemaEdges(graph, promotions, allDiagnostics)

  // A non-strict load omits unparsable files, and the commit replaces graph
  // content, so committing would silently delete them. Leave the target untouched.
  const idMapReport = idResolver.finish()
  allDiagnostics.push(...idMapReport.diagnostics)
  const idMapSummary = idMaps.length > 0 ? idMapReport.summary : undefined
  if (targetLoadErrors.length > 0) return { diagnostics: allDiagnostics, idMapSummary }

  const graphPath = runtimeConfig.kind === 'filesystem' ? runtimeConfig.graphPath : undefined
  const contentMap = serializeGraph(graph, { sourceGraphPath: graphPath, outputGraphPath: graphPath })
  await source.commit(
    targetBranch,
    contentMap,
    'corum import',
    { replaceGraphContent: true, ...(targetBranchExists ? {} : { createBranchIfMissing: true }) },
  )

  return { diagnostics: allDiagnostics, idMapSummary }
}

async function loadPackAdapterConfig(runtimeConfig: GraphRuntimeConfig, adapterId: string): Promise<AdapterPackConfig | null> {
  let packContent: ContentMap
  try {
    packContent = await runtimeConfig.source.loadPackContent(await runtimeConfig.source.defaultBranch())
  } catch {
    return null
  }
  for (const [key, content] of packContent) {
    if (key.endsWith(`/adapters/${adapterId}.yaml`)) {
      try {
        return parseYaml(content) as AdapterPackConfig
      } catch {
        return null
      }
    }
  }
  return null
}
