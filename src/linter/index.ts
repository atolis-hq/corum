import type { Diagnostic, Edge, EdgeTypeDef, Graph, Node } from '../schema/index.js'
import { getEdgeTypeConstraints } from '../graph/roles.js'
import { CORE_EDGE_TYPE_MAP } from '../loader/constants.js'
import { validateNodeId } from '../loader/id-grammar.js'
import { getTemplateSchema } from '../loader/template-props.js'

/**
 * Full linter rule set (ADR-006 / ADR-006b, review finding S6).
 *
 * Runs against an already-loaded Graph and returns warning-severity
 * diagnostics in all but one case — the underlying structural invariants the
 * linter depends on (node/edge existence, template resolution) are already
 * enforced by the loader itself. The exception is the hidden-edge live-end
 * rule (error severity, see below), which can only fire on graphs assembled
 * in memory (mutations): the loader drops such edges before they ever reach
 * a loaded Graph, so `strict` loads are unaffected in practice.
 *
 * Rules implemented (see docs/adr/REF-006-rules.md for the full catalogue):
 *  - T-003/T-004/T-005: node properties validated (shallow) against the
 *    owning template's JSON-schema-like `properties` block.
 *  - E-005/E-006: explicit (non-generated) edges validated against the
 *    endpoint templates' declared `edge-types` outgoing/incoming/supports.
 *  - Edge property validation: edge.properties validated against the
 *    matching EdgeTypeDef's `properties` schema, using the same shallow
 *    validator as node properties.
 *  - ADR-009b rule 5: flags an inline schema (`{rootId}.schemas.{name}`)
 *    whose (component, name) matches an existing standalone schema
 *    (`{component}.Schema.{name}`) — the order-dependent interim state
 *    between an importer creating the inline copy and a later re-import
 *    converging it via reuse-before-inline.
 *  - Design §11 (node identity): hidden edge types (bookkeeping such as
 *    renamed-from) are exempt from endpoint checks on `to` — a retired ID is
 *    legitimate there — but their `from` must be a live node (error).
 *    `previousNames` is a system property on any node: a list of valid node
 *    IDs, each expected to differ from the node's current ID (warnings).
 */
export function lintGraph(graph: Graph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  lintNodeProperties(graph, diagnostics)
  lintPreviousNames(graph, diagnostics)
  lintEdgeTypeConstraints(graph, diagnostics)
  lintEdgeProperties(graph, diagnostics)
  lintHiddenEdgeLiveEnds(graph, diagnostics)
  lintInlineStandaloneSchemaCollisions(graph, diagnostics)
  return diagnostics
}

/**
 * System-owned node properties, valid on any node regardless of the owning
 * template's property schema (see design §11: `previousNames` rename trail).
 */
const SYSTEM_NODE_PROPERTIES = new Set(['previousNames'])

function getEdgeTypeDefs(graph: Graph): ReadonlyMap<string, EdgeTypeDef> {
  return graph.edgeTypes ?? CORE_EDGE_TYPE_MAP
}

/**
 * Per-node lint primitive (design §7: mutations reuse the linter's checks).
 * Property-schema and previousNames rules for a single node — same rules and
 * severities `lintGraph` applies graph-wide.
 */
export function lintNode(graph: Graph, node: Node): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  lintNodePropertiesFor(graph, node, diagnostics)
  lintPreviousNamesFor(graph, node, diagnostics)
  return diagnostics
}

/**
 * Per-edge lint primitive (design §7). Endpoint edge-type constraints, edge
 * property schema, and the hidden-edge live-end rule for a single edge —
 * same rules and severities `lintGraph` applies graph-wide. The edge does
 * not need to be inserted in the graph's indexes yet.
 */
export function lintEdge(graph: Graph, edge: Edge): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const edgeTypes = getEdgeTypeDefs(graph)
  lintEdgeConstraintsFor(graph, edge, edgeTypes, diagnostics)
  lintEdgePropertiesFor(graph, edge, diagnostics)
  lintHiddenEdgeLiveEndFor(graph, edge, edgeTypes, diagnostics)
  return diagnostics
}

function lintInlineStandaloneSchemaCollisions(graph: Graph, diagnostics: Diagnostic[]): void {
  for (const node of graph.nodesById.values()) {
    const parts = node.id.split('.')
    // Only inline schema nodes themselves (`{rootId}.schemas.{name}`) — not their
    // fields/descendants, and not standalone schemas (`{component}.Schema.{name}`).
    if (parts.length < 3 || parts[parts.length - 2] !== 'schemas') continue

    const name = parts[parts.length - 1]
    const standaloneId = `${node.component}.Schema.${name}`
    const standalone = graph.nodesById.get(standaloneId)
    if (!standalone || standalone.state === 'removed') continue

    diagnostics.push({
      severity: 'warning',
      file: approxFilePath(graph, node),
      nodeId: node.id,
      message: `inline schema '${node.id}' collides with existing standalone schema '${standaloneId}' — re-import to converge via reuse-before-inline`,
    })
  }
}

function lintNodeProperties(graph: Graph, diagnostics: Diagnostic[]): void {
  for (const node of graph.nodesById.values()) {
    lintNodePropertiesFor(graph, node, diagnostics)
  }
}

function lintNodePropertiesFor(graph: Graph, node: Node, diagnostics: Diagnostic[]): void {
  const template = graph.templates.get(node.template)
  if (!template?.properties) return
  const schema = getTemplateSchema(template.properties)
  const file = approxFilePath(graph, node)

  if (!schema.additionalProperties) {
    for (const key of Object.keys(node.properties)) {
      if (SYSTEM_NODE_PROPERTIES.has(key)) continue
      if (!(key in schema.properties)) {
        diagnostics.push({
          severity: 'warning',
          file,
          nodeId: node.id,
          message: `unknown property '${key}' is not declared in template '${node.template}'`,
        })
      }
    }
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const value = node.properties[key]
    if (value === undefined) continue
    const type = (propSchema as Record<string, unknown>).type
    if (typeof type === 'string' && !valueMatchesType(value, type)) {
      diagnostics.push({
        severity: 'warning',
        file,
        nodeId: node.id,
        message: `property '${key}' expected type '${type}' but got '${describeType(value)}'`,
      })
    }
  }

  for (const key of schema.required) {
    if (node.properties[key] === undefined) {
      diagnostics.push({
        severity: 'warning',
        file,
        nodeId: node.id,
        message: `missing required property '${key}' declared by template '${node.template}'`,
      })
    }
  }
}

/**
 * Design §11: `previousNames` (rename trail) must be a list of valid node
 * IDs, each expected to differ from the node's current ID. Warnings only.
 */
function lintPreviousNames(graph: Graph, diagnostics: Diagnostic[]): void {
  for (const node of graph.nodesById.values()) {
    lintPreviousNamesFor(graph, node, diagnostics)
  }
}

function lintPreviousNamesFor(graph: Graph, node: Node, diagnostics: Diagnostic[]): void {
  const value = node.properties.previousNames
  if (value === undefined) return
  const file = approxFilePath(graph, node)

  if (!Array.isArray(value)) {
    diagnostics.push({
      severity: 'warning',
      file,
      nodeId: node.id,
      message: `property 'previousNames' must be a list of node ids but got '${describeType(value)}'`,
    })
    return
  }

  for (const entry of value) {
    if (typeof entry !== 'string') {
      diagnostics.push({
        severity: 'warning',
        file,
        nodeId: node.id,
        message: `'previousNames' entries must be node id strings but got '${describeType(entry)}'`,
      })
      continue
    }
    const idError = validateNodeId(entry)
    if (idError) {
      diagnostics.push({
        severity: 'warning',
        file,
        nodeId: node.id,
        message: `'previousNames' entry is not a valid node id: ${idError}`,
      })
    } else if (entry === node.id) {
      diagnostics.push({
        severity: 'warning',
        file,
        nodeId: node.id,
        message: `'previousNames' contains the node's current id '${node.id}'`,
      })
    }
  }
}

/**
 * Design §11: a hidden edge type's `from` is the live end and must resolve
 * to a live node (e.g. a `renamed-from` edge whose `from` does not exist is
 * an error). The loader already drops such edges at load time, so this rule
 * only fires on graphs assembled in memory (mutation working graphs).
 * The dangling `to` of a hidden edge is intentional and never flagged.
 */
function lintHiddenEdgeLiveEnds(graph: Graph, diagnostics: Diagnostic[]): void {
  const edgeTypes = getEdgeTypeDefs(graph)
  for (const [from, edges] of graph.edgesByFrom) {
    if (graph.nodesById.has(from)) continue
    for (const edge of edges) {
      lintHiddenEdgeLiveEndFor(graph, edge, edgeTypes, diagnostics)
    }
  }
}

function lintHiddenEdgeLiveEndFor(
  graph: Graph,
  edge: Edge,
  edgeTypes: ReadonlyMap<string, EdgeTypeDef>,
  diagnostics: Diagnostic[],
): void {
  if (edgeTypes.get(edge.type)?.hidden !== true) return
  if (graph.nodesById.has(edge.from)) return
  diagnostics.push({
    severity: 'error',
    file: edge.id,
    message: `hidden edge type '${edge.type}' requires a live 'from' node: ${edge.from} (edge ${edge.id})`,
  })
}

function lintEdgeTypeConstraints(graph: Graph, diagnostics: Diagnostic[]): void {
  const edgeTypes = getEdgeTypeDefs(graph)
  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) {
      lintEdgeConstraintsFor(graph, edge, edgeTypes, diagnostics)
    }
  }
}

function lintEdgeConstraintsFor(
  graph: Graph,
  edge: Edge,
  edgeTypes: ReadonlyMap<string, EdgeTypeDef>,
  diagnostics: Diagnostic[],
): void {
  if (edge.generated) return
  // Hidden edge types are system bookkeeping (e.g. renamed-from trails):
  // templates never declare them, so constraint checks do not apply.
  if (edgeTypes.get(edge.type)?.hidden === true) return

  const fromNode = graph.nodesById.get(edge.from)
  if (fromNode) {
    const constraints = getEdgeTypeConstraints(graph.templates, fromNode.template)
    if (constraints) {
      const allowed = new Set([...(constraints.outgoing ?? []), ...(constraints.supports ?? [])])
      if (!allowed.has(edge.type)) {
        diagnostics.push({
          severity: 'warning',
          file: approxFilePath(graph, fromNode),
          nodeId: fromNode.id,
          message: `edge type '${edge.type}' is not declared as outgoing or supported by template '${fromNode.template}' (edge ${edge.id})`,
        })
      }
    }
  }

  const toNode = graph.nodesById.get(edge.to)
  if (toNode) {
    const constraints = getEdgeTypeConstraints(graph.templates, toNode.template)
    if (constraints) {
      const allowed = new Set([...(constraints.incoming ?? []), ...(constraints.supports ?? [])])
      if (!allowed.has(edge.type)) {
        diagnostics.push({
          severity: 'warning',
          file: approxFilePath(graph, toNode),
          nodeId: toNode.id,
          message: `edge type '${edge.type}' is not declared as incoming or supported by template '${toNode.template}' (edge ${edge.id})`,
        })
      }
    }
  }
}

function lintEdgeProperties(graph: Graph, diagnostics: Diagnostic[]): void {
  if (!graph.edgeTypes) return

  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) {
      lintEdgePropertiesFor(graph, edge, diagnostics)
    }
  }
}

function lintEdgePropertiesFor(graph: Graph, edge: Edge, diagnostics: Diagnostic[]): void {
  const def = graph.edgeTypes?.get(edge.type)
  if (!def?.properties) return

  const schema = getTemplateSchema(def.properties)
  const props = edge.properties ?? {}
  const file = edgePropertyFile(graph, edge)

  if (!schema.additionalProperties) {
    for (const key of Object.keys(props)) {
      if (!(key in schema.properties)) {
        diagnostics.push({
          severity: 'warning',
          file,
          message: `edge '${edge.id}' has unknown property '${key}' not declared by edge type '${edge.type}'`,
        })
      }
    }
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const value = props[key]
    if (value === undefined) continue
    const type = (propSchema as Record<string, unknown>).type
    if (typeof type === 'string' && !valueMatchesType(value, type)) {
      diagnostics.push({
        severity: 'warning',
        file,
        message: `edge '${edge.id}' property '${key}' expected type '${type}' but got '${describeType(value)}'`,
      })
    }
  }

  for (const key of schema.required) {
    if (props[key] === undefined) {
      diagnostics.push({
        severity: 'warning',
        file,
        message: `edge '${edge.id}' missing required property '${key}' declared by edge type '${edge.type}'`,
      })
    }
  }
}

function edgePropertyFile(graph: Graph, edge: Edge): string {
  const fromNode = graph.nodesById.get(edge.from)
  return fromNode ? approxFilePath(graph, fromNode) : edge.id
}

/** Best-effort node-id-to-cluster-file mapping (mirrors writer/graph-writer.ts clusterPath), for diagnostic messages only. */
function approxFilePath(graph: Graph, node: Node): string {
  let current = node
  while (current.parentId) {
    const parent = graph.nodesById.get(current.parentId)
    if (!parent) break
    current = parent
  }
  const parts = current.id.split('.')
  if (parts.length < 2) return current.id
  const [component, template, ...rest] = parts
  return `components/${component}/${template}s/${rest.join('/') || template}.yaml`
}

function valueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'number': return typeof value === 'number'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
    default: return true
  }
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}
