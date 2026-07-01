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

1. Orient - call get_graph_summary first. Returns node count, component count, orphan count, edge counts by type, and diagnostic count.

2. Discover valid values - call get_graph_metadata when you need the available template names, edge types, or enum values for filters and traversal options.

3. Find nodes - use search_nodes with one or more terms (OR semantics). It fuzzy-matches node IDs and, when search_properties is enabled, names, descriptions, and x-aka aliases. Pass templates to restrict to a type, for example ["DomainModel"].

4. Inspect a node - use get_cluster with a fully-qualified node ID. Returns the root, its owned descendants, and included semantic neighbors.

5. Trace relationships - use get_lineage from one or more node IDs. Default: depth 2 downstream. Use direction "both" and a higher depth to see event flow around a node. Each result node carries origin_id, depth, via_edge_type, and via_node_id. When multiple origins reach the same node, origins lists all origin IDs.

6. Broad scan - use get_graph or list_nodes with filters to fetch nodes across the graph. get_graph supports templates, exclude_templates, component, state, and stability filters.

## Output format tips

- Default format is YAML.
- Use format "json" when you want conventional structured output for downstream parsing.
- Use format "toon" when you want the most token-efficient machine-readable output, especially for large node or edge lists.
- Add compact_keys true to shorten common keys (id->i, template->t, component->cp, state->s, stability->st).

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
  get_cluster - descendants include owned schemas, fields, and enum values
`.trim()
