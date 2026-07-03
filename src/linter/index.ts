import type { Diagnostic, Edge, Graph, Node } from '../schema/index.js'
import { getEdgeTypeConstraints } from '../graph/roles.js'
import { getTemplateSchema } from '../loader/template-props.js'

/**
 * Full linter rule set (ADR-006 / ADR-006b, review finding S6).
 *
 * Runs against an already-loaded Graph and returns warning-severity
 * diagnostics only — the linter never raises errors, since the underlying
 * structural invariants it depends on (node/edge existence, template
 * resolution) are already enforced by the loader itself. Callers append the
 * result to the loader's diagnostics array; `strict` loads are unaffected
 * because they only throw on `error` severity.
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
 */
export function lintGraph(graph: Graph): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  lintNodeProperties(graph, diagnostics)
  lintEdgeTypeConstraints(graph, diagnostics)
  lintEdgeProperties(graph, diagnostics)
  lintInlineStandaloneSchemaCollisions(graph, diagnostics)
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
    const template = graph.templates.get(node.template)
    if (!template?.properties) continue
    const schema = getTemplateSchema(template.properties)
    const file = approxFilePath(graph, node)

    if (!schema.additionalProperties) {
      for (const key of Object.keys(node.properties)) {
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
}

function lintEdgeTypeConstraints(graph: Graph, diagnostics: Diagnostic[]): void {
  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) {
      if (edge.generated) continue

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
  }
}

function lintEdgeProperties(graph: Graph, diagnostics: Diagnostic[]): void {
  if (!graph.edgeTypes) return

  for (const edges of graph.edgesByFrom.values()) {
    for (const edge of edges) {
      const def = graph.edgeTypes.get(edge.type)
      if (!def?.properties) continue

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
