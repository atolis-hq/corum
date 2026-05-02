import type { ContentMap, GraphSource } from '../source/index.js'

export type State = 'draft' | 'proposed' | 'agreed' | 'future' | 'removed' | 'implemented'
export type Stability = 'unstable' | 'stable' | 'deprecated'
export type EdgeType =
  | 'triggers' | 'produces' | 'reads' | 'calls' | 'implements'
  | 'maps-to' | 'derived-from' | 'renamed-from' | 'has-field' | 'has-value'

export interface Node {
  id: string
  template: string
  component: string
  state: State
  stability: Stability
  schemaVersion: string
  lastModifiedAt: string
  extractedFrom?: string
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
}

export interface Template {
  name: string
  info: {
    version: string
    core?: boolean
    abstract?: boolean
    description?: string
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

export interface BranchDiff {
  added: Node[]
  modified: Node[]
  removed: Node[]
}

export interface MultiGraph {
  default: BranchGraph
  branches: BranchGraph[]
  branchResults: BranchLoadResult[]
  overlay(viewingRef: string): BranchOverlay
  diff(branchRef: string): BranchDiff
}

export interface MultiLoadOptions {
  source: GraphSource
  branches?: string[]
  strict?: boolean
}
