import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Edge, Graph, Node } from '../schema/index.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import { getPropertySchemasFromTemplate } from '../loader/template-props.js'
import { isStructuralEdgeType } from '../graph/index.js'
import { isPackRef } from '../loader/fs-utils.js'
import type { ContentMap } from '../source/index.js'
import { FileGraphSource } from '../source/file-source.js'

export interface SaveGraphOptions {
  sourceGraphPath: string
  outputGraphPath: string
  replace?: boolean
}

export interface SerializeGraphOptions {
  sourceGraphPath?: string
  outputGraphPath?: string
}

const YAML_STRINGIFY_OPTIONS = { singleQuote: true }

export function serializeGraph(graph: Graph, options: SerializeGraphOptions = {}): ContentMap {
  const map: ContentMap = new Map()
  map.set('graph.yaml', buildGraphYaml(graph, options))

  for (const root of getRootNodes(graph)) {
    map.set(clusterPath(root), stringifyGraphYaml(toClusterDocument(graph, root)))
  }

  const explicitEdges = getAllEdges(graph)
    .filter(edge => !isStructuralEdgeType(graph, edge.type) && edge.generated !== true)
    .sort((a, b) => a.id.localeCompare(b.id))

  if (explicitEdges.length > 0) {
    map.set('edges/corum.edges.yaml', stringifyGraphYaml({ edges: explicitEdges.map(edge => toEdgeDocument(graph, edge)) }))
  }

  return map
}

function clusterPath(node: Node): string {
  const parts = node.id.split('.')
  if (parts.length < 3) throw new Error(`clusterPath: expected at least 3-segment root node ID, got: ${node.id}`)
  const [component, template, ...rest] = parts
  return `components/${component}/${template}s/${rest.join('/')}.yaml`
}

export async function saveGraph(graph: Graph, options: SaveGraphOptions): Promise<void> {
  const { sourceGraphPath, outputGraphPath, replace = true } = options

  if (fs.existsSync(outputGraphPath)) {
    if (!replace) {
      throw new Error(`output graph folder already exists: ${outputGraphPath}`)
    }
  }

  const source = new FileGraphSource({ graphDir: outputGraphPath, defaultBranch: 'local' })
  await source.commit(
    'local',
    serializeGraph(graph, { sourceGraphPath, outputGraphPath }),
    'save graph',
    { replaceGraphContent: replace },
  )
}

function buildGraphYaml(graph: Graph, options: SerializeGraphOptions): string {
  const content = graph.sourceContent?.get('graph.yaml')
  if (!content) return stringifyGraphYaml({ templatePacks: [] })
  if (!options.sourceGraphPath || !options.outputGraphPath) return content
  const doc = parseYaml(content) as Record<string, unknown>
  const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
  doc.templatePacks = packs.map(pack => {
    if (!isPackRef(pack)) return pack
    const absolutePackPath = path.resolve(options.sourceGraphPath!, pack.path)
    return {
      ...pack,
      path: normalizeContentKey(path.relative(options.outputGraphPath!, absolutePackPath)),
    }
  })
  return stringifyGraphYaml(doc)
}

function normalizeContentKey(value: string): string {
  return value.split(path.sep).join('/')
}

function toClusterDocument(graph: Graph, root: Node): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    component: root.component,
    state: root.state,
    stability: root.stability,
    lastModifiedAt: root.lastModifiedAt,
  }
  if (root.extractedFrom !== undefined) metadata.extractedFrom = root.extractedFrom
  if (root.derivation !== undefined) metadata.derivation = root.derivation
  if (root.derivedBy !== undefined) metadata.derivedBy = root.derivedBy

  const doc: Record<string, unknown> = {
    id: root.id,
    template: root.template,
    schemaVersion: root.schemaVersion,
    metadata,
  }

  if (Object.keys(root.properties).length > 0) {
    doc.properties = orderNodeProperties(graph, root)
  }

  appendOwnedSections(graph, root, doc)
  return doc
}

function appendOwnedSections(graph: Graph, parent: Node, target: Record<string, unknown>): void {
  const template = graph.templates.get(parent.template)
  if (!template) return

  for (const [sectionName] of Object.entries(getOwnedSections(template))) {
    const children = getDirectOwnedChildren(graph, parent.id, sectionName)
    if (children.length === 0) continue

    const section: Record<string, unknown> = {}
    for (const child of children) {
      const childDoc: Record<string, unknown> = { ...orderNodeProperties(graph, child) }
      if (child.state !== parent.state) childDoc.state = child.state
      if (child.stability !== parent.stability) childDoc.stability = child.stability
      appendOwnedSections(graph, child, childDoc)
      section[getLocalName(child.id, parent.id, sectionName)] = childDoc
    }
    target[sectionName] = section
  }
}

function getDirectOwnedChildren(graph: Graph, parentId: string, sectionName: string): Node[] {
  const prefix = `${parentId}.${sectionName}.`
  return [...graph.nodesById.values()]
    .filter(node => {
      if (!node.id.startsWith(prefix)) return false
      const remaining = node.id.slice(prefix.length)
      return !remaining.includes('.')
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function getLocalName(childId: string, parentId: string, sectionName: string): string {
  return childId.slice(`${parentId}.${sectionName}.`.length)
}

function stringifyGraphYaml(value: unknown): string {
  return stringifyYaml(value, YAML_STRINGIFY_OPTIONS)
}

/**
 * Canonical property key order at serialisation time: template-declared
 * property order first, then any remaining (undeclared) keys alphabetically.
 * This keeps git diffs stable across import/merge paths that spread-merge
 * properties in arbitrary insertion order (see reconcile/index.ts).
 */
function orderNodeProperties(graph: Graph, node: Node): Record<string, unknown> {
  const template = graph.templates.get(node.template)
  const declaredOrder = template?.properties
    ? Object.keys(getPropertySchemasFromTemplate(template.properties))
    : []
  return orderKeys(node.properties, declaredOrder)
}

function orderEdgeProperties(graph: Graph, edge: Edge): Record<string, unknown> {
  const edgeTypeDef = graph.edgeTypes?.get(edge.type)
  const declaredOrder = edgeTypeDef?.properties
    ? Object.keys(getPropertySchemasFromTemplate(edgeTypeDef.properties))
    : []
  return orderKeys(edge.properties ?? {}, declaredOrder)
}

function orderKeys(obj: Record<string, unknown>, preferredOrder: string[]): Record<string, unknown> {
  const ordered: Record<string, unknown> = {}
  const remaining = new Set(Object.keys(obj))
  for (const key of preferredOrder) {
    if (remaining.has(key)) {
      ordered[key] = obj[key]
      remaining.delete(key)
    }
  }
  for (const key of [...remaining].sort()) {
    ordered[key] = obj[key]
  }
  return ordered
}

function toEdgeDocument(graph: Graph, edge: Edge): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    from: edge.from,
    to: edge.to,
    type: edge.type,
  }
  if (edge.state !== 'proposed') doc.state = edge.state
  if (edge.stability !== 'unstable') doc.stability = edge.stability
  if (edge.notes !== undefined) doc.notes = edge.notes
  if (edge.properties !== undefined && Object.keys(edge.properties).length > 0) {
    doc.properties = orderEdgeProperties(graph, edge)
  }
  return doc
}

function getAllEdges(graph: Graph): Edge[] {
  const edges = new Map<string, Edge>()
  for (const edgeList of graph.edgesByFrom.values()) {
    for (const edge of edgeList) {
      edges.set(edge.id, edge)
    }
  }
  return [...edges.values()]
}

function getRootNodes(graph: Graph): Node[] {
  const nodes = [...graph.nodesById.values()]
  return nodes
    .filter(node => !nodes.some(other => other.id !== node.id && node.id.startsWith(`${other.id}.`)))
    .sort((a, b) => a.id.localeCompare(b.id))
}
