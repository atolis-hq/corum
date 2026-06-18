# ADR-003b: Core Logical Data Model

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-002 (Graph File Format and Cluster Boundaries)  
**Depended on by:** ADR-003 (Graph Loading and Runtime Representation), ADR-004 (Template Pack Format), ADR-005 (MCP Tool Surface)

---

## Context and Problem Statement

ADR-003 decided that the MCP server loads the graph into a SQLite query layer. ADR-004 and ADR-005 both need to reference what the graph *contains* — the entities, their properties, and their relationships — independently of how those entities are stored or queried.

This ADR defines the **language-agnostic logical data model**: the named entities, their mandatory and optional properties, and the relationships between them. It is the contract that the file format (ADR-002), the runtime storage layer (ADR-003), the template pack system (ADR-004), and the MCP tool surface (ADR-005) all implement against.

This ADR does not define SQL schemas, TypeScript types, or JSON shapes. Those are implementation concerns. It defines the model in the same way an entity-relationship diagram would — names, cardinalities, and constraints in plain terms.

---

## Decision Drivers

- **Completeness over minimalism.** The model must be expressive enough to represent the full range of design artefacts the tool is intended to capture — API endpoints, domain models, events, operations, fields, enums, invariants, and their relationships — without forcing teams to use every concept.
- **Everything is a node or an edge.** The runtime graph is uniform. Cluster files group owned nodes for readability, but at runtime every field, every enum value, every invariant is a node. There is no special-cased sub-entity type.
- **Consistency with the file format.** The logical model must map cleanly to the cluster file schemas defined in ADR-002. Every property that appears in a YAML file has a corresponding field in the logical model, and vice versa.
- **State and stability are first-class on every node.** Not optional metadata — mandatory queryable properties on every node, regardless of template type. Agents and the drift detection engine rely on these.
- **Edges carry their own state and stability.** A relationship between two nodes may itself be in-flight, agreed, or deprecated independently of either endpoint.

---

## The Logical Model

### Universal node properties

Every node in the graph — regardless of template type — carries the following properties. These are validated by `node.schema.yaml` in the core pack.

| Property | Type | Required on root | Description |
|---|---|---|---|
| `id` | string | yes | Globally unique, fully qualified. Format: `{component}.{TemplateName}.{name}[.{section}.{key}...]` |
| `template` | string | yes | Template type name from the active template pack (e.g. `APIEndpoint`, `DomainModel`) |
| `component` | string | yes | The bounded context this node belongs to; must match the first segment of `id` |
| `state` | enum | yes | `draft` \| `proposed` \| `agreed` \| `future` \| `removed` \| `implemented` |
| `stability` | enum | yes | `unstable` \| `stable` \| `deprecated` |
| `schemaVersion` | string | yes | File format version this node was written against |
| `lastModifiedAt` | date | yes | ISO 8601 date of last change |
| `extractedFrom` | string | no | Source file path if extracted from code; omitted for human-authored nodes |
| `derivation` | enum | no | `determined` \| `inferred` \| `manual`. How this node was established. Orthogonal to `state`. Defaults to `manual`. See [Amendment 2026-06-17](#amendment-2026-06-17--the-derivation-confidence-axis). |
| `derivedBy` | string | no | Identifier of the producer/method that established this node, e.g. `extractor:treesitter`, `adapter:openapi`, `linker:llm`. |
| `properties` | map | no | Template-defined additional properties; validated against the template's property schema |

**Root-default-with-child-override:** In cluster files, `state` and `stability` are declared on the root node and inherited by all owned child nodes (fields, enum values, invariants, operations). A child node may declare its own `state` or `stability` to override the root's value — for example, a single enum value marked `stability: deprecated` while the rest of the enum remains `stable`. All other universal properties (`id`, `template`, `component`, `schemaVersion`, `lastModifiedAt`) are derived for child nodes and must not be declared inline. The full universal property schema is defined in `.corum/packs/core/node.schema.yaml`.

**State semantics:**

| State | Layer | Meaning |
|---|---|---|
| `draft` | Design | Uncertain or incomplete — flagged as needing more thought |
| `proposed` | Design | Default working state — coherent, visible, actionable |
| `agreed` | Design | Consciously signed off — stable design intent |
| `future` | Design | Intentionally deferred — known but out of scope |
| `removed` | Design | Deliberately retired — history preserved, never hard deleted |
| `implemented` | Derived | Exists in merged code — set by extraction, never manually |

**Stability semantics:**

| Stability | Meaning |
|---|---|
| `unstable` | Default — contract is in flux; breaking changes expected |
| `stable` | Team has declared this contract worth protecting |
| `deprecated` | Being retired; changes trend toward removal |

---

### Node types (from the default template pack)

Template types specialise the universal node with additional required or optional properties defined by the template pack (ADR-004). The core types in the default pack are:

| Template | `abstract` | Primary purpose | Key additional properties |
|---|---|---|---|
| `Event` | true | Abstract base for all event types | owns `payload` schema with `fields` |
| `APIEndpoint` | false | HTTP contract boundary | `method`, `path`, `auth`; owns `request` and `response` schema clusters |
| `DomainModel` | false | Domain entity or aggregate root | `schema` reference; owns `schemas`, `enums`, `invariants`, `operations` |
| `DomainEvent` | false | Fact that something happened; extends Event | inherits payload schema; internal or publishable depending on architecture |
| `DomainOperation` | false | Named unit of behaviour | `description`; behaviour declared via edges |
| `IntegrationEvent` | false | Cross-service published event; extends Event | inherits payload schema; cross-boundary contract |
| `ReadModel` | false | Derived query projection | owns `fields`; declared as derived from source nodes via edges |
| `ValueObject` | false | Shared type with no independent identity | owns `fields`; used when a type is shared across multiple models |
| `Field` | false | Named property within a schema | `type`, `nullable`, `cardinality` — see Field entity below |
| `EnumDefinition` | false | Named set of values | owns `values`; referenced by Field nodes by ID |
| `EnumValue` | false | One member of an enum | `description`, `state`, `stability` |
| `Invariant` | false | Business rule that must always hold | `description`, `state` |

All template types are defined and versioned by the template pack (ADR-004). The above list is the default pack's initial set, not a closed enumeration at the model layer. Abstract templates cannot be instantiated — no node may declare an abstract template as its type.

**The universal node properties are the enrichment layer.** Properties like `state`, `stability`, `extractedFrom`, and `lastModifiedAt` are metadata that no external spec format (OpenAPI, AsyncAPI, GraphQL SDL) natively supports. They exist on every node regardless of template type. This is the core value the proprietary node model adds on top of anything representable in a spec file — lifecycle state, provenance, and history are first-class concerns in the graph, not annotations bolted onto an external format.

---

### Field entity

Fields are the most granular node type and the primary unit of field-level lineage. Every field node carries the universal node properties plus:

| Property | Type | Required | Description |
|---|---|---|---|
| `scalarType` | string | oneOf | Primitive scalar: `uuid` \| `string` \| `integer` \| `decimal` \| `boolean` \| `datetime` \| `date` \| `time`. Mutually exclusive with `objectRef`. |
| `objectRef` | string | oneOf | Local schema name, local enum name, or global node ID defining the field's type. Resolved local-first. Mutually exclusive with `scalarType`. |
| `nullable` | boolean | yes | Whether this field may be absent or null |
| `cardinality` | enum | yes | `one` \| `many` |

Field IDs extend their owner's ID via the section path: `orders.DomainModel.order.schemas.order.fields.customerId`, `orders.APIEndpoint.create-order.schemas.create-order-request.fields.customerId`.

---

### Edge entity

Edges are first-class entities. An edge is not a property of either endpoint — it has its own identity, state, and stability.

| Property | Type | Required | Description |
|---|---|---|---|
| `id` | string | derived | Computed by loader as `{from}__{type}__{to}`. Never declared in edge files. |
| `from` | node ID | yes | Source node — any node, including field nodes |
| `to` | node ID | yes | Target node — any node, including field nodes; may be in a different component or repo |
| `type` | enum | yes | See edge type vocabulary below |
| `state` | enum | no | Defaults to `proposed`. An edge may be in-flight while its endpoint nodes are `agreed`. |
| `stability` | enum | no | Defaults to `unstable`. |
| `derivation` | enum | no | `determined` \| `inferred` \| `manual`. How this edge was established. Orthogonal to `state`. Defaults to `manual` for authored edges; producers set it explicitly. |
| `derivedBy` | string | no | Identifier of the producer/method that established this edge. |
| `notes` | string | no | Annotation on this specific edge instance |

The full edge schema is defined in `.corum/packs/core/edge.schema.yaml`.

The graph model makes no distinction between edges connecting root nodes and edges connecting field nodes. Both are edges with the same structure. Field-level lineage — "the `customerId` field in `post-orders.request` maps to the `customerId` field in `order`" — is represented as a `maps-to` edge between two field nodes, not as a sub-entity on a root-to-root edge.

**Core edge type vocabulary** (extensible via template pack):

| Type | Applies between | Meaning |
|---|---|---|
| `triggers` | root nodes | Source node's occurrence causes the target to happen |
| `produces` | root nodes | Source operation produces the target event or schema |
| `reads` | root nodes | Source node reads from the target |
| `calls` | root nodes | Source operation invokes the target contract boundary |
| `implements` | root nodes | Source is a concrete realisation of the target contract |
| `maps-to` | field nodes | Source field corresponds to target field across a schema boundary; hard error if used between non-Field nodes |
| `derived-from` | any nodes | Source is computed from the target — root level (ReadModel derived-from DomainModel) or field level |
| `renamed-from` | any nodes | Source node was previously known as the target identity (PDR-005) |
| `has-field` | schema → field | Structural ownership: source schema owns target field. Implied by cluster file structure; never authored explicitly. |
| `has-value` | enum → value | Structural ownership: source enum owns target enum value. Implied by cluster file structure; never authored explicitly. |

---

### Component entity

Components are the top-level organisational unit of the graph. A component corresponds to one directory under `components/` in the graph repo and maps to a microservice, bounded context, or module.

| Property | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Slug; must match the directory name |
| `path` | string | yes | Relative path from the graph repo root |
| `description` | string | no | Human-readable description of this bounded context |

---

### Graph entity

The graph is the top-level container. It is represented by `graph.yaml` in the repo root.

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable name of this graph |
| `templatePacks` | list | yes | Active template packs loaded for this graph |
| `components` | list | yes | All components declared in this graph repo |

---

## Entity Relationship Summary

```
Graph
  └── Component (one per bounded context)
        └── Node* (many per component; template-typed)
              ├── Field* (owned; extends parent ID)
              │     └── type reference → Node (DomainModel, EnumDefinition, ValueObject)
              ├── EnumDefinition* (owned by DomainModel or ValueObject)
              │     └── EnumValue* (owned by EnumDefinition)
              ├── Invariant* (owned by DomainModel)
              └── Operation* (owned by DomainModel; behaviour via edges)

Edge (between any two Nodes — root nodes or field nodes; may cross component boundaries)
```

Field-level lineage edges (`maps-to`) between field nodes are structurally identical to edges between root nodes. There is no special field mapping entity — the model is uniform.

---

## Invariants the Model Enforces

These are constraints that any implementation of this model must maintain, regardless of storage technology:

1. **Node IDs are globally unique** across the entire graph repo
2. **Owned node IDs are prefixed** with their root node's ID
3. **Edge endpoints must resolve** — `from` and `to` reference valid node IDs, whether root nodes or field nodes (enforced by the linter at CI time; the runtime may hold unresolved cross-repo references)
4. **Nodes are never hard deleted** — removal transitions `state` to `removed`; the node remains in the graph
5. **State transitions are not strictly ordered** — any state can transition to any other state; the model records current state, not a state machine

---

## What This Model Deliberately Excludes

- **Operation behaviour** — state transitions an operation causes, preconditions, and detailed acceptance criteria are deferred. Operations are modelled as named owned nodes with a description and edges to events; richer behavioural modelling is a future ADR.
- **Versioning history** — the model represents current state. Historical state is in Git history. The hosted commercial tier may introduce explicit version tracking.
- **Cross-repo node resolution** — edges may reference nodes in other graph repos. The logical model permits this; enforcement is a runtime concern, not a model constraint.
- **Authentication and ownership** — who owns a node and who may change it is a CODEOWNERS and Git permissions concern, not a model concern.

---

## Consequences

**What this enables:**
- ADR-004 (template pack format) can define templates as additions to the universal node properties without redefining what a node is
- ADR-005 (MCP tool surface) can define tool signatures in terms of this model's entity names and properties
- ADR-003 (runtime storage) can map these logical entities directly to SQLite tables without ambiguity
- Any future storage layer (Postgres in the hosted tier, a graph database) implements the same logical model

**What remains to be decided:**
- The full template property schemas — what `properties` each template defines beyond the universal set (ADR-004)
- The complete MCP tool signatures over this model (ADR-005)
- The SQLite physical schema implementing this model (ADR-003 / implementation)
- Operation behaviour modelling depth (future ADR)

---

## Amendment: 2026-06-17 — the `derivation` confidence axis

**Added:** `derivation` (optional on nodes, optional on edges) and the optional companion `derivedBy`, on the universal node properties and the edge entity.

**Reason:** Main state is derived from heterogeneous producers (ADR-009). Some facts are established **deterministically** (structural extraction, exact symbol resolution, an authoritative spec), others are **inferred** (heuristic name matching, LLM proposal, ambiguous resolution). Consumers, the linter, and the UI need to tell these apart — a deterministically extracted `maps-to` and an LLM-guessed one are both `state: implemented` on `main` and differ only in trust. Confidence is therefore an axis **orthogonal to lifecycle `state`**, not a new `state` value.

**Semantics:**

| `derivation` | Meaning |
|---|---|
| `determined` | Established by an authoritative, reproducible method — a spec, structural extraction, or exact resolution. Trusted. |
| `inferred` | Established by a heuristic, probabilistic, or ambiguous method (name match, LLM, short-name resolution). Awaits promotion. |
| `manual` | Authored by a human. Default for hand-written nodes and edges. |

**Rules:**

- `derivation` does **not** appear in the `state` enum. The two axes are independent: a node may be `state: implemented, derivation: inferred` on `main` (no branch required), and a branch edge may be `state: proposed, derivation: inferred`.
- Producers set `derivation` explicitly. Reference mappings: structural extraction → `determined`; `$ref`/type links resolved by name → `inferred`; an exact symbol/identifier match → `determined`, an ambiguous name-only match → `inferred`; an authoritative spec adapter → `determined`.
- On reconcile, when a node is contributed by multiple producers, the merged `derivation` takes the **lower** confidence unless all contributors agree (`determined` > `inferred` for this purpose; `manual` is preserved if a human has touched it — promotion rules to be specified in the reconcile spec).
- **Linter (ADR-006):** a new **warning**-level rule fires when an `inferred` node or edge declares `stability: stable` — trust should be promoted (re-derived deterministically or human-confirmed) before a contract is marked stable. Never an error.
- **MCP/UI (ADR-005):** cluster responses surface `derivation` so consumers can filter or render `inferred` data distinctly.

**Prior text amended:** the universal node property table and the edge entity table now include `derivation` and `derivedBy`. References throughout to "every node carries `state`, `stability`, …" should be read to include `derivation`.

---

## Related

- ADR-002: Graph file format — defines how this logical model is serialised into YAML cluster and edge files
- ADR-003: Graph loading and runtime representation — defines how this model is loaded into SQLite and queried
- ADR-004: Template pack format — defines how templates extend the universal node properties
- ADR-005: MCP tool surface — defines the query and mutation interface over this model
- PDR-001: Tool scope and node taxonomy — establishes the state and stability semantics formalised here
- PDR-003: Template packs and plugin architecture — establishes that all node types are templates, including Field
- PDR-005: Deletions, renames, and collisions — establishes the soft-delete and rename-as-edge semantics reflected in this model

