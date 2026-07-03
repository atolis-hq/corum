import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import { loadGraph } from '../loader/index.js'
import { isStructuralEdgeType } from '../graph/index.js'
import { serializeGraph } from '../writer/graph-writer.js'
import { getAdapter } from '../adapters/index.js'
import { diffNodes } from '../reconcile/index.js'
import { deduplicateResults } from './dedup.js'
import type { EntryResult } from './dedup.js'
import { buildExistingSchemaIndex, detectSchemaPromotions, rewritePromotedSchemaEdges } from './schema-promotion.js'
import { resolveEdgeCasing } from './edge-casing.js'
import type { ImportConfig } from './config.js'
import type { AdapterPackConfig } from '../adapters/index.js'
import type { Diagnostic } from '../schema/index.js'
import type { ContentMap } from '../source/index.js'
import type { GraphRuntimeConfig } from '../source/config.js'

export interface RunResult {
  diagnostics: Diagnostic[]
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
  const graph = await loadGraph({ source, ref: targetBranchExists ? targetBranch : defaultBranch })

  // ADR-009b: snapshot of node identities before this run, and the shared
  // reuse-before-inline index (target graph + same-run entries as they land).
  const priorNodeIds = new Set(graph.nodesById.keys())
  const existingSchemas = buildExistingSchemaIndex(graph)

  const entryResults: EntryResult[] = []

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

    const specPath = path.resolve(entry.spec)
    const resolvedEntry = { ...entry, spec: specPath }
    const adapter = getAdapter(resolvedEntry.adapter)
    const result = await adapter.import(resolvedEntry, {
      packConfig,
      templates: graph.templates,
      componentNameReplacements: config.componentNameReplacements ?? [],
      existingSchemas,
    })
    allDiagnostics.push(...result.diagnostics)

    if (result.diagnostics.some(d => d.severity === 'error')) continue

    entryResults.push({ adapterId: entry.adapter, specPath, nodes: result.nodes, edges: result.edges })
  }

  if (config.deduplication?.length) {
    const { results: deduped, diagnostics } = deduplicateResults(entryResults, config.deduplication)
    allDiagnostics.push(...diagnostics)
    entryResults.splice(0, entryResults.length, ...deduped)
  }

  const newlyCreatedSchemaIds = new Set<string>()
  for (const er of entryResults) {
    for (const node of er.nodes) {
      const parts = node.id.split('.')
      if (parts.length === 3 && parts[1] === 'Schema') newlyCreatedSchemaIds.add(node.id)
    }
  }

  // Merge every entry's nodes first, so casing resolution below sees the
  // fully-merged node set regardless of import order among entries.
  for (const er of entryResults) {
    const { toAdd, toUpdate, toRemove } = diffNodes(er.nodes, graph.nodesById, er.specPath)
    for (const node of [...toAdd, ...toUpdate, ...toRemove]) {
      graph.nodesById.set(node.id, node)
    }
  }

  for (const er of entryResults) {
    let edgesToAppend = er.edges.filter(edge => !isStructuralEdgeType(graph, edge.type))
    if (config.edgeCasing === 'match') {
      edgesToAppend = resolveEdgeCasing(graph, edgesToAppend, allDiagnostics)
    }

    for (const edge of edgesToAppend) {
      const existing = graph.edgesByFrom.get(edge.from) ?? []
      if (!existing.some(e => e.id === edge.id)) {
        graph.edgesByFrom.set(edge.from, [...existing, edge])
        const byTo = graph.edgesByTo.get(edge.to) ?? []
        graph.edgesByTo.set(edge.to, [...byTo, edge])
      }
    }
  }

  // ADR-009b rule 4: mechanically rewrite edges when a schema was promoted
  // inline → standalone by this run.
  const promotions = detectSchemaPromotions(priorNodeIds, newlyCreatedSchemaIds)
  rewritePromotedSchemaEdges(graph, promotions, allDiagnostics)

  const graphPath = runtimeConfig.kind === 'filesystem' ? runtimeConfig.graphPath : undefined
  const contentMap = serializeGraph(graph, { sourceGraphPath: graphPath, outputGraphPath: graphPath })
  await source.commit(
    targetBranch,
    contentMap,
    'corum import',
    { replaceGraphContent: true, ...(targetBranchExists ? {} : { createBranchIfMissing: true }) },
  )

  return { diagnostics: allDiagnostics }
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
