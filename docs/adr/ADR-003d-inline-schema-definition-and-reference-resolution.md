# ADR-003d: APIEndpoint Inline Schema Definition and Reference Resolution

**Status:** Accepted  
**Date:** 2026-04-14  
**Deciders:** Product Owner  
**Depends on:** ADR-003c (Schema Nodes and Field-Owned Object Contracts), ADR-002 (Graph File Format and Cluster Boundaries), ADR-003b (Core Logical Data Model)  
**Related:** ADR-004 (Template Pack Format), ADR-006 (Linter and Validator), REF-006-rules.md

---

## Context and Problem Statement

ADR-003c established that `Schema` nodes own `Field` nodes and that schemas owned by a single root node should be serialised inside that root's cluster file rather than in separate files. It demonstrated this with `request` and `responses` blocks as direct named sections of an `APIEndpoint` cluster, each carrying an explicit `id`, `template: Schema`, and a flat list of fields.

This pattern is correct for flat contracts, but breaks down for any real-world API response that contains nested object shapes. A response like:

```json
{
  "data": {
    "id": 123,
    "address": { "street": "123 Fake Street", "city": "London" }
  }
}
```

requires three `Schema` nodes — one for the top-level response, one for `data`, one for `address`. ADR-003c's `request`/`responses` section format has no mechanism for naming and referencing multiple schemas from within the same file. Without that mechanism, nested object types must always be standalone files, which breaks the cluster-file locality principle for endpoint-specific shapes.

A second problem arises from format ambiguity. In the cluster file, `request` and `responses` values may reference either a locally-defined schema or a globally-addressed standalone Schema node — but both are plain strings with no syntactic distinction. The resolution behaviour must be explicitly defined.

This ADR decides:

1. How multiple locally-scoped Schema nodes are defined within a single APIEndpoint cluster file
2. The deterministic rule for resolving string references to local versus global schemas
3. The depth constraint on inline field definitions and why it is the right boundary
4. The node addressing convention for local schemas and their owned fields

---

## Decision Drivers

- **ADR-003c Rule 4:** owned schemas stay in the owning root's cluster file — this is the locality principle the `schemas` block enforces
- **ADR-003b:** every field must be independently addressable as a graph node for lineage and `maps-to` edges — anonymous inline objects with no identity violate this
- **ADR-002:** cluster file granularity is per root node — one endpoint, one file; the mechanism for defining nested schemas must not require additional files for endpoint-private shapes
- **Referential integrity:** the resolution rule must be mechanically verifiable by the linter without requiring graph-wide context for the local case
- **OOTB JSON Schema validation:** the template's `properties` block is extracted as a standalone JSON Schema document; `$ref` pointers within it must resolve within that extracted document — references that traverse into the surrounding template file structure are not valid when the block is extracted

---

## The Nesting Problem

The field definition model in ADR-003b uses a single `fieldType` property that accepts either a scalar type string or a node ID. This conflates two structurally different things:

- A **scalar type** (`uuid`, `string`, `integer`, etc.) — a closed enumeration the tool understands intrinsically
- A **node reference** (`orders.shared-types.money`, `order-address`) — an open-ended pointer to another graph node

When both are a plain string, the linter cannot distinguish them without resolving the value — a node ID lookup is required to know whether `string` is the scalar type or a node named `string`. This ambiguity is a lint and authoring concern.

The field model is amended here to make this distinction explicit:

- `scalarType` — a validated enum of primitive types (`uuid`, `string`, `integer`, `decimal`, `boolean`, `datetime`, `date`, `time`)
- `objectRef` — a string that is always a node reference, subject to local-first resolution

These properties are mutually exclusive on a single field definition. A field carries exactly one. This is enforced by a `oneOf` constraint in the JSON Schema at the template level.

This amendment supersedes the `fieldType` property as defined in ADR-003b and ADR-004 for field definitions within APIEndpoint cluster files. The `Field` core template is updated accordingly. The change is additive at the graph model level — `scalarType` and `objectRef` are the physical form of what `fieldType` represented logically.

---

## Options Considered for Schema Definition

### Option A: Require fully-qualified node IDs for all local schemas

Local schemas defined in the cluster file are given fully-qualified IDs immediately. No local name exists — authors write `id: orders.api-endpoints.get-order.schemas.order-data` directly.

**Pros:** No resolution ambiguity; every reference is globally unambiguous at authoring time  
**Cons:** The fully-qualified ID embeds the parent node's ID, so renaming the endpoint invalidates all local schema references within the same file; authoring is verbose for what are private implementation details of the endpoint contract; the local reference carries no signal that it is local — it looks identical to a cross-file reference  
**Effort:** Low to implement; high authoring friction  
**Verdict:** Technically correct but hostile to the authoring model

---

### Option B: Inline schemas as unnamed embedded objects

Schemas are defined as anonymous nested YAML objects directly within `request` or `responses`, with no name or ID.

**Pros:** Zero ceremony; familiar to authors used to JSON or OpenAPI inline schemas  
**Cons:** Anonymous objects have no graph identity — their fields cannot be independently addressed as nodes, cannot participate in `maps-to` edges, and cannot be targeted by lineage queries; this directly violates ADR-003b's field-as-atomic-unit principle; nesting depth is unlimited with no structural anchor, creating pressure to reinvent JSON Schema inside the cluster file  
**Effort:** Low to implement; architecturally incompatible  
**Verdict:** Disqualified — violates the field-level lineage model

---

### Option C: Prefixed references (`local:name` vs undecorated global IDs)

Local schema names use a `local:` prefix. Global node IDs have no prefix. Resolution is unambiguous by inspection.

**Pros:** No resolution order logic required; unambiguous at any point in the file  
**Cons:** Non-standard syntax requiring parser support; `local:` is verbose for what is the common case; teams working with shared schemas must remember which syntax applies to each reference; visual noise  
**Effort:** Low to implement; moderate authoring friction  
**Verdict:** Solves the right problem but with unnecessary syntax cost

---

### Option D: Named `schemas` block with local-first resolution (selected)

A `schemas` block at the top level of the cluster file defines named local Schema nodes. References in `request`, `responses`, and `objectRef` are plain strings resolved local-first: the system looks up the string in the `schemas` block before treating it as a global node ID.

**Pros:**
- Named schemas are referenceable across the same file via `objectRef`, enabling arbitrary nesting depth through local cross-references
- Authoring is natural — short local names for endpoint-private schemas, full node IDs only for genuinely shared schemas
- The common case (all schemas local to this endpoint) requires no special syntax
- Consistent with ADR-003c Rule 4 — owned schemas remain in the owning cluster file
- Local schemas become first-class graph nodes with system-assigned IDs at load time; their fields are independently addressable

**Cons:**
- A local schema name that matches a global node ID silently shadows the global — requires a documented rule and a lint warning
- The loader, linter, and any tooling processing references must implement local-first resolution

**Effort:** Low-medium — resolution rule plus system-assigned ID convention  
**Verdict:** The correct balance of authoring simplicity and graph integrity

---

## Decision

**Chosen option: Option D — named `schemas` block with local-first resolution**

**Field type split: `scalarType` and `objectRef` replace `fieldType`** in all field definitions within APIEndpoint cluster files and in the `Field` core template. The `oneOf` mutual exclusivity constraint is enforced by the template's JSON Schema.

---

## The `schemas` Block

A `schemas` block may appear at the top level of any APIEndpoint cluster file, alongside `properties`, `edges`, and `ui`. It is a named map of locally-scoped Schema definitions.

```yaml
id: orders.api-endpoints.get-order
template: APIEndpoint
state: proposed
stability: unstable
name: GET /orders/{orderId}

properties:
  method: GET
  path: /orders/{orderId}

responses:
  "200": order-response   # local name — resolves to schemas block below
  "404": problem-detail   # global node ID — resolves to shared Schema node

schemas:
  order-response:
    description: "Top-level response envelope"
    fields:
      data:
        objectRef: order-data   # local cross-reference
        nullable: false
        cardinality: one

  order-data:
    description: "Core order fields"
    fields:
      id:
        scalarType: integer
        nullable: false
        cardinality: one
      address:
        objectRef: order-address   # local cross-reference
        nullable: false
        cardinality: one

  order-address:
    fields:
      street:
        scalarType: string
        nullable: false
        cardinality: one
      city:
        scalarType: string
        nullable: false
        cardinality: one
```

This models the response structure:

```json
{ "data": { "id": 123, "address": { "street": "...", "city": "..." } } }
```

The `schemas` block is a structural section of the cluster file format, not part of the `properties` block. It is not validated by the template's JSON Schema — it is processed by the graph loader as a structural extension of the APIEndpoint cluster format.

---

## Reference Resolution Order

When a plain string appears as the value of `request`, an entry in `responses`, or as an `objectRef` value within a field definition in the `schemas` block, resolution proceeds in this order:

**Step 1 — Local lookup:** Is the string a key in this file's `schemas` block?  
If yes: resolved to `{parent-node-id}.schemas.{local-name}`. No `reads` edge generated — the relationship is ownership, not a cross-node read. Stop.

**Step 2 — Global lookup:** Treat the string as a globally-qualified node ID and resolve it against the full graph.  
If found: generates an explicit `reads` edge from the APIEndpoint to the target Schema node. Stop.

**Step 3 — Unresolved:** Neither lookup succeeds. Lint error `S-002` fires (see Linter Rules below).

**Scope of resolution:** applies to `properties.request`, all values in `properties.responses`, and `objectRef` values within `schemas` block field definitions.

**Does not apply to:** field definitions in standalone Schema cluster files, which always use globally-qualified node IDs.

---

## Shadowing

A local schema name that matches a global node ID in the graph is a **lint warning** (`S-001`). Local always wins. The warning is a signal to the author to verify the shadowing is intentional and not an accidental collision.

Teams should treat shadowing warnings as prompts to rename the local schema or to confirm they intended the local definition to take precedence over the global one.

---

## Field Definition Depth Constraint

Field definitions within the `schemas` block are **flat** — one level deep per schema entry. A field carries either a `scalarType` (primitive) or an `objectRef` (reference to another schema). It does not carry an embedded inline object.

This is enforced by the template's JSON Schema, which accepts only `scalarType` or `objectRef` as the type discriminator — not embedded schema objects. Validators running against the template schema will reject field definitions that attempt to nest objects inline.

The architectural reason this constraint is correct: if a field could embed an anonymous object inline, that object would have no name and no graph identity. Its sub-fields would not be independently addressable nodes and could not participate in `maps-to` edges or lineage queries. Every object shape in the graph must be a named Schema node with a stable ID. The flat field constraint is the enforcement mechanism for that invariant.

Nesting depth is unlimited — it is achieved through `objectRef` cross-references between named schemas, not through field embedding.

---

## Node IDs for Local Schemas and Their Fields

Local schemas are private names during authoring but become first-class graph nodes at load time. The graph loader assigns IDs following the ADR-002 owned-node convention:

**Schema ID:** `{parent-node-id}.schemas.{local-name}`

**Field ID:** `{parent-node-id}.schemas.{local-name}.fields.{field-name}`

For the example above with parent `orders.api-endpoints.get-order`:

| Local name | Assigned node ID |
|---|---|
| `order-response` | `orders.api-endpoints.get-order.schemas.order-response` |
| `order-data` | `orders.api-endpoints.get-order.schemas.order-data` |
| `order-address` | `orders.api-endpoints.get-order.schemas.order-address` |
| `order-data.fields.id` | `orders.api-endpoints.get-order.schemas.order-data.fields.id` |
| `order-data.fields.address` | `orders.api-endpoints.get-order.schemas.order-data.fields.address` |

These assigned IDs are the stable addresses used in `maps-to` and `derived-from` edges declared in edge files, and in MCP tool responses. Local names are an authoring convenience only — they do not appear in the graph at runtime.

---

## Edge Implications

| Scenario | Generated edge behaviour |
|---|---|
| `request` or `responses` value resolves to a local schema | No `reads` edge — the schema is an owned node; `has-field` edges between the Schema and its Field nodes are implied by the inline structure and extracted automatically |
| `request` or `responses` value resolves to a global node ID | Explicit `reads` edge from the APIEndpoint to the target Schema node |
| `objectRef` resolves to a local schema | No explicit edge — local cross-reference within the same ownership cluster |
| `objectRef` resolves to a global node ID | Explicit `reads` edge from the referencing Schema node to the target |
| `maps-to` between fields | Always explicit in edge files; never implied; applies regardless of whether the source or target field is in a local or standalone schema |

---

## Promoting a Local Schema to a Shared Schema

A schema that begins as a local entry in one endpoint's `schemas` block and is later identified as shared across multiple endpoints should be promoted to a standalone cluster file.

Promotion steps:
1. Create a standalone Schema cluster file in the appropriate `shared-types/` directory with a global node ID
2. Replace the local name reference in the source endpoint's `request`, `responses`, or `objectRef` fields with the new global node ID
3. Remove the entry from the source file's `schemas` block
4. The linter will flag the new `reads` edge as required in an edge file
5. Any `maps-to` edges referencing the old assigned ID (`{endpoint-id}.schemas.{local-name}.fields.*`) must be updated to reference the new standalone field IDs

The CLI should provide an atomic `graph promote-schema` command that performs steps 1–5 as a single operation.

---

## Linter Rules

New rules deriving from this ADR, to be added to REF-006-rules.md:

**S-001 — Local schema name shadows global node ID** `warning`  
A key in a node file's `schemas` block that matches a global node ID in the graph is flagged. The local schema takes precedence. Authors should verify the shadowing is intentional. *Derives from: the local-first resolution rule in this ADR.*

**S-002 — Unresolved schema reference** `error`  
A value in `request`, `responses`, or `objectRef` that resolves to neither a local schema name nor a valid global node ID is an error. This extends R-002 (edge endpoint resolution) to cover local lookup first. *Derives from: this ADR's resolution steps.*

**S-003 — Local schema defined but not referenced** `warning`  
A schema defined in the `schemas` block that is not referenced by `request`, `responses`, or any `objectRef` within the same file is unreachable and flagged as a dead schema. *Derives from: the ownership model — unreferenced owned nodes are authoring errors.*

**S-004 — `objectRef` cycle in local schemas** `error`  
A cycle in `objectRef` references among local schemas within the same file is rejected. `A` referencing `B` referencing `A` is not a valid graph structure. *Derives from: ADR-003b invariant that the graph is acyclic in ownership relationships.*

**S-005 — `scalarType` and `objectRef` both present on a field** `error`  
A field definition carrying both `scalarType` and `objectRef` is rejected. These properties are mutually exclusive. *Derives from: the field type split decision in this ADR.*

**S-006 — Field carries neither `scalarType` nor `objectRef`** `error`  
A field definition carrying neither `scalarType` nor `objectRef` is incomplete and rejected. *Derives from: the field type split decision in this ADR.*

---

## Consequences

**What becomes easier:**
- Arbitrarily nested response and request structures are representable within a single cluster file without requiring standalone Schema files for endpoint-private shapes
- PR diffs for endpoint changes are self-contained — the endpoint, all its schemas, and all their fields are in one file
- Field-level lineage operates over stable system-assigned IDs regardless of local name choices; renaming a local schema is a file-local change with no graph-wide impact
- The `scalarType`/`objectRef` split makes field definitions self-describing — an author can see from the field alone whether the type is a primitive or a reference

**What becomes harder:**
- Authors must understand the local/global resolution distinction when writing `objectRef` values — the linter warning on shadowing (`S-001`) is the main safety net
- Promoting a local schema to a shared one requires a multi-step rename that touches IDs in edge files — the CLI must support this atomically
- The linter must implement local-first resolution as a first pass before falling through to global graph lookup

**What is intentionally prevented:**
- Anonymous inline objects with no name or graph identity — every object shape must be a named Schema node
- Recursive field definitions without an addressable schema boundary at each level
- Silent shadowing of global node IDs by local schema names without a lint signal

---

## Amendments to Prior ADRs

**ADR-003b — Core Logical Data Model, Field entity:**  
The `type` property on Field nodes is replaced by two mutually exclusive properties: `scalarType` (closed enum of primitives) and `objectRef` (node reference string subject to local-first resolution). The logical model is unchanged — this is a physical representation change that eliminates the ambiguity of a single stringly-typed property that encoded two different kinds of values.

**ADR-003c — Schema Nodes and Field-Owned Object Contracts, Rule 5:**  
The cluster file example in Rule 5 used `fieldType` as the field property name. This is superseded by `scalarType` / `objectRef` per the amendment above. The `request` and `responses` sections in ADR-003c examples should be understood as resolved via the local-first rule defined in this ADR.

**ADR-004 — Template Pack Format, `Field` template section:**  
The `Field` template example uses `fieldType`. This is superseded by `scalarType` and `objectRef` as separate properties with a `oneOf` mutual exclusivity constraint. The `fieldType` property name should be considered deprecated.

---

## Related

- ADR-002: Graph file format and cluster boundaries — owned-node ID namespacing followed by local schemas; cluster-file locality principle
- ADR-003b: Core logical data model — Field as atomic unit; Schema as object boundary; field type amendment
- ADR-003c: Schema nodes and field-owned object contracts — establishes Schema as the graph's canonical object shape; this ADR extends its inline serialisation model to support multiple named schemas per cluster file
- ADR-004: Template pack format — APIEndpoint and Field template definitions updated by the `scalarType`/`objectRef` split
- ADR-004b: Edge type vocabulary — `reads` edge type generated by global schema references; `has-field` implied by local schema structure
- ADR-006: Linter and validator — severity model governing S-001 through S-006
- REF-006-rules.md — rule catalogue; S-001 through S-006 to be added
