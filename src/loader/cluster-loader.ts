import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Edge, Node, Stability, State, Template } from '../schema/index.js'
import { getOwnedSections } from './pack-loader.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'
import { STRUCTURAL_EDGE_BY_ITEM_TEMPLATE, VALID_STABILITY_SET, VALID_STATE_SET } from './constants.js'

type ClusterResult = {
  nodes: Map<string, Node>
  edgesByFrom: Map<string, Edge[]>
  edgesByTo: Map<string, Edge[]>
}

type RootRecord = Record<string, unknown> & {
  id?: unknown
  template?: unknown
  schemaVersion?: unknown
  metadata?: unknown
  properties?: unknown
}

export function loadClusters(
  content: ContentMap,
  templates: Map<string, Template>,
  diagnostics: Diagnostic[],
): ClusterResult {
  const result: ClusterResult = { nodes: new Map(), edgesByFrom: new Map(), edgesByTo: new Map() }

  for (const key of listYamlKeys(content, 'components')) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(content, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }

    const record = raw as RootRecord
    const meta = record.metadata
    if (
      typeof record.id !== 'string' ||
      typeof record.template !== 'string' ||
      typeof record.schemaVersion !== 'string' ||
      !isRecord(meta) ||
      typeof meta.component !== 'string' ||
      typeof meta.lastModifiedAt !== 'string'
    ) {
      diagnostics.push({ severity: 'error', file: key, message: 'cluster missing required root fields' })
      continue
    }

    const root: Node = {
      id: record.id,
      template: record.template,
      component: meta.component,
      state: asState(meta.state, 'proposed'),
      stability: asStability(meta.stability, 'unstable'),
      schemaVersion: record.schemaVersion,
      lastModifiedAt: meta.lastModifiedAt,
      ...(typeof meta.extractedFrom === 'string' && { extractedFrom: meta.extractedFrom }),
      ...(typeof meta.derivation === 'string' && { derivation: meta.derivation as Node['derivation'] }),
      ...(typeof meta.derivedBy === 'string' && { derivedBy: meta.derivedBy }),
      properties: isRecord(record.properties) ? record.properties : {},
    }

    addNode(result, root, key, diagnostics)
    materialiseChildren(result, root, record, templates, key, diagnostics)
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
