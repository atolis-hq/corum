# ADR-004b: Edge Type Vocabulary and Connection Constraints

**Status:** Accepted  
**Date:** 2026-04-12  
**Amended:** 2026-04-14 — structural ownership edge types added (see amendment at end)  
**Amended:** 2026-06-25 — structural reads edges auto-generated from node-ref properties (see amendment at end)  
**Deciders:** Product Owner  
**Depends on:** ADR-004 (Template Pack Format), ADR-003b (Core Logical Data Model)  
**Related:** ADR-006 (Linter and Validator)

---

## Context and Problem Statement

ADR-003b established edges as first-class entities with a `type` field and defined the core edge type vocabulary. ADR-004 removed edge target declarations from individual templates because coupling templates to each other by name breaks on rename and prevents independent pack composition.

This ADR decides two remaining questions:

1. **Are edge connections constrained at all, and if so how?**
2. **Where does the edge type vocabulary live — in packs or in the tool?**

---

## Decision Drivers

- **The tool reasons about specific edge types.** Field-level lineage, drift detection, and the linter all depend on `maps-to` and `derived-from` having stable, known semantics. These cannot be arbitrary team-defined strings.
- **Cross-pack composability.** A vocabulary defined in one pack creates hidden dependencies. Templates in pack B referencing types declared only in pack A fail when pack A is not loaded.
- **No premature extensibility.** Designing a custom edge type extension mechanism before there is a concrete use case is premature. The core vocabulary defined in ADR-003b covers everything the default pack needs.
- **Authoring simplicity.** Templates should be easy to write. Requiring both `outgoing` and `incoming` declarations for every edge type creates an unnecessary coupling concern — authors should be able to express "this node participates in `reads` edges" without thinking about directionality unless it matters.
- **Directionality where it matters.** Some edge types have strong directional semantics worth enforcing. An `APIEndpoint` is always the source of `triggers`, never the target. A `DomainEvent` never triggers anything downstream. The declaration model should support this expressiveness without requiring it everywhere.

---

## Options Considered

### Option A: No constraints — allow all

Any node connects to any other via any string `type` value. The linter does not validate edge structure.

**Pros:** Zero configuration; maximum flexibility  
**Cons:** Edge type names become inconsistent; graph quality degrades silently; the tool cannot reason about edges reliably  
**Effort:** Lowest — but produces an ungoverned graph at scale

---

### Option B: Core vocabulary only; connections unconstrained

Edge types are fixed in the tool. Nodes may use any core type to connect to any other node. No per-template constraints.

**Pros:** Consistent naming; simple linter check; no authoring burden  
**Cons:** Structurally nonsensical connections are still valid; no basis for detecting missing expected edges; less informative than a model with structural guidance  
**Effort:** Low

---

### Option C: Core vocabulary; templates declare `outgoing` and `incoming` (previous model)

Templates declare which edge types they send and which they receive. Linter validates the intersection.

**Pros:** Full directional expressiveness; linter can detect directional anomalies  
**Cons:** Authors must think in terms of incoming vs outgoing for every edge type — creates an implicit coupling concern even when directionality doesn't matter for the type in question  
**Effort:** Medium

---

### Option D: Core vocabulary; templates declare `supports`, `outgoing`, and `incoming` (selected)

Templates may declare any combination of three sections:

- `supports` — this node participates in these edge types in either direction
- `outgoing` — this node may only *send* these edge types, never receive them
- `incoming` — this node may only *receive* these edge types, never send them

Most templates use only `supports`. `outgoing` and `incoming` are available for templates where directionality is a meaningful structural constraint worth enforcing.

**Pros:**
- Authoring simplicity — most templates just list types they participate in
- Directionality is expressible when it genuinely matters
- No coupling concern for types declared in `supports`
- Cross-pack composability unchanged — all types reference the core vocabulary only

**Cons:**
- Slightly more declaration surface than Option B
- Three sections require clear documentation of precedence rules

**Effort:** Medium — same as Option C but more natural to author

---

## Decision

**Chosen option: Option D — core vocabulary in the tool; templates declare `supports`, `outgoing`, and `incoming`**

All edge types are from the core vocabulary defined in ADR-003b. Custom edge type extensibility is deferred — see the future work note at the end of this ADR.

Constraint violations are linter **warnings** by default in v1, not errors. The two exceptions are both **hard errors**: unknown edge type names, and `maps-to` used between non-Field nodes.

---

## Core Edge Type Vocabulary

### Semantic edges

The following eight edge types express relationships between nodes and are authored explicitly in edge files. They are always available, always carry the same semantics, and are not declared in any pack. All template edge declarations must reference only these names (or the structural ownership types below).

| Type | Applies between | Meaning |
|---|---|---|
| `triggers` | root → root | Source node's occurrence initiates the target |
| `produces` | root → root | Source operation produces the target event or schema |
| `reads` | root → root | Source reads from the target at runtime |
| `calls` | root → root | Source invokes the target contract boundary |
| `implements` | root → root | Source is a concrete realisation of the target contract |
| `maps-to` | field → field only | Source field corresponds to target field across a schema boundary. **Hard error if used between non-Field nodes.** |
| `derived-from` | any → any | Source is computed from the target. Valid at root level and field level. |
| `renamed-from` | any → any | Source was previously known as the target identity (PDR-005) |

### Structural ownership edges

The following two edge types express parent-child ownership relationships derived automatically from cluster file structure. They are **never authored in edge files** — they are extracted by the graph loader from the inline structure of cluster files and materialised as first-class edges in the runtime graph.

| Type | Applies between | Meaning |
|---|---|---|
| `has-field` | Schema / DomainModel / ValueObject → Field | Parent node owns this Field node. Implied by the inline field definition in the cluster file. |
| `has-value` | EnumDefinition → EnumValue | EnumDefinition owns this EnumValue node. Implied by the inline value definition in the cluster file. |

**`has-field` and `has-value` are valid in template `edges` declarations** (as `outgoing` on the parent template and `incoming` on the child template) so that constraint checks work correctly. They are **not valid in edge files** — authoring an explicit `has-field` or `has-value` edge in an edge file is a lint error (E-008).

**`maps-to` vs `derived-from`:** These are distinct and should not be conflated. `maps-to` is a specific field-to-field correspondence — this request field maps to this domain model field. `derived-from` expresses a broader computational relationship — this read model is derived from this aggregate; this projected field is derived from this source field. A `ReadModel` is `derived-from` a `DomainModel`; it does not `maps-to` it.

---

## Template Edge Declarations

Templates declare which edge types they participate in using up to three optional sections. All type names must be from the full vocabulary above (semantic or structural ownership types).

```
edges:
  supports: [...]    # participates in either direction — the common case
  outgoing: [...]    # sends only, never receives — for strong directional constraints
  incoming: [...]    # receives only, never sends — for strong directional constraints
```

All three sections are optional. A template with no `edges` section is unconstrained — no linter warnings are issued for any edge involving that template.

**Precedence:** If a type appears in `outgoing`, it may not also appear in `supports` or `incoming`. If a type appears in `incoming`, it may not also appear in `supports` or `outgoing`. Overlap is a linter error — each type must appear in exactly one section.

---

## Default Pack Template Edge Declarations

```yaml
# Schema — owns Field nodes; participates in reads
edges:
  outgoing: [has-field, reads]
```

```yaml
# EnumDefinition — owns EnumValue nodes
edges:
  outgoing: [has-value]
```

```yaml
# EnumValue — owned by EnumDefinition
edges:
  incoming: [has-value]
```

```yaml
# Field — owned by Schema/DomainModel/ValueObject; field-level lineage
edges:
  incoming: [has-field]
  supports: [maps-to, derived-from]
```

```yaml
# APIEndpoint — directly calls or produces a command; does not trigger reactively
edges:
  outgoing: [calls, produces]
  supports: [reads]
```

```yaml
# DomainOperation — receives triggers and calls; produces events; may read and chain
edges:
  supports: [reads]
  outgoing: [produces, triggers, calls]
  incoming: [triggers, calls]
```

```yaml
# DomainModel — owns fields and enums; can be read from and derived from; may produce events
edges:
  outgoing: [has-field, has-value, produces]
  supports: [reads, derived-from]
```

```yaml
# Event (abstract base — not directly instantiable; declarations inherited by subtypes)
edges:
  outgoing: [triggers]
  incoming: [produces]
```

```yaml
# DomainEvent — inherits Event edge declarations via extends
# No additional edge declarations needed
```

```yaml
# IntegrationEvent — inherits Event edge declarations via extends
# No additional edge declarations needed
```

```yaml
# ReadModel — derived from other nodes; read from; never produces
edges:
  incoming: [reads, derived-from]
```

```yaml
# ValueObject — owns fields; used as a shared structured type
edges:
  outgoing: [has-field]
```

```yaml
# Command — produced by an endpoint; triggers an operation; never called directly
edges:
  outgoing: [triggers]
  incoming: [produces]
```

```yaml
# UserJourney — structural grouping; participates via implements and triggers
edges:
  supports: [implements]
  outgoing: [triggers]
```

---

## Validation Logic

The linter applies these checks to every edge:

1. **Vocabulary check:** Edge `type` must be one of the ten types in this ADR (eight semantic types plus `has-field` and `has-value`). Any other value is a **hard error**.

2. **`maps-to` structural check:** `maps-to` edges must connect two Field nodes. Any other combination is a **hard error**.

3. **`has-field` / `has-value` in edge files:** `has-field` and `has-value` must not appear in authored edge files — they are implied by cluster structure. If found in an edge file, it is a **hard error** (E-008).

4. **Source constraint check:** If the source node's template declares `outgoing` or `supports`, the edge type must appear in one of them. Violation is a **warning** (configurable to error per repo via linter config).

5. **Target constraint check:** If the target node's template declares `incoming` or `supports`, the edge type must appear in one of them. Violation is a **warning** (configurable to error per repo).

6. **`renamed-from` directionality:** `renamed-from` edges should always point from the new identity to the old. The linter warns if the edge appears reversed based on node state (a `removed` node as the target is expected; a `removed` node as the source is suspicious).

If a template has no `edges` declaration at all, no constraint checks are applied for that endpoint — the missing declaration is treated as unconstrained, not as `supports: []`.

---

## Pack Structure

Because the edge type vocabulary is defined in the tool, packs do not contain an `edge-types.yaml` in v1. The filename is reserved in the pack directory structure (ADR-004) for the future custom edge type extension mechanism. Its absence is not an error.

---

## Future Work: Custom Edge Type Extension

Teams with domain-specific relationships not covered by the ten core types have no extension mechanism in v1. When a concrete need arises, the options to evaluate are:

- Pack-defined edge types with cross-pack conflict detection
- A registered extension namespace (e.g. `x-saga-step`) similar to OpenAPI vendor extensions  
- Community proposals to add types to the core vocabulary

The `supports`/`outgoing`/`incoming` declaration model in templates extends naturally to include custom type names alongside core ones when this mechanism is designed.

---

## Linter Responsibilities (full specification in ADR-006)

From this ADR, the linter must enforce:

- All edge `type` values are from the full vocabulary (ten types) (**error**)
- `maps-to` edges connect two Field nodes (**error**)
- `has-field` and `has-value` do not appear in authored edge files (**error**, rule E-008)
- Overlap between `supports`, `outgoing`, and `incoming` within a single template declaration is rejected (**error**)
- Edge type names in `supports`, `outgoing`, and `incoming` are from the full vocabulary (**error**)
- Where source or target has declared constraints (via `supports` or directional sections), the edge type is permitted (**warning** by default; configurable to error)

---

## Consequences

**What becomes easier:**
- Most templates simply list which edge types they participate in via `supports` — no directional reasoning required for the common case
- Templates with strong directional semantics (APIEndpoint, DomainEvent) can express that precisely via `outgoing`/`incoming`
- All ten core types have stable, tool-understood semantics — agents and drift detection can rely on them
- Cross-pack composition requires no coordination — all templates reference the same core vocabulary
- Ownership edges (`has-field`, `has-value`) are automatically extracted and never require explicit authoring, eliminating a class of potential authoring errors

**What becomes harder:**
- Teams needing relationship types not in the core vocabulary have no v1 mechanism
- Template authors must avoid overlap between `supports`, `outgoing`, and `incoming` sections

**What is newly possible:**
- The linter can detect suspicious directional violations — a `triggers` edge pointing at an `APIEndpoint` will warn because `APIEndpoint` declares `outgoing: [triggers]`
- `derived-from` and `maps-to` chains can be traversed reliably by drift detection because their semantics are guaranteed by the tool
- `has-field` and `has-value` ownership chains are graph-traversable at runtime — the MCP server can answer "all fields owned by this Schema" or "all values in this EnumDefinition" via graph traversal

---

## Amendment: 2026-04-14

**Added:** `has-field` and `has-value` structural ownership edge types.

**Reason:** The `Schema` and `EnumDefinition` templates declared `outgoing: [has-field]` and `outgoing: [has-value]` respectively in their template edge sections, but these type names were not in the ADR-defined vocabulary. This caused a pre-existing violation of E-004 (template edge declaration vocabulary). The amendment formalises both types as structural ownership edges, documents that they are extracted from cluster file structure rather than authored in edge files, and adds E-008 to prohibit their use in edge files.

**Prior description of "eight core types"** throughout this document and in ADR-003b is amended to "ten core types" (eight semantic plus two structural ownership types).

---

## Amendment: 2026-06-25

**Added:** Auto-generation of structural `reads` edges from `node-ref` properties.

**Reason:** Import adapters (OpenAPI, AsyncAPI) were hand-crafting `reads` edges when resolving `$ref` values to external clusters. This was fragile — any new adapter or node type with external references had to remember to emit these edges, and the adapter had to carry source-tracking bookkeeping to know the correct edge source. The cluster-loader already processes all node properties; it is the right place to derive these edges once, uniformly.

**How it works:** During cluster materialisation, after each owned child node is created, the cluster-loader inspects the child's template properties for any property with `format: node-ref`. If the node's actual value for such a property is a global node ID (not a local `#/…` reference), the loader emits a `reads` edge from the **cluster root** to that global target. The edge is marked `generated: true` and is deduplicated so multiple fields referencing the same target produce exactly one edge.

**Generated vs authored reads:** The `generated: true` flag is an internal runtime marker. Generated reads edges participate fully in graph queries — `list_nodes`, `get_cluster`, and `get_linked_fields` all see them. They are, however, **excluded from edge file serialisation**: `serializeGraph` filters edges where `generated === true` before writing `edges/*.yaml`. This means the edge is re-derived on every load and never appears as an explicit edge file entry.

**`emitReadsEdge` removed from adapters:** The OpenAPI and AsyncAPI mapper functions no longer emit `reads` edges. The `emitReadsEdge` helper has been deleted from both. Adapter output is now limited to the node structure and structural ownership edges; cross-cluster reads relationships are left to the loader's auto-generation.

**Edge direction:** Auto-generated reads edges always point from the cluster root to the external target, preserving the root-to-root constraint on `reads` edges stated in the Core Edge Type Vocabulary section above.

---

## Amendment: 2026-07-03

**Added:** Pack-declarable edge types with semantic categories; edge properties.

**Reason:** The roadmap (BDD, user journeys, delivery view, collaboration) requires edge types beyond the core vocabulary, and attributed edges (ordering, bindings). The "no premature extensibility" driver above is superseded by these concrete use cases (see the 2026-07-02 principal engineer review, P2.1).

**How it works:** Core types remain declared in the tool (`CORE_EDGE_TYPES`, `src/loader/constants.ts`), each with a semantic **category** — `structural`, `semantic`, or `lineage` — plus a `hidden` flag for bookkeeping types (`renamed-from`). Packs declare additional types in an `edge-types.yaml` at the pack root, each with a required category and an optional JSON-schema `properties` block. Engine behaviour (summary counts, lineage defaults, collapse filtering, writer serialisation) keys off category, never off hardcoded name lists. Core definitions cannot be overridden; cross-pack collisions keep the first definition with a warning. Explicit edges may carry a `properties:` map, validated by the linter against the declared schema.

**Template edge declarations:** the template-level key is `edge-types:` (with `outgoing`/`incoming`/`supports`), resolved through the template `extends` chain and enforced by the linter (rules E-005/E-006).

---

## Amendment: 2026-07-03 (b)

**Added:** `uses-type` core semantic edge type. Auto-generated `reads` edges become `uses-type`.

**Reason:** `reads` was overloaded with two meanings: an authored behavioural statement ("this endpoint reads data from that read model / domain model") and an auto-generated type reference ("this node's contract uses that shared type definition", derived from `node-ref` properties per the 2026-06-25 amendment). The two relationships answer different questions — runtime data flow vs contract/type dependency — and conflating them skews lineage and impact analysis. A generic name like `references` was rejected because it invites the same overloading from future features (BDD, journeys, annotations); `uses-type` carries its object in the name.

**Semantics:** `{consumer root} --uses-type--> {shared type root}`. Category `semantic`. Auto-generated by the cluster-loader from `node-ref` properties resolving to global node IDs, marked `generated: true`, excluded from edge file serialisation, and re-derived on every load — exactly the mechanism the 2026-06-25 amendment established, with only the type name changed. Like `reads`, it is followed outbound-only in lineage and cluster expansion so that viewing a shared type does not pull in every consumer.

**`reads` reverts to purely behavioural:** authored root-to-root data-consumption edges only. No `reads` edges are auto-generated after this amendment. Existing authored `reads` edges in graph files are unaffected (generated edges were never serialised, so no data migration is required).

---

## Related

- ADR-003b: Core logical data model — defines the semantic edge types used throughout this ADR; amended by this ADR to include structural ownership types
- ADR-003d: Inline schema definition and reference resolution — has-field and has-value are the ownership edges implied by inline schema and enum definitions
- ADR-004: Template pack format — pack structure; templates include `edges:` declarations referencing core types from this ADR
- ADR-006: Linter and validator — implements the validation logic described here
- PDR-005: Deletions, renames, and collisions — `renamed-from` edge type semantics
