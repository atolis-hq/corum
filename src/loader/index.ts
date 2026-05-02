import { FileGraphSource } from '../source/file-source.js'
import { SourceError } from '../source/index.js'
import type { GraphSource } from '../source/index.js'
import type {
  BranchGraph,
  BranchLoadResult,
  BranchOverlay,
  Diagnostic,
  Edge,
  Graph,
  LoadOptions,
  MultiGraph,
  MultiLoadOptions,
} from '../schema/index.js'
import { LoadError, QueryError } from '../schema/index.js'
import { computeDiff, computeOverlay } from '../graph/overlay.js'
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

export async function loadMultiGraph(options: MultiLoadOptions): Promise<MultiGraph> {
  const { source, strict = true } = options
  const defaultRef = await source.defaultBranch()
  let defaultBranch: BranchGraph

  try {
    defaultBranch = {
      ref: defaultRef,
      isDefault: true,
      graph: await loadGraph({ source, ref: defaultRef, strict }),
    }
  } catch (err) {
    throw new SourceError(`failed to load default branch '${defaultRef}'`, err)
  }

  const requestedBranches = options.branches ?? await source.listBranches()
  const nonDefaultRefs = requestedBranches.filter(ref => ref !== defaultRef)
  const settledBranches = await Promise.allSettled(
    nonDefaultRefs.map(async (ref): Promise<BranchGraph> => ({
      ref,
      isDefault: false,
      graph: await loadGraph({ source, ref, strict }),
    })),
  )

  const branches: BranchGraph[] = [defaultBranch]
  const branchResults: BranchLoadResult[] = [{ ref: defaultRef, status: 'loaded' }]

  for (let index = 0; index < settledBranches.length; index++) {
    const result = settledBranches[index]
    const ref = nonDefaultRefs[index]
    if (result.status === 'fulfilled') {
      branches.push(result.value)
      branchResults.push({ ref, status: 'loaded' })
    } else {
      branchResults.push({
        ref,
        status: 'failed',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  const overlayCache = new Map<string, BranchOverlay>()

  return {
    default: defaultBranch,
    branches,
    branchResults,
    overlay(viewingRef: string) {
      let overlay = overlayCache.get(viewingRef)
      if (!overlay) {
        overlay = computeOverlay(viewingRef, defaultBranch, branches)
        overlayCache.set(viewingRef, overlay)
      }
      return overlay
    },
    diff(branchRef: string) {
      const branch = branches.find(item => item.ref === branchRef)
      if (!branch) throw new QueryError(`branch '${branchRef}' not found or failed to load`)
      return computeDiff(branch, defaultBranch)
    },
  }
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
