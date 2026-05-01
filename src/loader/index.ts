import { FileGraphSource } from '../source/file-source.js'
import type { GraphSource } from '../source/index.js'
import type { Diagnostic, Edge, Graph, LoadOptions } from '../schema/index.js'
import { LoadError } from '../schema/index.js'
import { loadClusters } from './cluster-loader.js'
import { loadEdges } from './edge-loader.js'
import { loadPacks } from './pack-loader.js'

export async function loadGraph(options: LoadOptions): Promise<Graph> {
  const { strict = true } = options
  const diagnostics: Diagnostic[] = []

  const source: GraphSource = options.source ?? new FileGraphSource({
    graphDir: options.graphPath,
    packsPath: options.packsPath,
  })
  const defaultRef = await source.defaultBranch()
  const ref = options.ref ?? defaultRef

  const packContent = await source.loadPackContent(defaultRef)
  const templates = loadPacks(packContent, diagnostics)

  const graphContent = await source.loadGraphContent(ref)
  const clusterResult = loadClusters(graphContent, templates, diagnostics)
  const edgeResult = loadEdges(graphContent, clusterResult.nodes, diagnostics)

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
    sourceContent: graphContent,
  }

  if (strict && diagnostics.some(d => d.severity === 'error')) {
    throw new LoadError(diagnostics)
  }

  return graph
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
