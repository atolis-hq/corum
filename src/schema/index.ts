import type { ContentMap, GraphSource } from '../source/index.js'

export type State = 'draft' | 'proposed' | 'agreed' | 'future' | 'removed' | 'implemented'
export type Stability = 'unstable' | 'stable' | 'deprecated'

/**
 * Edge types are an open, pack-extensible vocabulary. Core types are declared
 * in `loader/constants.ts` (CORE_EDGE_TYPES); packs add more via
 * `edge-types.yaml`. Engine behaviour keys off EdgeTypeDef.category, never
 * off hardcoded name lists.
 */
export type EdgeType = string

export type EdgeCategory = 'structural' | 'semantic' | 'lineage'

export interface EdgeTypeDef {
  name: string
  category: EdgeCategory
  description?: string
  /** JSON-schema for edge properties of this type. */
  properties?: Record<string, unknown>
  /** Hidden edges are bookkeeping (e.g. renamed-from): excluded from summaries, lineage defaults, and collapsed views. */
  hidden?: boolean
}

export interface NodeCorumIdentity {
  previousIds?: string[]
}

export interface NodeCorum {
  identity?: NodeCorumIdentity
}

export interface Node {
  id: string
  template: string
  component: string
  /** Owning parent node id, materialised at load time for owned children. */
  parentId?: string
  state: State
  stability: Stability
  schemaVersion: string
  lastModifiedAt: string
  extractedFrom?: string
  derivation?: 'determined' | 'inferred' | 'manual'
  derivedBy?: string
  corum?: NodeCorum
  properties: Record<string, unknown>
}

export interface Edge {
  id: string
  from: string
  to: string
  type: EdgeType
  state: State
  stability: Stability
  notes?: string
  properties?: Record<string, unknown>
  derivation?: 'determined' | 'inferred' | 'manual'
  derivedBy?: string
  generated?: true
}

export interface Template {
  name: string
  info: {
    version: string
    core?: boolean
    abstract?: boolean
    description?: string
    /** Capability role (field, value, type-container, enum-container, mapping); inherited via extends. */
    role?: string
  }
  extends?: string
  properties?: Record<string, unknown>
  'edge-types'?: {
    outgoing?: EdgeType[]
    incoming?: EdgeType[]
    supports?: EdgeType[]
  }
  ui?: {
    icon?: string
    colour?: string
    displayName?: string
    displayProperties?: string[]
    badge?: string
    nav?: {
      nestOwned?: Array<{
        section: string
        label?: string
      }>
      navGroup?: string
    }
  }
  [section: string]: unknown
}

export interface Diagnostic {
  severity: 'error' | 'warning'
  file: string
  nodeId?: string
  message: string
}

export interface Graph {
  nodesById: Map<string, Node>
  edgesByFrom: Map<string, Edge[]>
  edgesByTo: Map<string, Edge[]>
  templates: Map<string, Template>
  /** Core + pack-declared edge type definitions. Absent maps fall back to core. */
  edgeTypes?: Map<string, EdgeTypeDef>
  diagnostics: Diagnostic[]
  sourceContent?: ContentMap
}

export interface LoadOptions {
  source?: GraphSource
  ref?: string
  graphPath?: string
  packsPath?: string
  strict?: boolean
}

export class LoadError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    const errorCount = diagnostics.filter(d => d.severity === 'error').length
    super(`Graph load failed with ${errorCount} error(s)`)
    this.name = 'LoadError'
  }
}

export class QueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryError'
  }
}

export { SourceError } from '../source/index.js'

export type GhostState =
  | 'local'
  | 'local-modified'
  | 'shared'
  | 'default-only'
  | 'ghost-single'
  | 'ghost-consensus'
  | 'ghost-conflict'

export interface BranchGraph {
  ref: string
  sha?: string
  isDefault: boolean
  graph: Graph
}

export type BranchLoadStatus = 'loaded' | 'failed'

export interface BranchLoadResult {
  ref: string
  status: BranchLoadStatus
  error?: string
  diagnostics?: Diagnostic[]
}

export interface OverlayNode {
  id: string
  presence: Map<string, Node>
  ghostState: GhostState
}

export interface OverlayEdge {
  id: string
  presence: Map<string, Edge>
  ghostState: GhostState
}

export interface BranchOverlay {
  viewingRef: string
  nodes: Map<string, OverlayNode>
  edges: Map<string, OverlayEdge>
}

/**
 * Emitted when a branch modifies a node under an ID the default branch has
 * since renamed — the branch edits a retired name and should rebase or apply
 * the rename before merging.
 */
export interface BranchDiffWarning {
  kind: 'retired-name-edit'
  /** The retired ID as held on the branch. */
  branchId: string
  /** The live ID it resolves to on the default branch. */
  resolvedId: string
  message: string
}

export interface BranchDiff {
  added: Node[]
  modified: Node[]
  removed: Node[]
  /** Present only when at least one warning applies. */
  warnings?: BranchDiffWarning[]
}

export interface MultiGraph {
  default: BranchGraph
  branches: BranchGraph[]
  branchResults: BranchLoadResult[]
  overlay(viewingRef: string): BranchOverlay
  diff(branchRef: string): BranchDiff
}

export type ClusterOverlayField = {
  id: string
  ghostState: GhostState
  sourceRef: string
  node: Node
}

export type ClusterOverlay = {
  viewingRef: string
  overlayRefs: string[]
  fields: ClusterOverlayField[]
}

export interface MultiLoadOptions {
  source: GraphSource
  branches?: string[]
  strict?: boolean
}
