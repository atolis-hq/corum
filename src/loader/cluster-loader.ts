import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic, Edge, Node, Stability, State, Template } from '../schema/index.js'
import { getOwnedSections } from './pack-loader.js'
import { walkYamlFiles } from './fs-utils.js'
import { STRUCTURAL_EDGE_BY_ITEM_TEMPLATE, VALID_STABILITY_SET, VALID_STATE_SET } from './constants.js'

type ClusterResult = {
  nodes: Map<string, Node>
  edgesByFrom: Map<string, Edge[]>
  edgesByTo: Map<string, Edge[]>
}

type RootRecord = Record<string, unknown> & {
  id?: unknown
  template?: unknown
  component?: unknown
  state?: unknown
  stability?: unknown
  schemaVersion?: unknown
  lastModifiedAt?: unknown
  properties?: unknown
}

export function loadClusters(
  graphPath: string,
  templates: Map<string, Template>,
  diagnostics: Diagnostic[],
): ClusterResult {
  const result: ClusterResult = { nodes: new Map(), edgesByFrom: new Map(), edgesByTo: new Map() }
  const componentsDir = path.join(graphPath, 'components')
  if (!existsSync(componentsDir)) return result

  for (const filePath of walkYamlFiles(componentsDir)) {
    let raw: unknown
    try {
      raw = parseYaml(readFileSync(filePath, 'utf-8'))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: filePath, message: `failed to parse YAML: ${err}` })
      continue
    }

    const record = raw as RootRecord
    if (
      typeof record.id !== 'string' ||
      typeof record.template !== 'string' ||
      typeof record.component !== 'string' ||
      typeof record.schemaVersion !== 'string' ||
      typeof record.lastModifiedAt !== 'string'
    ) {
      diagnostics.push({ severity: 'error', file: filePath, message: 'cluster missing required root fields' })
      continue
    }

    const root: Node = {
      id: record.id,
      template: record.template,
      component: record.component,
      state: asState(record.state, 'proposed'),
      stability: asStability(record.stability, 'unstable'),
      schemaVersion: record.schemaVersion,
      lastModifiedAt: record.lastModifiedAt,
      extractedFrom: filePath,
      properties: isRecord(record.properties) ? record.properties : {},
    }

    addNode(result, root, filePath, diagnostics)
    materialiseChildren(result, root, record, templates, filePath, diagnostics)
  }

  return result
}

function materialiseChildren(
  result: ClusterResult,
  parent: Node,
  source: Record<string, unknown>,
  templates: Map<string, Template>,
  filePath: string,
  diagnostics: Diagnostic[],
): void {
  const template = templates.get(parent.template)
  if (!template) {
    diagnostics.push({ severity: 'error', file: filePath, nodeId: parent.id, message: `unknown template: ${parent.template}` })
    return
  }

  for (const [sectionName, childTemplateName] of Object.entries(getOwnedSections(template))) {
    const section = source[sectionName]
    if (!isRecord(section)) continue

    for (const [localName, value] of Object.entries(section)) {
      if (!isRecord(value)) {
        diagnostics.push({
          severity: 'error',
          file: filePath,
          nodeId: `${parent.id}.${sectionName}.${localName}`,
          message: `owned item in ${sectionName} must be an object`,
        })
        continue
      }

      const childId = `${parent.id}.${sectionName}.${localName}`
      const child: Node = {
        id: childId,
        template: childTemplateName,
        component: parent.component,
        state: asState(value.state, parent.state),
        stability: asStability(value.stability, parent.stability),
        schemaVersion: parent.schemaVersion,
        lastModifiedAt: parent.lastModifiedAt,
        extractedFrom: filePath,
        properties: stripOwnedSections(value, childTemplateName, templates),
      }

      addNode(result, child, filePath, diagnostics)
      const edgeType = STRUCTURAL_EDGE_BY_ITEM_TEMPLATE[childTemplateName]
      if (edgeType) {
        addEdge(result, {
          id: `${parent.id}__${edgeType}__${child.id}`,
          from: parent.id,
          to: child.id,
          type: edgeType,
          state: child.state,
          stability: child.stability,
        })
      }
      materialiseChildren(result, child, value, templates, filePath, diagnostics)
    }
  }
}

function stripOwnedSections(
  value: Record<string, unknown>,
  templateName: string,
  templates: Map<string, Template>,
): Record<string, unknown> {
  const ownedSections = new Set(Object.keys(getOwnedSections(
    templates.get(templateName) ?? ({ name: templateName, info: { version: 'unknown' } }),
  )))
  const nodeMetadata = new Set(['state', 'stability'])
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ownedSections.has(key) && !nodeMetadata.has(key)))
}

function addNode(result: ClusterResult, node: Node, file: string, diagnostics: Diagnostic[]): void {
  if (result.nodes.has(node.id)) {
    diagnostics.push({ severity: 'error', file, nodeId: node.id, message: `duplicate node id: ${node.id}` })
    return
  }
  result.nodes.set(node.id, node)
}

function addEdge(result: ClusterResult, edge: Edge): void {
  const from = result.edgesByFrom.get(edge.from) ?? []
  from.push(edge)
  result.edgesByFrom.set(edge.from, from)

  const to = result.edgesByTo.get(edge.to) ?? []
  to.push(edge)
  result.edgesByTo.set(edge.to, to)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asState(value: unknown, fallback: State): State {
  return typeof value === 'string' && VALID_STATE_SET.has(value) ? value as State : fallback
}

function asStability(value: unknown, fallback: Stability): Stability {
  return typeof value === 'string' && VALID_STABILITY_SET.has(value) ? value as Stability : fallback
}
