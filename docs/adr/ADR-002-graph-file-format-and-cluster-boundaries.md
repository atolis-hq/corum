# ADR-002: Graph File Format and Cluster Boundaries

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-001 (Storage and Interaction Architecture)  
**Related:** ADR-003 (Graph Loading and Runtime Representation), ADR-004 (Template Pack Format), ADR-006 (Linter and Validator)

---

## Context and Problem Statement

ADR-001 established that YAML files in a dedicated Git repository are the canonical store for the design graph. This ADR answers the next set of questions: how is that repository structured, what does a node file look like, and — most importantly — what is the right granularity for a file?

The granularity question is the hardest part of this decision. A design graph contains nodes of many kinds (API endpoints, domain models, events, operations, fields, enum values) with natural ownership relationships between them. The file format must decide whether each node gets its own file, or whether related nodes are clustered together. This choice directly affects readability, merge conflict frequency, agent comprehension, and linter complexity.

---

## Decision Drivers

- **Readability without tooling.** A human reviewing a PR or an agent reading a file directly must be able to understand the design intent without loading the graph tool. Files that are too granular lose context; files that are too large lose focus.
- **Merge conflict minimisation.** Files that change together should be together. Files that change independently should be separate. Concurrent changes to different root nodes must never conflict.
- **Agent comprehension.** An agent reading a file to understand a design artefact should get sufficient context in a single read. A field in isolation is not useful; a field in the context of its parent schema is.
- **Ownership as the clustering principle.** Some nodes only exist because of a parent — a request schema only exists because an API endpoint exists; an enum value only exists because an enum exists. These are owned nodes. Independent nodes can stand alone. This distinction should drive file boundaries.
- **Explicit, stable node IDs.** Node IDs must be globally unique across the graph repo and must not depend on filesystem structure for resolution. Renaming a directory must not silently break node references.
- **Linter enforceability.** All naming and placement conventions must be mechanically verifiable without domain knowledge.

---

## The Central Decision: Cluster Boundaries

### Option A: One file per node (flat)

Every node — endpoint, schema, field, enum value, operation, invariant — is its own YAML file. Relationships are declared via references to node IDs.

**Pros:**
- Maximum diff granularity — a change to one field touches exactly one file
- Every node is independently addressable by filename

**Cons:**
- A field node in isolation carries no useful context — an agent or human must load related files to understand it
- Thousands of files for any non-trivial graph — GitHub PR views become unusable
- An agent enriching a domain model's schema touches dozens of files, producing a noisy diff that is hard to review meaningfully
- The ownership relationship between a parent and its children is invisible from the filesystem — it must be inferred from edge declarations

**Effort:** Low to implement, but produces a poor human and agent experience

---

### Option B: One file per component (monolithic)

All nodes within a component live in a single YAML file.

**Pros:**
- A component is fully readable in one file
- No cross-file reference resolution within a component

**Cons:**
- Every change to any node in the component touches the same file — merge conflicts are constant for active components
- Becomes unmanageably large for non-trivial services
- Cannot use CODEOWNERS to gate specific node types
- A one-line description change produces a diff in a file with hundreds of other nodes

**Effort:** Low to implement, but fundamentally broken for concurrent work

---

### Option C: Cluster files by ownership, separate edge files by node-type pair (selected)

A cluster file groups a root node with all nodes whose existence is definitionally dependent on that root — its owned children. Edges between root nodes live in separate edge files. The ownership relationship, not node type, determines what belongs in a cluster.

**What is a root node?** A node that is independently meaningful and addressable in isolation. A domain model, an API endpoint, a domain event, an operation are all root nodes. They have an identity independent of any parent.

**What is an owned node?** A node that only exists because of a parent. A request schema only exists because its endpoint exists. A field only exists because its schema exists. An enum value only exists because its enum exists. An invariant only exists because its domain model exists. These are owned nodes and live in the cluster file of their root.

**In the runtime graph, owned nodes are still nodes.** The cluster file is a human-optimised serialisation. When the MCP server loads the graph, every field, every enum value, every invariant becomes a first-class node with its own ID and its own edges. The cluster boundary is a file format concern, not a data model concern.

**Pros:**
- PR diffs map to natural units of design review — "added a field to the Order model" touches exactly one file
- Agents reading a cluster file get full context for a root node and all its owned children in a single read
- Edge files are neutral — neither endpoint owns the relationship
- Merge conflicts are bounded to concurrent changes to the same root node
- The ownership rule is clear and consistently applicable

**Cons:**
- Understanding a root node's full connectivity requires reading the cluster file and the relevant edge files — the runtime graph is the complete picture
- Renaming a root node ID is a multi-file refactor (cluster filename, all edge file references, all owned node IDs) — the CLI must support this atomically
- Shared types (e.g. a `Money` type used by multiple models) must be given their own cluster file rather than being inlined — teams must recognise when a type crosses the ownership boundary

**Effort:** Medium — the ownership rule and ID namespacing convention are the main design investments

---

## Decision

**Chosen option: Option C — cluster files by ownership, separate edge files by node-type pair**

The ownership rule provides a clear, consistently applicable answer to the cluster boundary question. The runtime graph treats all nodes as first-class regardless of how they are grouped in files.

---

## Directory Structure

```
graph-repo/
  graph.yaml                              # Repo-level metadata, template pack declaration
  components/
    orders/                               # One directory per component
      APIEndpoints/                       # Folder named after the template (PascalCase, plural)
        create-order.yaml                 # Cluster: endpoint + request/response schemas + fields
        get-order.yaml
      DomainModels/
        order.yaml                        # Cluster: model + fields + enums + invariants + operations
        order-item.yaml
      DomainEvents/
        order-placed.yaml                 # Cluster: event + payload schema + fields
      ValueObjects/
        money.yaml                        # Cluster: shared value object used across models
      edges/
        APIEndpoints--DomainModels.yaml   # Within-component edges between these node types
        APIEndpoints--DomainOperations.yaml
        DomainOperations--DomainEvents.yaml
    payments/
      ...
  edges/
    orders--payments.yaml                 # Cross-component edges (alphabetical component order)
```

---

## Node ID Convention

Node IDs are **fully qualified and declared explicitly in each file**. The folder structure is for human navigation only — it does not contribute to ID resolution.

**Format:** `{component}.{TemplateName}.{node-name}`

The template name segment matches the template name exactly (PascalCase singular), corresponding to the plural folder that contains the file.

Examples:
- `orders.APIEndpoint.create-order`
- `orders.DomainModel.order`
- `payments.DomainModel.payment`

**Owned node IDs** extend the root node ID:
- `orders.DomainModel.order.fields.customerId`
- `orders.DomainModel.order.enums.order-status`
- `orders.DomainModel.order.enums.order-status.values.cancelled`
- `orders.APIEndpoint.create-order.schemas.create-order-request.fields.customerId`

**Rationale for explicit over folder-derived IDs:** If IDs were derived from folder paths, reorganising the directory structure would silently break all edge references and field mappings. With explicit IDs in the file, a directory move is immediately caught by the linter — the declared ID no longer matches the expected path. Renames have the same blast radius either way; explicit IDs make that blast radius visible.

---

## Cluster File Schemas

### API Endpoint cluster

```yaml
# components/orders/api-endpoints/POST-orders.yaml

schema-version: "1.0"
id: orders.api-endpoints.post-orders
template: APIEndpoint
state: proposed                    # draft | proposed | agreed | future | removed
stability: unstable                # unstable | stable | deprecated
name: "POST /orders"
description: |
  Creates a new order for the authenticated customer.

properties:
  method: POST
  path: /orders
  auth: bearer-token

request:
  id: orders.api-endpoints.post-orders.request
  description: "Order creation payload"
  fields:
    - id: orders.api-endpoints.post-orders.request.fields.customer-id
      name: customerId
      type: uuid
      nullable: false
      cardinality: one
      state: proposed
      stability: unstable
      description: "The placing customer's identifier"

    - id: orders.api-endpoints.post-orders.request.fields.items
      name: items
      type: orders.shared-types.order-item-input   # Reference to a shared type by ID
      nullable: false
      cardinality: many
      state: proposed
      stability: unstable
      description: "Line items to include in the order"

response:
  "201":
    id: orders.api-endpoints.post-orders.response.201
    description: "Successfully created order"
    fields:
      - id: orders.api-endpoints.post-orders.response.201.fields.order-id
        name: orderId
        type: uuid
        nullable: false
        cardinality: one
        state: proposed
        stability: unstable
        description: "The newly created order's identifier"

  "400":
    description: "Validation failure"
  "401":
    description: "Authentication required"

metadata:
  extractedFrom: "src/api/orders/POST.ts"
  lastModifiedAt: "2026-04-12T10:00:00Z"
```

---

### Domain Model cluster

```yaml
# components/orders/domain-models/order.yaml

schema-version: "1.0"
id: orders.domain-models.order
template: DomainModel
state: agreed
stability: stable
name: Order
description: |
  Represents a customer purchase order throughout its lifecycle.

fields:
  - id: orders.domain-models.order.fields.order-id
    name: orderId
    type: uuid
    nullable: false
    cardinality: one
    state: agreed
    stability: stable
    description: "Unique order identifier"

  - id: orders.domain-models.order.fields.customer-id
    name: customerId
    type: uuid
    nullable: false
    cardinality: one
    state: agreed
    stability: stable
    description: "Reference to the placing customer"

  - id: orders.domain-models.order.fields.status
    name: status
    type: orders.domain-models.order.enums.status   # Reference to owned enum by ID
    nullable: false
    cardinality: one
    state: agreed
    stability: stable
    description: "Current lifecycle state"

  - id: orders.domain-models.order.fields.items
    name: items
    type: orders.domain-models.order-item           # Reference to sibling model by ID
    nullable: false
    cardinality: many
    description: "Line items within this order"

enums:
  - id: orders.domain-models.order.enums.status
    name: OrderStatus
    state: agreed
    stability: stable
    description: "Lifecycle states for an order"
    values:
      - id: orders.domain-models.order.enums.status.values.pending
        name: PENDING
        state: agreed
        stability: stable
        description: "Order received, not yet processed"

      - id: orders.domain-models.order.enums.status.values.confirmed
        name: CONFIRMED
        state: agreed
        stability: stable
        description: "Order confirmed, payment captured"

      - id: orders.domain-models.order.enums.status.values.cancelled
        name: CANCELLED
        state: agreed
        stability: deprecated
        description: "Order cancelled by customer or system"

invariants:
  - id: orders.domain-models.order.invariants.items-not-empty
    name: OrderMustHaveItems
    state: agreed
    description: "An order must always contain at least one line item"

  - id: orders.domain-models.order.invariants.confirmed-requires-payment
    name: ConfirmedOrderRequiresPayment
    state: proposed
    description: "An order cannot be CONFIRMED without a corresponding payment record"

operations:
  - id: orders.domain-models.order.operations.place-order
    name: PlaceOrder
    state: agreed
    stability: stable
    description: "Creates and confirms a new order"
    # Behaviour, state modifications, and emitted events are declared via edges
    # to keep the cluster file focused on structure rather than flow.
    # See: components/orders/edges/operations--domain-events.yaml

metadata:
  lastModifiedAt: "2026-04-12T10:00:00Z"
```

---

### Domain Event cluster

```yaml
# components/orders/domain-events/order-placed.yaml

schema-version: "1.0"
id: orders.domain-events.order-placed
template: DomainEvent
state: agreed
stability: stable
name: OrderPlaced
description: |
  Published when an order is successfully placed and confirmed.

payload:
  fields:
    - id: orders.domain-events.order-placed.payload.fields.order-id
      name: orderId
      type: uuid
      nullable: false
      cardinality: one
      state: agreed
      stability: stable

    - id: orders.domain-events.order-placed.payload.fields.customer-id
      name: customerId
      type: uuid
      nullable: false
      cardinality: one
      state: agreed
      stability: stable

metadata:
  lastModifiedAt: "2026-04-12T10:00:00Z"
```

---

### Shared type cluster

A type that is owned by multiple root nodes — meaning no single parent can claim it — gets its own cluster file. The owning node type directory is `shared-types`.

```yaml
# components/orders/shared-types/money.yaml

schema-version: "1.0"
id: orders.shared-types.money
template: ValueObject
state: agreed
stability: stable
name: Money
description: "Represents a monetary amount with currency"

fields:
  - id: orders.shared-types.money.fields.amount
    name: amount
    type: decimal
    nullable: false
    cardinality: one
    state: agreed
    stability: stable

  - id: orders.shared-types.money.fields.currency
    name: currency
    type: orders.shared-types.currency-code    # Reference to another shared type
    nullable: false
    cardinality: one
    state: agreed
    stability: stable
```

---

## Edge File Schema

Edge files declare typed, directional relationships between root nodes. Directionality is inside the file; the filename is alphabetical and carries no directional meaning.

```yaml
# components/orders/edges/APIEndpoints--DomainModels.yaml

edges:
  - from: orders.APIEndpoint.create-order
    to: orders.DomainModel.order
    type: reads
    notes: POST /orders creates and returns an Order aggregate

  - from: orders.APIEndpoint.create-order.schemas.create-order-response.fields.orderId
    to: orders.DomainModel.order.fields.id
    type: maps-to

  - from: orders.APIEndpoint.create-order.schemas.create-order-request.fields.customerId
    to: orders.DomainModel.order.fields.customerId
    type: maps-to
```

**Edge IDs are derived, not declared.** The loader computes each edge's ID as `{from}__{type}__{to}` at load time. Authors never write edge IDs — they are always derivable from the three required fields and cannot drift out of sync.

**Edge file naming:** alphabetical by the two template folder names being connected. Enforced by the linter. `APIEndpoints--DomainModels.yaml` not `DomainModels--APIEndpoints.yaml`.

**Cross-component edge file naming:** alphabetical by the two component directory names. Lives in the top-level `edges/` directory. `orders--payments.yaml` not `payments--orders.yaml`.

---

## `graph.yaml` — Repository Metadata

```yaml
schema-version: "1.0"
name: "Acme Corp Design Graph"
templatePacks:  
  - name: core
    version: "1.0.0"
  - name: rest
    version: "1.0.0"
  - name: messaging
    version: "1.0.0"
  - name: domain
    version: "1.0.0"

components:
  - id: orders
    path: components/orders
    description: "Order management bounded context"
  - id: payments
    path: components/payments
    description: "Payment processing bounded context"
```

---

## YAML Safety Constraints

- Files must parse as **YAML 1.2** — eliminates the Norway problem (`NO` parsed as `false` in YAML 1.1)
- The `!!` explicit type tag syntax is prohibited
- Ambiguously typed string values must be quoted: `"true"`, `"null"`, `"1.0"`, ISO dates
- YAML anchors permitted within a file; prohibited across files
- A JSON Schema definition for each file type is maintained alongside the template pack for IDE validation

---

## Schema Versioning

`schema-version` is the file format version, present in every file. Version semantics:

- **Patch:** New optional fields — backward compatible, no migration required
- **Minor:** New required fields with defaults — backward compatible, linter warns on old files  
- **Major:** Breaking changes — linter rejects old files; migration CLI command required

---

## Linter Responsibilities (full specification in ADR-006)

From this ADR, the linter must enforce:

- All node IDs are fully qualified and match the pattern `{component}.{node-type}.{node-name}[.{path}]`
- All owned node IDs are prefixed with their root node ID
- All edge files are named in alphabetical node-type order
- All cross-component edge files are named in alphabetical component order
- All `from` and `to` references resolve to a declared node ID in the graph repo
- No cross-node relationships declared inline in cluster files — they must be in edge files
- All template folder names are the plural PascalCase form of a template name declared in the active template pack
- All `state` and `stability` values are valid members of their respective enumerations

---

## Consequences

**What becomes easier:**
- PR diffs are scoped to one cluster file per root node — legible without loading the tool
- Agents reading a cluster file get full context including owned children in a single read
- Edge files are locatable by mechanical naming convention — no scanning required
- Merge conflicts are bounded to concurrent changes to the same root node or same edge type pair
- Field and enum value IDs are globally addressable and derivable without a registry

**What becomes harder:**
- Shared types must be explicitly recognised as such and given their own cluster file — teams must apply the ownership rule
- Renaming a root node is a multi-file refactor — the CLI must handle this atomically
- Full connectivity for a root node requires reading cluster file plus relevant edge files — the runtime graph is the complete picture

**What is newly possible:**
- CODEOWNERS can gate specific node types — `api-endpoints/` changes require senior engineer approval
- The linter catches broken references in CI — referential integrity without a database
- Operations, invariants, and enum values are independently commentable and stateful in the runtime graph

---

## Open Questions Deferred to Other ADRs

- **How far to model operations:** operations are declared in the cluster file with name, description, state, and stability. Their full behaviour — state transitions, emitted events, preconditions — is deferred to a later ADR. Edge files carry the event emission relationship; richer behavioural modelling may follow.
- **Template pack format:** the valid node-type directory names depend on ADR-004
- **Linter implementation detail:** ADR-006
- **Runtime representation of owned nodes as first-class graph nodes:** ADR-003

---

## Related

- ADR-001: Storage and interaction architecture — establishes Git as the canonical store
- ADR-003: Graph loading and runtime representation — how the MCP server parses cluster files into a runtime graph where all nodes are first-class
- ADR-004: Template pack format — defines valid node types and the `template` field values used in cluster files
- ADR-006: Linter and validator — enforces the naming and referential integrity rules defined here
- PDR-001: Tool scope and node taxonomy — state model (`draft`, `proposed`, `agreed`, `future`, `removed`, `implemented`) and stability levels (`unstable`, `stable`, `deprecated`)
- PDR-003: Template packs and plugin architecture — establishes that `Field` is a core template and that all node types are templates


