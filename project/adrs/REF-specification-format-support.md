# Reference: Specification Format Support and the Node Model

**Status:** Reference  
**Date:** 2026-04-12  
**Relates to:** ADR-003b (Core Logical Data Model), ADR-004 (Template Pack Format), ADR-005 (MCP Interface Design)  
**Action required:** Informs the extraction pipeline ADR and any adapter implementation work

---

## The Core Model

The tool maintains a **proprietary node model** as its canonical representation of everything. That model has bidirectional relationships with external spec formats — it can import from them and export to them — but is not subordinate to any of them.

```
External spec files                    Proprietary node model
─────────────────────                  ──────────────────────
OpenAPI spec files          ←→         APIEndpoint nodes
AsyncAPI spec files         ←→         IntegrationEvent / DomainEvent nodes
GraphQL SDL files           ←→         (future) GraphQLQuery, GraphQLType nodes
[other spec formats]        ←→         [extensible via template packs]

                                       + enrichment layer on every node:
                                         state, stability, extractedFrom,
                                         lastModifiedAt, branch provenance

                                       + edge / mapping layer:
                                         relationships and field lineage
                                         across all node types
```

No external spec is extended or modified. Spec files remain clean and consumable by their native tooling. The graph builds on top of them.

---

## The Three Tiers

### Tier 1 — External contract specs (OpenAPI, AsyncAPI, and future formats)

These describe the boundaries of the system — what external consumers can call or subscribe to. They are already standardised, widely adopted, and consumed by many tools outside the graph.

The graph imports these files via adapters. The adapters produce `APIEndpoint` and `IntegrationEvent` nodes (or equivalent template types) whose property schemas are structurally aligned with the source spec format. The import is designed to be close to lossless for the spec-relevant fields — the graph node contains everything the spec contains, plus the enrichment layer.

Export reverses this: an agreed `APIEndpoint` node can be exported to a valid OpenAPI path item; an `IntegrationEvent` node to a valid AsyncAPI message. The enrichment metadata (state, stability, provenance) is not part of the export — it lives only in the graph.

### Tier 2 — Internal domain spec (the node model itself)

No external spec covers domain models, domain operations, commands, invariants, and read models with sufficient expressiveness for design-time tooling. This is the deliberate gap the tool fills.

The YAML cluster files for these node types *are* the spec format for internal domain concepts. They are structured, machine-readable, and validated by JSON Schema. There is no separate "domain spec file format" — the graph's own cluster files serve this purpose. Teams author domain nodes directly in the graph rather than importing from an external format.

This is not a limitation. The domain layer is where the graph's value is highest — lifecycle state, provenance, invariants, and the edge layer are all most useful here. A separate domain spec format would duplicate what cluster files already provide without adding anything.

### Tier 3 — The edge and mapping layer

The edge layer is what makes the tool valuable beyond documentation. It captures relationships that no individual spec can express:

- How an API request field maps to a domain model field (`maps-to`)
- How a read model is computed from an aggregate (`derived-from`)
- How an operation produces an event (`produces`)
- How an event triggers a downstream operation (`triggers`)
- How a node was previously named (`renamed-from`)

These relationships exist *between* spec formats. OpenAPI cannot reference AsyncAPI. AsyncAPI cannot reference a domain model. The edge layer is the connective tissue that makes the full system legible as a whole.

---

## Bidirectional Sync

### Import (spec → graph)

An adapter reads a spec file and produces candidate nodes. The adapter understands the source format's structure and maps it to the appropriate template type. For example:

- An OpenAPI path item with `POST /orders` → candidate `APIEndpoint` node
- An OpenAPI schema object `Order` → candidate `DomainModel` node (requires confirmation — schemas may be request/response shapes, not domain models)
- An AsyncAPI message `OrderPlaced` → candidate `IntegrationEvent` node
- A GraphQL SDL type `Order` → candidate `GraphQLType` or `DomainModel` node

Candidates are created with `state: proposed`. Human or agent review upgrades them to `agreed`. This is the AI-extracted, human-reviewed workflow from PDR-001.

The `extractedFrom` field on every node records the source spec file path. This is the provenance trail — which spec file originated this node.

### Export (graph → spec)

An agreed node can be exported to its native spec format. The export adapter reads the node's template-specific properties and constructs a valid spec object.

Export is opt-in and explicit — the graph does not automatically update spec files on node changes. Teams trigger export when they want to propagate agreed design decisions into implementation-facing spec files.

**What export includes:** template-specific properties (method, path, auth for an endpoint; payload schema and fields for an event)

**What export excludes:** graph enrichment metadata (state, stability, branch provenance, threads, edge relationships). These live only in the graph.

### The source-of-truth question

When a spec file and a graph node disagree, which wins?

- **Design layer ahead of spec:** A proposed node exists in the graph with no corresponding spec file entry. The node is ahead — the design has not been implemented yet. Drift detection surfaces this as a missing-in-derived finding.
- **Spec ahead of design layer:** A spec file contains an operation with no corresponding graph node. The spec is ahead — implementation happened without going through the graph. Drift detection surfaces this as a missing-in-design finding.
- **Both exist but diverge:** The spec file and the graph node both describe the same operation with different field shapes. Drift detection surfaces the specific property differences.

The graph is the canonical representation of *design intent*. Spec files are the canonical representation of *implementation state*. Drift between them is the primary signal the tool surfaces.

---

## Spec Format Support

Packs are aligned to spec formats — each spec-aligned pack ships with its corresponding adapter. Teams install the packs matching the specs their services use.

### Pack taxonomy

```
Spec-aligned packs          Adapter format      Status
──────────────────          ─────────────       ──────
core                        (none)              v1 — always loaded
rest                        OpenAPI 3.x         v1
messaging                   AsyncAPI 3.x        v1
graphql                     GraphQL SDL         planned

Domain pack
────────────
domain                      (none — cluster     v1
                             files are the spec)

Methodology packs
──────────────────
design                      (none)              v1
event-storming              (none)              v1
event-modelling             (none)              v1
```

### `core` pack — always loaded

Contains `Field` (the only `core: true` template) and the abstract `Event` base that all event subtypes extend.

### `rest` pack (adapter: OpenAPI 3.x)

- Import: OpenAPI path items → `APIEndpoint` nodes; schema objects → `DomainModel` candidates (ambiguous — flagged for review)
- Export: `APIEndpoint` nodes → OpenAPI path items

### `messaging` pack (adapter: AsyncAPI 3.x)

- Import: AsyncAPI messages → `IntegrationEvent` or `DomainEvent` nodes; channels → edge metadata
- Export: `IntegrationEvent` nodes → AsyncAPI messages
- Note: whether a `DomainEvent` is exported to AsyncAPI is an architectural decision per team — both use the same `Event` base schema

### `domain` pack (no adapter — cluster files are the spec)

No external spec covers domain models, operations, commands, invariants, and read models. The YAML cluster files for these node types *are* the spec format. Teams author domain nodes directly in the graph.

### `design` pack

`UserJourney` — design tooling concept with no spec format equivalent.

### `event-storming` pack

Captures the output of event storming sessions as first-class graph nodes: `HotSpot`, `Aggregate`, `ExternalSystem`, `Policy`, `Actor`. These are design-time artefacts refined into `domain` and `messaging` nodes as the design matures, with edges preserving the trail.

### `event-modelling` pack

Supports teams following the Adam Dymitruk event modelling methodology: `Slice`, `Processor`, `AutomationPolicy`. Composes with `domain` and `messaging` templates — a `Slice` references `Command`, `DomainEvent`, and `ReadModel` nodes via edges.

### `graphql` pack (planned, adapter: GraphQL SDL)

- Import: SDL types → `GraphQLType` or `DomainModel` candidates; queries/mutations → `GraphQLQuery`/`GraphQLMutation` nodes; subscriptions → `GraphQLSubscription` nodes (extends `Event`)
- Export: agreed nodes → GraphQL SDL fragments (planned)
- Note: `GraphQLSubscription extends Event` from the `core` pack — GraphQL subscriptions participate in the same event edge vocabulary as `DomainEvent` and `IntegrationEvent`

### Future format candidates

- Protobuf/gRPC — service definitions → API nodes; message types → `DomainModel` candidates
- JSON Schema registries (Confluent, AWS Glue) — schema versions → `DomainModel` or `IntegrationEvent` nodes
- TypeSpec — higher-fidelity alternative to OpenAPI/AsyncAPI adapters (see REF-typespec-integration-opportunities)
- SQL DDL — tables → `ReadModel` nodes

---

## What the Node Model Adds That Specs Cannot

This is the core value proposition of the proprietary node model:

| Capability | OpenAPI | AsyncAPI | Node model |
|---|---|---|---|
| Lifecycle state (draft/proposed/agreed) | ✗ | ✗ | ✓ |
| Stability declaration | ✗ | ✗ | ✓ |
| Soft deletion with history | ✗ | ✗ | ✓ |
| Rename trail | ✗ | ✗ | ✓ |
| Branch-aware in-flight design state | ✗ | ✗ | ✓ |
| Field-level lineage across spec boundaries | ✗ | ✗ | ✓ |
| Cross-spec relationships | ✗ | ✗ | ✓ |
| Design intent for unimplemented concepts | ✗ | ✗ | ✓ |
| Drift detection between design and implementation | ✗ | ✗ | ✓ |

Spec files are authoritative for what is implemented. The node model is authoritative for what is designed, in-flight, and intended. The gap between them is the primary signal.

---

## The Adapter Pattern

Each spec format is handled by an adapter. Adapters are the only place spec-specific knowledge lives — the node model and edge layer are format-agnostic.

An adapter:
1. Reads a spec file from a known location (service repo, schema registry, URL)
2. Maps spec objects to candidate nodes using the appropriate template types
3. Creates `maps-to` and `derived-from` edges where the spec implies relationships (e.g. a GraphQL field referencing another type)
4. Sets `extractedFrom` to the source file path on every created node
5. Proposes the candidates to the graph with `state: proposed`

Adapters do not write directly to the graph — they produce proposals that go through the standard extraction workflow (AI-extracted, human-reviewed).

The adapter interface is a future ADR. The key constraint from this document: adapters must produce nodes conforming to the template pack's JSON Schema, and may not add properties outside the template definition.

---

## Related

- ADR-003b: Core logical data model — universal node properties as the enrichment layer
- ADR-004: Template pack format — template types for each spec format concept; abstract Event base
- ADR-005: MCP interface design — how the assembled node model is surfaced to agents
- REF-typespec-integration-opportunities — TypeSpec as a high-fidelity extraction source
