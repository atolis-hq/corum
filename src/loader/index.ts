import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic, Edge, Graph, LoadOptions } from '../schema/index.js'
import { LoadError } from '../schema/index.js'
import { loadClusters } from './cluster-loader.js'
import { loadEdges } from './edge-loader.js'
import { loadPacks } from './pack-loader.js'

const DEFAULT_PACKS_PATH = '.corum/packs'

export async function loadGraph(options: LoadOptions): Promise<Graph> {
  const { graphPath, strict = true } = options
  const diagnostics: Diagnostic[] = []
  const graphYamlPath = path.join(graphPath, 'graph.yaml')
  const packDirs: string[] = []

  if (existsSync(graphYamlPath)) {
    try {
      const doc = parseYaml(readFileSync(graphYamlPath, 'utf-8')) as Record<string, unknown>
      const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
      for (const pack of packs) {
        if (isPackRef(pack)) {
          packDirs.push(path.resolve(graphPath, pack.path))
        }
      }
    } catch (err) {
      diagnostics.push({ severity: 'error', file: graphYamlPath, message: `failed to parse graph.yaml: ${err}` })
    }
  } else {
    const packsRoot = path.resolve(graphPath, options.packsPath ?? DEFAULT_PACKS_PATH)
    diagnostics.push({
      severity: 'warning',
      file: graphYamlPath,
      message: `graph.yaml not found; using default packs path: ${packsRoot}`,
    })
    packDirs.push(packsRoot)
  }

  const templates = await loadPacks(packDirs, diagnostics)
  const clusterResult = await loadClusters(graphPath, templates, diagnostics)
  const edgeResult = await loadEdges(graphPath, clusterResult.nodes, diagnostics)

  const edgesByFrom = cloneEdgeMap(clusterResult.edgesByFrom)
  const edgesByTo = cloneEdgeMap(clusterResult.edgesByTo)
  mergeEdgeMaps(edgesByFrom, edgeResult.edgesByFrom)
  mergeEdgeMaps(edgesByTo, edgeResult.edgesByTo)

  const graph: Graph = {
    nodesById: clusterResult.nodes,
    edgesByFrom,
    edgesByTo,
    templates,
    diagnostics,
  }

  if (strict && diagnostics.some(d => d.severity === 'error')) {
    throw new LoadError(diagnostics)
  }

  return graph
}

function isPackRef(value: unknown): value is { path: string } {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).path === 'string'
}

function cloneEdgeMap(source: Map<string, Edge[]>): Map<string, Edge[]> {
  return new Map([...source.entries()].map(([key, edges]) => [key, [...edges]]))
}

function mergeEdgeMaps(target: Map<string, Edge[]>, source: Map<string, Edge[]>): void {
  for (const [key, edges] of source) {
    const existing = target.get(key) ?? []
    target.set(key, [...existing, ...edges])
  }
}
