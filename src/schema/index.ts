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
  version: string
  core?: boolean
  abstract?: boolean
  extends?: string
  description?: string
  properties?: Record<string, unknown>
  'edge-types'?: {
    outgoing?: EdgeType[]
    incoming?: EdgeType[]
    supports?: EdgeType[]
  }
  ui?: {
    icon?: string
    colour?: string
    displayProperties?: string[]
    badge?: string
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
}

export interface LoadOptions {
  graphPath: string
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
