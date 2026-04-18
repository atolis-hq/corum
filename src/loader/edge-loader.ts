import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic, Edge, EdgeType, Node, Stability, State } from '../schema/index.js'

const VALID_EDGE_TYPES = new Set<string>([
  'triggers', 'produces', 'reads', 'calls', 'implements',
  'maps-to', 'derived-from', 'renamed-from', 'has-field', 'has-value',
])

type EdgeResult = {
  edgesByFrom: Map<string, Edge[]>
  edgesByTo: Map<string, Edge[]>
}

export async function loadEdges(
  graphPath: string,
  nodes: Map<string, Node>,
  diagnostics: Diagnostic[],
): Promise<EdgeResult> {
  const result: EdgeResult = { edgesByFrom: new Map(), edgesByTo: new Map() }
  const edgesDir = path.join(graphPath, 'edges')
  if (!existsSync(edgesDir)) return result

  for (const filePath of walkYamlFiles(edgesDir)) {
    let raw: unknown
    try {
      raw = parseYaml(readFileSync(filePath, 'utf-8'))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: filePath, message: `failed to parse YAML: ${err}` })
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
        diagnostics.push({ severity: 'error', file: filePath, message: 'edge missing required from, to, or type' })
        continue
      }
      if (!VALID_EDGE_TYPES.has(edgeRecord.type)) {
        diagnostics.push({ severity: 'error', file: filePath, message: `invalid edge type: ${edgeRecord.type}` })
        continue
      }

      if (!nodes.has(edgeRecord.from)) {
        diagnostics.push({ severity: 'error', file: filePath, message: `edge from unresolved node: ${edgeRecord.from}` })
      }
      if (!nodes.has(edgeRecord.to)) {
        diagnostics.push({ severity: 'error', file: filePath, message: `edge to unresolved node: ${edgeRecord.to}` })
      }

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

function walkYamlFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkYamlFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      result.push(fullPath)
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
