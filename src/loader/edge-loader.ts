import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Edge, EdgeType, Node, Stability, State } from '../schema/index.js'
import { VALID_EDGE_TYPE_SET } from './constants.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'

type EdgeResult = {
  edgesByFrom: Map<string, Edge[]>
  edgesByTo: Map<string, Edge[]>
}

export function loadEdges(
  content: ContentMap,
  nodes: Map<string, Node>,
  diagnostics: Diagnostic[],
): EdgeResult {
  const result: EdgeResult = { edgesByFrom: new Map(), edgesByTo: new Map() }

  for (const key of listYamlKeys(content, 'edges')) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(content, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }

    const edgeList = (raw as { edges?: unknown[] }).edges ?? []
    for (const edgeRaw of edgeList) {
      const edgeRecord = edgeRaw as Record<string, unknown>
      if (
        typeof edgeRecord.from !== 'string' ||
        typeof edgeRecord.to !== 'string' ||
        typeof edgeRecord.type !== 'string'
      ) {
        diagnostics.push({ severity: 'error', file: key, message: 'edge missing required from, to, or type' })
        continue
      }
      if (!VALID_EDGE_TYPE_SET.has(edgeRecord.type)) {
        diagnostics.push({ severity: 'error', file: key, message: `invalid edge type: ${edgeRecord.type}` })
        continue
      }

      let unresolvedEndpoint = false
      if (!nodes.has(edgeRecord.from)) {
        diagnostics.push({ severity: 'error', file: key, message: `edge from unresolved node: ${edgeRecord.from}` })
        unresolvedEndpoint = true
      }
      if (!nodes.has(edgeRecord.to)) {
        diagnostics.push({ severity: 'error', file: key, message: `edge to unresolved node: ${edgeRecord.to}` })
        unresolvedEndpoint = true
      }
      if (unresolvedEndpoint) continue

      addEdge(result, {
        id: `${edgeRecord.from}__${edgeRecord.type}__${edgeRecord.to}`,
        from: edgeRecord.from,
        to: edgeRecord.to,
        type: edgeRecord.type as EdgeType,
        state: typeof edgeRecord.state === 'string' ? edgeRecord.state as State : 'proposed',
        stability: typeof edgeRecord.stability === 'string' ? edgeRecord.stability as Stability : 'unstable',
        notes: typeof edgeRecord.notes === 'string' ? edgeRecord.notes : undefined,
      })
    }
  }

  return result
}

function addEdge(result: EdgeResult, edge: Edge): void {
  const from = result.edgesByFrom.get(edge.from) ?? []
  from.push(edge)
  result.edgesByFrom.set(edge.from, from)

  const to = result.edgesByTo.get(edge.to) ?? []
  to.push(edge)
  result.edgesByTo.set(edge.to, to)
}
