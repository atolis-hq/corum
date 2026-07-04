import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Edge, EdgeType, Node, Stability, State, Template } from '../schema/index.js'
import { getOwnedSections } from './pack-loader.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'
import { VALID_STABILITY_SET, VALID_STATE_SET } from './constants.js'
import { validateRootId, validateSegment } from './id-grammar.js'
import { getTemplateRole } from '../graph/roles.js'
import { getPropertySchemasFromTemplate } from './template-props.js'

/** Containment edge generated for owned children, keyed by the child template's declared role. */
const STRUCTURAL_EDGE_BY_ROLE: Partial<Record<string, EdgeType>> = {
  field: 'has-field',
  value: 'has-value',
}

export type ClusterResult = {
  nodes: Map<string, Node>
  edgesByFrom: Map<string, Edge[]>
  edgesByTo: Map<string, Edge[]>
}

type RootRecord = Record<string, unknown> & {
  id?: unknown
  template?: unknown
  schemaVersion?: unknown
  metadata?: unknown
  corum?: unknown
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

    const idError = validateRootId(record.id)
    if (idError) {
      diagnostics.push({ severity: 'error', file: key, message: idError })
      continue
    }

    const root: Node = {
      id: record.id,
      template: record.template,
      component: meta.component,
      state: asState(meta.state, 'proposed', diagnostics, key, record.id),
      stability: asStability(meta.stability, 'unstable', diagnostics, key, record.id),
      schemaVersion: record.schemaVersion,
      lastModifiedAt: meta.lastModifiedAt,
      ...(typeof meta.extractedFrom === 'string' && { extractedFrom: meta.extractedFrom }),
      ...(typeof meta.derivation === 'string' && { derivation: meta.derivation as Node['derivation'] }),
      ...(typeof meta.derivedBy === 'string' && { derivedBy: meta.derivedBy }),
      ...(extractCorum(record.corum, record.properties) !== undefined && { corum: extractCorum(record.corum, record.properties) }),
      properties: isRecord(record.properties) ? stripLegacyBookkeeping(record.properties) : {},
    }

    addNode(result, root, key, diagnostics)
    const rootTemplate = templates.get(root.template)
    if (rootTemplate) {
      for (const target of getNodeRefTargets(root, rootTemplate)) {
        const usesTypeId = `${root.id}__uses-type__${target}`
        const existingFrom = result.edgesByFrom.get(root.id) ?? []
        if (!existingFrom.some(e => e.id === usesTypeId)) {
          addEdge(result, {
            id: usesTypeId, from: root.id, to: target, type: 'uses-type',
            state: root.state, stability: root.stability, generated: true,
          })
        }
      }
    }
    materialiseChildren(result, root, root, record, templates, key, diagnostics)
  }

  return result
}

function getNodeRefTargets(node: Node, template: Template): string[] {
  if (!template.properties) return []
  const propSchemas = getPropertySchemasFromTemplate(template.properties as Record<string, unknown>)
  const targets: string[] = []
  for (const [key, schema] of Object.entries(propSchemas)) {
    const s = schema as Record<string, unknown>
    if (s.format === 'node-ref') {
      const value = node.properties[key]
      if (typeof value === 'string' && !value.startsWith('#/')) targets.push(value)
    } else if (
      s.type === 'object' &&
      typeof s.additionalProperties === 'object' &&
      s.additionalProperties !== null &&
      (s.additionalProperties as Record<string, unknown>).format === 'node-ref'
    ) {
      const map = node.properties[key]
      if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
        for (const value of Object.values(map as Record<string, unknown>)) {
          if (typeof value === 'string' && !value.startsWith('#/')) targets.push(value)
        }
      }
    }
  }
  return targets
}

/**
 * Materialise owned children of `parent` from a cluster-style `source`
 * record into `result` (nodes + structural edges), recursively. Exported for
 * the mutation engine's `createNode` (design §7/§8), which reuses the exact
 * loader semantics for owned-child creation instead of reimplementing them.
 */
export function materialiseChildren(
  result: ClusterResult,
  parent: Node,
  clusterRoot: Node,
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
      const segmentError = validateSegment(localName)
      if (segmentError) {
        diagnostics.push({
          severity: 'error',
          file: filePath,
          nodeId: parent.id,
          message: `owned item name '${localName}' in ${sectionName}: ${segmentError}`,
        })
        continue
      }

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
        parentId: parent.id,
        template: childTemplateName,
        component: parent.component,
        state: asState(value.state, parent.state, diagnostics, filePath, childId),
        stability: asStability(value.stability, parent.stability, diagnostics, filePath, childId),
        schemaVersion: parent.schemaVersion,
        lastModifiedAt: parent.lastModifiedAt,
        ...(extractCorum(value.corum, value) !== undefined && { corum: extractCorum(value.corum, value) }),
        properties: stripOwnedSections(value, childTemplateName, templates),
      }

      addNode(result, child, filePath, diagnostics)
      const childRole = getTemplateRole(templates, childTemplateName)
      const edgeType = childRole !== undefined ? STRUCTURAL_EDGE_BY_ROLE[childRole] : undefined
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
      const childTemplate = templates.get(child.template)
      if (childTemplate) {
        for (const target of getNodeRefTargets(child, childTemplate)) {
          const usesTypeId = `${clusterRoot.id}__uses-type__${target}`
          const existingFrom = result.edgesByFrom.get(clusterRoot.id) ?? []
          if (!existingFrom.some(e => e.id === usesTypeId)) {
            addEdge(result, {
              id: usesTypeId,
              from: clusterRoot.id,
              to: target,
              type: 'uses-type',
              state: clusterRoot.state,
              stability: clusterRoot.stability,
              generated: true,
            })
          }
        }
      }
      materialiseChildren(result, child, clusterRoot, value, templates, filePath, diagnostics)
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
  const nodeMetadata = new Set(['state', 'stability', 'corum', 'previousNames'])
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ownedSections.has(key) && !nodeMetadata.has(key)))
}

function stripLegacyBookkeeping(properties: Record<string, unknown>): Record<string, unknown> {
  const { previousNames: _previousNames, ...rest } = properties
  return rest
}

function extractCorum(corumValue: unknown, propertySource?: unknown): Node['corum'] | undefined {
  const previousIds = extractPreviousIds(corumValue)
  if (previousIds !== undefined) return { identity: { previousIds } }

  if (isRecord(propertySource) && Array.isArray(propertySource.previousNames)) {
    return {
      identity: {
        previousIds: propertySource.previousNames.filter((value): value is string => typeof value === 'string'),
      },
    }
  }
  return undefined
}

function extractPreviousIds(corumValue: unknown): string[] | undefined {
  if (!isRecord(corumValue)) return undefined
  const identity = corumValue.identity
  if (!isRecord(identity) || !Array.isArray(identity.previousIds)) return undefined
  return identity.previousIds.filter((value): value is string => typeof value === 'string')
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

function asState(value: unknown, fallback: State, diagnostics: Diagnostic[], file: string, nodeId: string): State {
  if (value === undefined) return fallback
  if (typeof value === 'string' && VALID_STATE_SET.has(value)) return value as State
  diagnostics.push({ severity: 'warning', file, nodeId, message: `invalid state '${String(value)}', defaulting to '${fallback}'` })
  return fallback
}

function asStability(value: unknown, fallback: Stability, diagnostics: Diagnostic[], file: string, nodeId: string): Stability {
  if (value === undefined) return fallback
  if (typeof value === 'string' && VALID_STABILITY_SET.has(value)) return value as Stability
  diagnostics.push({ severity: 'warning', file, nodeId, message: `invalid stability '${String(value)}', defaulting to '${fallback}'` })
  return fallback
}
