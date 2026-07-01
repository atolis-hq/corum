export const USAGE_GUIDE_PROMPT = `
# Corum graph - orientation guide

Corum models service architecture as a typed graph. Nodes are design artifacts; edges are typed relationships between them.

## Node IDs

IDs encode the ownership hierarchy as a dot-separated path:

  {component}.{Template}.{name}                      - root node
  {component}.{Template}.{name}.{section}.{child}   - owned child (for example operations, schemas, fields)

Examples:
  orders.DomainModel.order
  orders.DomainModel.order.operations.place
  orders.APIEndpoint.create-order

search_nodes and list_nodes only return root nodes.

## Edge types

Semantic (traversed by default in get_lineage / get_cluster):
  triggers, produces, reads, calls, implements, maps-to, derived-from

Structural (excluded from traversal by default):
  has-field, has-value, renamed-from

## Graph completeness

The graph reflects modeled relationships, not guaranteed complete truth. Missing edges do not prove no relationship exists.

When likely relationships are absent, treat naming, shared component context, schema similarity, and lineage adjacency as hypotheses. Then verify by inspecting the relevant nodes, clusters, and source material.

## Recommended workflow

1. Call get_graph_metadata first to discover which edge types are in use and what node templates exist.

2. Use search_nodes with domain terms to find relevant starting nodes. Avoid list_nodes for discovery - it returns full inventories rather than ranked matches.

3. Call get_lineage with multiple node_ids batched together rather than separate calls per node.

4. Use direction "downstream" with depth 2 from events to trace event -> command -> operation chains.

5. Use direction "upstream" from a DomainModel node to find all writers to that aggregate.

6. Avoid get_cluster for traversal questions - use it only when you need a node's full structural detail. Prefer get_lineage for following relationships.

7. Add include_provenance: true only when you need to bridge a finding to the source codebase.

## Output format and token efficiency

Start with format "toon" and compact_keys true. TOON is the most token-efficient machine-readable format and compact_keys shortens common field names. Fall back to format "yaml" if a downstream consumer needs human-readable output, or format "json" if it needs conventional structured parsing.

When compact_keys is true the following field names are shortened in the response:

  id              → i      template        → t      component       → cp
  state           → s      stability       → st     properties      → p
  nodes           → n      edges           → e      root            → r
  children        → ch     from            → fr     to              → to
  type            → ty     notes           → nt     version         → v
  core            → c      abstract        → a      extends         → ex
  origin_id       → oi     depth           → d      via_edge_type   → vet
  via_node_id     → vni    lastModifiedAt  → lm     extractedFrom   → xf
  derivation      → dv     derivedBy       → db

- get_lineage is lean by default: it returns only id (i), origin_id (oi), depth (d), via_edge_type (vet), and via_node_id (vni) unless lean is set to false.
- get_lineage omits edges by default; add include_edges true when you need graph reconstruction or edge-level auditing.

## Common patterns

All events in a component:
  list_nodes - filter { templates: ["DomainEvent", "IntegrationEvent"], component: "orders" }

What does an operation produce?
  get_lineage - node_ids: ["orders.DomainModel.order.operations.place"], direction: "downstream"

What triggers an operation?
  get_lineage - node_ids: ["orders.DomainModel.order.operations.complete"], direction: "upstream"

Full event flow around a node:
  get_lineage - node_ids: ["orders.DomainEvent.order-placed"], direction: "both", depth: 3

Field-level mappings between nodes:
  get_linked_fields - returns all maps-to edges touching fields owned by a root node

Schema / field details:
  get_cluster - root includes compact schemas and enums blocks by default. Each schema entry
  is a map of field name to { type?, $ref?, collection?, nullable?, edges? }. Local references
  use $ref: '#/schemas/name' or $ref: '#/enums/name' pointing into the same blocks. Mapping
  fields appear as { type: map, key: string, value: { ... } } inline on the field. Field-level
  cross-cluster edges (maps-to, derived-from) appear as an edges block on the field. Pass
  collapse_schemas: false to get the full structural node-per-field representation instead.
`.trim()
