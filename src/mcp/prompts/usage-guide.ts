/**
 * The orientation guide is built per-graph so the Concepts section can name the
 * templates actually loaded, instead of hard-coding pack-specific examples that
 * mislead when a different pack is in use. Pass the loaded template names; with
 * none, it defers to get_graph_metadata.
 */
export function buildUsageGuidePrompt(templateNames: string[] = []): string {
  const templatesLine = templateNames.length
    ? templateNames.join(', ')
    : '(call get_graph_metadata to list them)'

  return `
# Corum graph - orientation guide

Corum models service architecture as a typed graph, stored in Git.

## Concepts

- **Node**: a design artifact whose type is one of this graph's templates (listed below). Each has a template, component, lifecycle state, stability, and properties.
- **Template**: a node's type. Defines its property schema, which sections it owns, and which edge types it may use; templates can extend others. Templates in this graph: ${templatesLine}.
- **Component**: the top-level grouping a node belongs to (the first id segment).
- **Cluster**: one root node plus the owned-child subtree its template materializes (e.g. a model owns schemas, which own fields). One YAML file = one cluster.
- **Edge**: a typed, directed relationship between two nodes.
  - *Structural* edges (has-field, has-value, renamed-from) are auto-generated from ownership and excluded from traversal by default.
  - *Semantic* edges (triggers, produces, reads, calls, implements, maps-to, derived-from) are the modeled relationships that get_lineage / get_cluster traverse. These are the core types; packs may add more.
  - Call get_graph_metadata for the templates and edge types actually present in this graph.

## Node IDs

A dot path encoding the ownership hierarchy:

  {component}.{Template}.{name}                     - root node
  {component}.{Template}.{name}.{section}.{child}   - owned child

The Template segment is one of this graph's templates, so a root id already tells you its component and template. search_nodes and list_nodes return root nodes only.

## Graph completeness

The graph reflects modeled relationships, not guaranteed-complete truth. Missing edges do not prove no relationship exists. Treat naming, shared component context, schema similarity, and lineage adjacency as hypotheses, then verify against the relevant nodes, clusters, and source.

## Recommended workflow

1. Call get_graph_metadata first — learn which templates and edge types actually exist. Only traverse edge types listed in edge_types_in_use.
2. search_nodes with domain terms to find starting nodes. Avoid list_nodes for discovery — it returns full inventories rather than ranked matches.
3. get_lineage with node_ids batched together in one call. direction "downstream" for what a node leads to, "upstream" for what leads into it, "both" for full flow. Bound with the smallest depth that answers the question; narrow with edge_types / node_types before increasing depth.
4. get_cluster only when you need one node's structural detail, not for traversal.
5. Add include_provenance: true only to bridge a finding back to source code.

## Token economy

Prefer the smallest response that answers the question.

- Responses default to format "toon" (lean, self-describing). Use format "yaml" for human-readable output, format "json" for conventional parsing. Add compact_keys: true to further shorten envelope keys (mapping below).
- Expensive tools — bound them:
  - get_graph returns the whole graph; prefer search_nodes or get_lineage for anything targeted.
  - get_cluster returns the root with its collapsed schemas/enums; owned descendants are opt-in (include_descendants: true) and can be large. Narrow with node_types.
  - search_nodes returns slim summaries (id, template, component, state, stability); full_nodes: true adds every property and is far larger — leave it off unless you need the bodies. Bound with page_size.
- Keep include_provenance and include_edges off unless needed.
- get_lineage is lean by default (only i, oi, d, vet, vni per node) and omits edges; set lean:false / include_edges:true only when you need full nodes or edge-level detail.

When compact_keys is true these keys are shortened:

  id              -> i      template        -> t      component       -> cp
  state           -> s      stability       -> st     properties      -> p
  nodes           -> n      edges           -> e      root            -> r
  children        -> ch     from            -> fr     to              -> to
  type            -> ty     notes           -> nt     version         -> v
  core            -> c      abstract        -> a      extends         -> ex
  origin_id       -> oi     depth           -> d      via_edge_type   -> vet
  via_node_id     -> vni    lastModifiedAt  -> lm     extractedFrom   -> xf
  derivation      -> dv     derivedBy       -> db

## Common patterns

(all default to toon; add compact_keys: true to shrink further)

- Nodes of given templates in a component: list_nodes, filter { templates: [...], component: "..." }.
- What does this node produce? get_lineage, direction "downstream", edge_types ["produces"], depth 1.
- What triggers this node? get_lineage, direction "upstream", edge_types ["triggers"], depth 1.
- Full flow around a node: get_lineage, direction "both", depth 3.
- Field-level mappings: get_linked_fields for maps-to edges on fields owned by a root node.
- Schema / field detail: get_cluster (collapse_schemas true, the default) returns each schema as a compact map of field name to { type?, $ref?, collection?, nullable?, edges? } — not child nodes. Local refs use $ref: '#/schemas/name' or '#/enums/name'. Map fields appear as { type: map, key, value }. Cross-cluster field edges (maps-to, derived-from) appear in the field's edges block. Set collapse_schemas false only to get the raw child nodes instead.

## Write workflow

Mutations require an open session; no write tool works without one.

1. start_changes first. Prefer autosave: false unless you want per-mutation checkpoints (on file sources autosave writes through immediately, producing granular/noisy history).
2. Mutate: apply_cluster (cluster-style upserts); create_node / update_node / rename_node / delete_node; create_edges / update_edge / delete_edge; create_fields (batch field creation).
3. pending_changes to inspect the journal and summary diff before committing.
4. commit_changes (error diagnostics block it; session stays open to fix) or discard_changes.

Key rules:
- rename_node is the only rename path. apply_cluster and imports never infer renames.
- apply_cluster mode "replace" is authoritative: children absent from the document are deleted, and an absent owned section means an empty section.
- delete_node soft-deletes (state removed, still queryable) when the node is shared history on the default branch, else hard-deletes; purge:true forces hard.
- discard_changes only rolls back in-memory state, not autosaved file-source writes.
- While a session is open, reads reflect its working graph.
`.trim()
}

/** Base guide with no graph-specific template list; prefer buildUsageGuidePrompt(templateNames). */
export const USAGE_GUIDE_PROMPT = buildUsageGuidePrompt()
