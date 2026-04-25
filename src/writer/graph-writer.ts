import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Edge, Graph, Node } from '../schema/index.js'
import { getOwnedSections } from '../loader/pack-loader.js'
import { isPackRef } from '../loader/fs-utils.js'

export interface SaveGraphOptions {
  sourceGraphPath: string
  outputGraphPath: string
  replace?: boolean
}

const STRUCTURAL_EDGE_TYPES = new Set(['has-field', 'has-value'])
const YAML_STRINGIFY_OPTIONS = { singleQuote: true }

export async function saveGraph(graph: Graph, options: SaveGraphOptions): Promise<void> {
  const { sourceGraphPath, outputGraphPath, replace = true } = options

  if (fs.existsSync(outputGraphPath)) {
    if (!replace) {
      throw new Error(`output graph folder already exists: ${outputGraphPath}`)
    }
    fs.rmSync(outputGraphPath, { recursive: true, force: true })
  }
  fs.mkdirSync(outputGraphPath, { recursive: true })

  writeGraphYaml(sourceGraphPath, outputGraphPath)
  writeClusterFiles(graph, sourceGraphPath, outputGraphPath)
  writeExplicitEdges(graph, outputGraphPath)
}

function writeGraphYaml(sourceGraphPath: string, outputGraphPath: string): void {
  const sourceGraphYamlPath = path.join(sourceGraphPath, 'graph.yaml')
  const outputGraphYamlPath = path.join(outputGraphPath, 'graph.yaml')

  if (!fs.existsSync(sourceGraphYamlPath)) {
    fs.writeFileSync(outputGraphYamlPath, stringifyGraphYaml({ templatePacks: [] }))
    return
  }

  const doc = parseYaml(fs.readFileSync(sourceGraphYamlPath, 'utf-8')) as Record<string, unknown>
  const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
  doc.templatePacks = packs.map(pack => {
    if (!isPackRef(pack)) return pack
    const absolutePackPath = path.resolve(sourceGraphPath, pack.path)
    return {
      ...pack,
      path: normalizeYamlPath(path.relative(outputGraphPath, absolutePackPath)),
    }
  })

  fs.writeFileSync(outputGraphYamlPath, stringifyGraphYaml(doc))
}

function writeClusterFiles(graph: Graph, sourceGraphPath: string, outputGraphPath: string): void {
  const rootNodes = getRootNodes(graph)

  for (const root of rootNodes) {
    if (!root.extractedFrom) continue

    const relativeFilePath = path.relative(sourceGraphPath, root.extractedFrom)
    const outputFilePath = path.join(outputGraphPath, relativeFilePath)
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true })
    fs.writeFileSync(outputFilePath, stringifyGraphYaml(toClusterDocument(graph, root)))
  }
}

function toClusterDocument(graph: Graph, root: Node): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id: root.id,
    template: root.template,
    schemaVersion: root.schemaVersion,
    metadata: {
      component: root.component,
      state: root.state,
      stability: root.stability,
      lastModifiedAt: root.lastModifiedAt,
    },
  }

  if (Object.keys(root.properties).length > 0) {
    doc.properties = root.properties
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
      const childDoc: Record<string, unknown> = { ...child.properties }
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

function writeExplicitEdges(graph: Graph, outputGraphPath: string): void {
  const explicitEdges = getAllEdges(graph)
    .filter(edge => !STRUCTURAL_EDGE_TYPES.has(edge.type))
    .sort((a, b) => a.id.localeCompare(b.id))

  if (explicitEdges.length === 0) return

  const edgesDir = path.join(outputGraphPath, 'edges')
  fs.mkdirSync(edgesDir, { recursive: true })
  fs.writeFileSync(
    path.join(edgesDir, 'corum.edges.yaml'),
    stringifyGraphYaml({ edges: explicitEdges.map(toEdgeDocument) }),
  )
}

function stringifyGraphYaml(value: unknown): string {
  return stringifyYaml(value, YAML_STRINGIFY_OPTIONS)
}

function toEdgeDocument(edge: Edge): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    from: edge.from,
    to: edge.to,
    type: edge.type,
  }
  if (edge.state !== 'proposed') doc.state = edge.state
  if (edge.stability !== 'unstable') doc.stability = edge.stability
  if (edge.notes !== undefined) doc.notes = edge.notes
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

function normalizeYamlPath(value: string): string {
  return value.split(path.sep).join('/')
}
