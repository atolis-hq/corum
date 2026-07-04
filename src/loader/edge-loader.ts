import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Edge, EdgeType, EdgeTypeDef, Node, Stability, State } from '../schema/index.js'
import { CORE_EDGE_TYPE_MAP, VALID_STABILITY_SET, VALID_STATE_SET } from './constants.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'

type EdgeResult = {
  edgesByFrom: Map<string, Edge[]>
  edgesByTo: Map<string, Edge[]>
}

export function loadEdges(
  content: ContentMap,
  nodes: Map<string, Node>,
  diagnostics: Diagnostic[],
  edgeTypes: ReadonlyMap<string, EdgeTypeDef> = CORE_EDGE_TYPE_MAP,
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
      if (!edgeTypes.has(edgeRecord.type)) {
        diagnostics.push({ severity: 'error', file: key, message: `invalid edge type: ${edgeRecord.type}` })
        continue
      }

      // Hidden edge types (bookkeeping such as renamed-from) legitimately
      // point their `to` at a retired ID, so no resolution is required there —
      // but the `from` is the live end and MUST resolve (design §3/§11).
      const hidden = edgeTypes.get(edgeRecord.type)?.hidden === true

      let unresolvedEndpoint = false
      if (!nodes.has(edgeRecord.from)) {
        diagnostics.push(hidden
          ? { severity: 'error', file: key, message: `hidden edge type '${edgeRecord.type}' requires a live 'from' node: ${edgeRecord.from}` }
          : { severity: 'warning', file: key, message: `edge from unresolved node: ${edgeRecord.from}` })
        unresolvedEndpoint = true
      }
      if (!hidden && !nodes.has(edgeRecord.to)) {
        diagnostics.push({ severity: 'warning', file: key, message: `edge to unresolved node: ${edgeRecord.to}` })
        unresolvedEndpoint = true
      }
      if (unresolvedEndpoint) continue

      const properties = edgeRecord.properties
      addEdge(result, {
        id: `${edgeRecord.from}__${edgeRecord.type}__${edgeRecord.to}`,
        from: edgeRecord.from,
        to: edgeRecord.to,
        type: edgeRecord.type as EdgeType,
        state: resolveState(edgeRecord.state, diagnostics, key),
        stability: resolveStability(edgeRecord.stability, diagnostics, key),
        notes: typeof edgeRecord.notes === 'string' ? edgeRecord.notes : undefined,
        ...(typeof properties === 'object' && properties !== null && !Array.isArray(properties) && {
          properties: properties as Record<string, unknown>,
        }),
      })
    }
  }

  return result
}

function resolveState(value: unknown, diagnostics: Diagnostic[], file: string): State {
  if (value === undefined) return 'proposed'
  if (typeof value === 'string' && VALID_STATE_SET.has(value)) return value as State
  diagnostics.push({ severity: 'warning', file, message: `invalid edge state '${String(value)}', defaulting to 'proposed'` })
  return 'proposed'
}

function resolveStability(value: unknown, diagnostics: Diagnostic[], file: string): Stability {
  if (value === undefined) return 'unstable'
  if (typeof value === 'string' && VALID_STABILITY_SET.has(value)) return value as Stability
  diagnostics.push({ severity: 'warning', file, message: `invalid edge stability '${String(value)}', defaulting to 'unstable'` })
  return 'unstable'
}

function addEdge(result: EdgeResult, edge: Edge): void {
  const from = result.edgesByFrom.get(edge.from) ?? []
  from.push(edge)
  result.edgesByFrom.set(edge.from, from)

  const to = result.edgesByTo.get(edge.to) ?? []
  to.push(edge)
  result.edgesByTo.set(edge.to, to)
}
