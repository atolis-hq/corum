# ADR-003c: Schema Nodes and Field-Owned Object Contracts

**Status:** Accepted  
**Date:** 2026-04-14  
**Deciders:** Product Owner  
**Depends on:** ADR-002 (Graph File Format and Cluster Boundaries), ADR-003b (Core Logical Data Model), ADR-004 (Template Pack Format)  
**Related:** ADR-003 (Graph Loading and Runtime Representation), ADR-006 (Linter and Validator)  

---

## Context and Problem Statement

ADR-003b established `Field` as the atomic unit of field-level lineage. ADR-004 established that templates define node types, but it did not answer a narrower modelling question that becomes important as soon as API request and response contracts are introduced: how should structured payload shapes be represented?

One option is to embed arbitrary object structures inline wherever they are needed, for example inside an `APIEndpoint` request or response definition. This is superficially convenient, but it breaks one of the graph's core design principles: every primitive property and every nested structure that matters for lineage should exist as addressable graph nodes.

The system needs a clear rule for representing object-shaped contracts without smuggling in ad hoc JSON blobs or creating pressure to misuse `DomainModel` for transport payloads. It also needs to stay consistent with ADR-002's cluster-file rule that a root node and its owned children should usually be represented together in one file.

---

## Decision Drivers

- **Field integrity is non-negotiable.** Primitive properties must be represented as `Field` nodes, not hidden inside arbitrary inline objects.
- **Transport contracts are not always domain models.** API request and response bodies often differ from internal domain models. The graph needs a neutral structured type for contract shapes.
- **Object boundaries still matter.** A set of fields needs a parent boundary that says "these fields together form one object-shaped contract".
- **Do not reimplement JSON Schema or OpenAPI.** The graph needs object boundaries and field ownership, not a general-purpose schema language.
- **Reuse across packs.** The same shape concept should work for REST requests, REST responses, messaging payloads, and other structured contracts.

---

## Options Considered

### Option A: Inline arbitrary objects on owning nodes

An `APIEndpoint` request or response contains a free-form object property describing nested fields directly.

**Pros:**
- Fastest to author
- Familiar to people thinking in JSON or OpenAPI examples

**Cons:**
- Breaks the graph model by hiding primitives and nested structure inside non-addressable blobs
- Prevents first-class field lineage and referential integrity
- Encourages inconsistent, one-off shape encodings across packs
- Creates pressure to partially reinvent JSON Schema inside template properties

**Effort:** Low, but architecturally incorrect

---

### Option B: Reuse `DomainModel` or `ValueObject` for all structured payloads

Every request or response shape is represented as a domain model or value object.

**Pros:**
- Reuses existing node types
- Keeps all structure graph-native

**Cons:**
- Conflates transport contracts with domain concepts
- Forces domain semantics onto shapes that exist only at the API or messaging boundary
- Makes the model harder to reason about because one type is carrying two different meanings

**Effort:** Low-medium, but conceptually wrong

---

### Option C: Introduce a dedicated `Schema` node that owns `Field` nodes (selected)

A `Schema` node represents an object-shaped contract boundary. All actual properties are represented as owned `Field` nodes. Request and response contracts use `Schema` nodes rather than embedding arbitrary objects inline. When a schema is owned by one root node, it lives in that root node's cluster file; when it is shared, it gets its own cluster file.

**Pros:**
- Preserves field-level integrity and addressability
- Cleanly separates transport/object shape from domain modelling
- Reusable across REST, messaging, and other packs
- Keeps the model intentionally narrow: object boundary plus fields, not a full schema language

**Cons:**
- Adds one more core node type to understand
- Produces more nodes than inline object literals would

**Effort:** Low-medium and aligned with the graph architecture

---

## Decision

**Chosen option: Option C - introduce a dedicated `Schema` node that owns `Field` nodes**

`Schema` is the graph's canonical representation of an object-shaped contract boundary.

It is deliberately narrow:

- A `Schema` node represents an object shape only
- A `Schema` node does not carry arbitrary inline properties describing nested structure
- All actual properties of the shape are represented as owned `Field` nodes
- Nested object structure is represented by a `Field.fieldType` reference to another `Schema`, `ValueObject`, `DomainModel`, or other valid structured node type
- Collections are represented through `Field.cardinality`, not through inline array schemas

This means the graph models object structure through nodes and edges, not through embedded documents.

`Schema` follows the same storage rule as other owned nodes:

- In the logical model, a `Schema` is a first-class node
- In the file format, a `Schema` may be embedded inside its owning root node's cluster file
- A `Schema` only needs its own separate cluster file when it is shared across multiple root nodes and therefore is not definitionally owned by one parent

---

## What `Schema` Is For

`Schema` exists to model structured shapes that are meaningful in the graph but are not necessarily domain concepts.

Typical examples:

- REST request bodies
- REST response bodies
- Event payload shapes
- Shared transport-level contract fragments

`Schema` is transport-agnostic. It may be referenced from the `rest` pack today and from other packs later.

In storage terms, most `Schema` nodes are expected to be embedded in the cluster file of the thing that owns them, for example an API endpoint cluster containing its request schema and response schemas.

---

## What `Schema` Is Not

`Schema` is not:

- A JSON Schema document
- An OpenAPI Schema Object
- A free-form serialised blob
- A replacement for `DomainModel` when the thing being modelled is actually a domain concept

The purpose of `Schema` is to provide an object boundary for owned `Field` nodes. Nothing more.

---

## Modelling Rules

### Rule 1: No inline arbitrary objects for contract structure

Structured request and response contracts must not be represented as arbitrary nested objects inside template properties.

If a shape needs fields, it gets a `Schema` node.

---

### Rule 2: All primitive properties are `Field` nodes

Every primitive property that is part of a modelled contract must exist as a `Field` node owned by a `Schema`, `DomainModel`, `ValueObject`, or another valid structured parent.

This is the core integrity rule that preserves lineage and mapping.

---

### Rule 3: `Schema` owns fields; it does not duplicate them

`Schema` itself has no inline shape definition beyond being an object boundary. Its role is ownership and meaning, not re-describing the fields it owns.

---

### Rule 4: Owned schemas stay in the owning root's cluster file

If a `Schema` exists only because of one parent, it is an owned node and should be serialised inside that parent's cluster file rather than in a separate file.

This means an API endpoint cluster file may contain:

- the `APIEndpoint` root node
- an owned request `Schema`
- owned response `Schema` nodes
- the `Field` nodes owned by those schemas

This preserves the "one endpoint in one file" goal while keeping schemas and fields as first-class nodes in the runtime graph.

Only shared schemas that are referenced by multiple root nodes should move to their own cluster file.

---

### Rule 5: API contracts use `Schema` nodes, not arbitrary objects

For REST, `APIEndpoint` request and response contracts use `Schema` nodes rather than embedding arbitrary request/response field structures inline.

For example:

```yaml
schema-version: "1.0"
id: orders.api-endpoints.post-orders
template: APIEndpoint
properties:
  method: POST
  path: /orders

request:
  id: orders.api-endpoints.post-orders.request
  template: Schema
  fields:
    - id: orders.api-endpoints.post-orders.request.fields.customer-id
      name: customerId
      fieldType: uuid
      nullable: false
      cardinality: one

responses:
  "201":
    id: orders.api-endpoints.post-orders.responses.201
    template: Schema
    fields:
      - id: orders.api-endpoints.post-orders.responses.201.fields.order-id
        name: orderId
        fieldType: uuid
        nullable: false
        cardinality: one
```

The request and response objects in the file are serialised forms of owned `Schema` nodes. Their fields are owned `Field` nodes and become first-class runtime nodes when the cluster is loaded.

---

### Rule 6: Use `DomainModel` only when the shape is actually a domain concept

If a request or response body is literally a domain concept and should behave like one in the graph, referencing a `DomainModel` is valid.

But the default for transport-level object contracts is `Schema`, not `DomainModel`.

This keeps the model honest about the difference between:

- internal domain structure
- external or boundary-specific contract structure

---

## Consequences

**What becomes easier:**

- Field-level lineage remains consistent across domain, API, and messaging shapes
- Request and response contracts can be reused without pretending they are domain entities
- Entire endpoints can still be represented in one cluster file
- The model stays graph-native without dragging in a second schema language
- Future import/export adapters have a clear target shape to map to

**What becomes harder:**

- A contract shape now needs its own node instead of being embedded inline
- Authors must choose deliberately between `Schema`, `DomainModel`, and `ValueObject`

**What is intentionally prevented:**

- Arbitrary nested objects in template properties
- Hidden primitive fields that cannot participate in lineage
- Treating OpenAPI or JSON Schema objects as the system's canonical internal model

---

## Linter and Runtime Implications

From this ADR, the linter and runtime should converge toward the following rules:

- A request or response shape embedded in an endpoint cluster file should load as a `Schema` node plus owned `Field` nodes
- Shared schemas referenced across root nodes should resolve to valid node IDs
- Arbitrary inline object-shaped contract definitions should be rejected where a `Schema` node is required
- `Field` nodes owned by a `Schema` are first-class nodes like any other owned node
- Field mappings and lineage operate over those `Field` node IDs exactly as they do elsewhere

Exact enforcement details remain the responsibility of ADR-006 and implementation work.

---

## Related

- ADR-002: Graph file format and cluster boundaries - establishes owned nodes and cluster boundaries
- ADR-003: Graph loading and runtime representation - loads owned nodes as first-class graph nodes
- ADR-003b: Core logical data model - establishes `Field` as the atomic unit of field-level lineage
- ADR-004: Template pack format - defines `Schema` as a template-level node type within the core pack
- ADR-006: Linter and validator - will enforce the no-inline-arbitrary-objects rule
