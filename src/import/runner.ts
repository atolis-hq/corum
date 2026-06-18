import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import { loadGraph } from '../loader/index.js'
import { serializeGraph } from '../writer/graph-writer.js'
import { getAdapter } from '../adapters/index.js'
import { diffNodes } from '../reconcile/index.js'
import type { ImportConfig } from './config.js'
import type { AdapterPackConfig } from '../adapters/index.js'
import type { Diagnostic } from '../schema/index.js'
import type { ContentMap } from '../source/index.js'
import type { GraphRuntimeConfig } from '../source/config.js'

export interface RunResult {
  diagnostics: Diagnostic[]
}

export async function runImport(config: ImportConfig, runtimeConfig: GraphRuntimeConfig): Promise<RunResult> {
  const allDiagnostics: Diagnostic[] = []

  const graph = await loadGraph({ source: runtimeConfig.source })

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

    const adapter = getAdapter(entry.adapter)
    const result = await adapter.import(entry, { packConfig, templates: graph.templates })
    allDiagnostics.push(...result.diagnostics)

    if (result.diagnostics.some(d => d.severity === 'error')) continue

    const specPath = path.resolve(entry.spec)
    const { toAdd, toUpdate, toRemove } = diffNodes(result.nodes, graph.nodesById, specPath)

    for (const node of [...toAdd, ...toUpdate, ...toRemove]) {
      graph.nodesById.set(node.id, node)
    }
  }

  const graphPath = runtimeConfig.kind === 'filesystem' ? runtimeConfig.graphPath : undefined
  const contentMap = serializeGraph(graph, { sourceGraphPath: graphPath, outputGraphPath: graphPath })
  await runtimeConfig.source.commit(
    await runtimeConfig.source.defaultBranch(),
    contentMap,
    'corum import',
    { replaceGraphContent: true },
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
