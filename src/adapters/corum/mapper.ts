import type { Diagnostic, Edge, EdgeType, Node } from '../../schema/index.js'
import type { CorumInterchangeDocument, CorumInterchangeEdge, CorumInterchangeNode, CorumInterchangeProvenance } from './parser.js'

const VALID_EDGE_TYPES = new Set<string>([
  'triggers', 'produces', 'reads', 'calls', 'implements',
  'maps-to', 'derived-from', 'renamed-from', 'has-field', 'has-value',
])

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function mapDocument(document: CorumInterchangeDocument, specPath: string): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []

  for (const gap of document.gaps ?? []) {
    const msg = gap.nodeId
      ? `[${gap.kind}] ${gap.nodeId}: ${gap.reason ?? ''}`
      : `[${gap.kind}] ${gap.reason ?? ''}`
    diagnostics.push({ severity: 'warning', file: specPath, message: msg })
  }

  for (const raw of document.nodes) {
    if (!raw.id || !raw.template) {
      diagnostics.push({ severity: 'warning', file: specPath, message: `Node missing id or template — skipping` })
      continue
    }
    nodes.push(mapNode(raw, specPath))
  }

  for (const raw of document.edges ?? []) {
    if (!VALID_EDGE_TYPES.has(raw.type)) {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        message: `Unknown edge type '${raw.type}' from '${raw.from}' to '${raw.to}' — skipping`,
      })
      continue
    }
    edges.push(mapEdge(raw))
  }

  return { nodes, edges, diagnostics }
}

function mapNode(raw: CorumInterchangeNode, specPath: string): Node {
  return {
    id: raw.id,
    template: raw.template,
    component: raw.id.split('.')[0],
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: new Date().toISOString().split('T')[0],
    extractedFrom: specPath,
    derivation: derivationOf(raw.provenance),
    derivedBy: derivedByOf(raw.provenance),
    properties: raw.properties ?? {},
  }
}

function mapEdge(raw: CorumInterchangeEdge): Edge {
  return {
    id: `${raw.from}__${raw.type}__${raw.to}`,
    from: raw.from,
    to: raw.to,
    type: raw.type as EdgeType,
    state: 'implemented',
    stability: 'unstable',
    derivation: derivationOf(raw.provenance),
    derivedBy: derivedByOf(raw.provenance),
  }
}

function derivationOf(p: CorumInterchangeProvenance | undefined): 'determined' | 'inferred' {
  return p?.derivation === 'inferred' ? 'inferred' : 'determined'
}

function derivedByOf(p: CorumInterchangeProvenance | undefined): string {
  return p?.by ? `adapter:corum/${p.by}` : 'adapter:corum'
}
