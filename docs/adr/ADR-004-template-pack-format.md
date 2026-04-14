# ADR-004: Template Pack Format

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-002 (Graph File Format), ADR-003b (Core Logical Data Model)  
**Related:** ADR-005 (MCP Tool Surface), ADR-006 (Linter and Validator)  
**Implements:** PDR-003 (Template Packs, Node Types, and Plugin Architecture)

---

## Context and Problem Statement

ADR-003b established that every node carries a `template` property referencing a named type in the active template pack. The template pack is the extensibility contract for the entire tool — it defines what node types exist, what properties they carry, how they display, and how they are found in code.

This ADR decides the concrete format of a template pack: how individual templates are structured, how packs are composed and versioned, how node types are extended, and how schemas are enforced. It also establishes the canonical pack taxonomy — a set of focused, composable packs aligned to spec formats, domain modelling, and methodology tooling — replacing a single monolithic default pack.

---

## Decision Drivers

- **All node types are templates.** The tool has no hardcoded node types. The universal node properties from ADR-003b are always present; everything else comes from the template pack.
- **`Field` is the only core template.** It cannot be removed, only extended. All other templates are optional.
- **Templates are self-contained schema definitions.** A template defines what a node type *is* — its property schema, its display hints, and its description. It does not define what connections it may form (edge validity is a graph-level concern) and does not embed extraction logic (extractors know how to produce valid nodes from the schema definition alone).
- **Extension is at the node type level, not the pack level.** Teams extend an existing node type by defining a new template that declares `extends`. At load time the MCP server merges the parent and child files — the child's `properties` JSON Schema is merged with the parent's using `allOf` semantics, and `description`, `ui`, and other sections in the child override the parent. There is no in-place override mechanism; conflicts between packs must be resolved by renaming.
- **The `properties` section is a JSON Schema document.** The full JSON Schema specification (Draft 7 / 2019-09 / 2020-12) is supported — all keywords, all composition operators (`allOf`, `oneOf`, `anyOf`), `$defs` for reusable sub-schemas, `default` values, `readOnly` flags, `examples`, `additionalProperties`, and everything else in the standard. Templates are written in YAML for readability, but the `properties` value is a JSON Schema object and is validated by a standard JSON Schema validator. There is no bespoke schema language, no subset, no extensions. The template's property schema governs the flat properties of a node; owned child structures (request schemas, response schemas, fields) are governed by the cluster file format in ADR-002 and the `Field` core template.
- **Packs are composable units of distribution.** A pack may contain one template or many. The default pack ships with the tool. Teams install additional packs alongside it. Packs are the distribution unit for templates, UI components, and output plugins.
- **Templates may be abstract.** A template marked `abstract: true` defines a shared schema base but cannot be instantiated directly — no node may declare that template as its type. Abstract templates exist only to be extended by concrete subtypes. The linter enforces that no node file references an abstract template name. This supports shared schema bases (e.g. an `Event` base for `DomainEvent` and `IntegrationEvent`) without forcing teams to work at the wrong level of abstraction.
- **Format participation is configuration, not template structure.** Whether a node type participates in OpenAPI, AsyncAPI, or any other spec format is declared in adapter configuration, not encoded as template properties. Templates are format-agnostic — the same `IntegrationEvent` template is used regardless of whether the team exports to AsyncAPI or not.
- **Drift detection policy is configuration, not template metadata.** Which node types constitute external contracts is declared in drift detection configuration (a future ADR), not in the template. Templates do not carry a `contractBoundary` flag.

---

## Options Considered

### Option A: Single-file pack

All templates in one YAML file.

**Pros:** Simple to distribute; easy to version as a unit  
**Cons:** Unmanageable at scale; merge conflicts on concurrent edits; no CODEOWNERS granularity  
**Effort:** Low — too low; not appropriate for a system designed to be extended

---

### Option B: One file per template, pack manifest (selected)

Each template is its own YAML file. A `pack.yaml` manifest at the root declares the pack identity and the list of templates it includes.

**Pros:** Each template is independently reviewable; merge conflicts bounded to the template being changed; CODEOWNERS can gate individual templates; additive extension is one new file plus one manifest line  
**Cons:** Slightly more structure than a single file — acceptable given the extensibility requirements  
**Effort:** Low-medium

---

### Option C: JSON Schema files as templates

Templates are pure JSON Schema documents in a pack directory.

**Pros:** Standard format with wide tooling support  
**Cons:** JSON Schema does not have a natural place for description, UI hints, or extraction guidance — requires significant non-standard extensions; inconsistent with the YAML-throughout approach of the graph repo  
**Effort:** Medium — the extensions negate the standardisation benefit

---

## Decision

**Chosen option: Option B — one file per template, pack manifest**

Templates are YAML files, but the `properties` section within each template uses JSON Schema vocabulary. This combines YAML readability with the validation power of the JSON Schema standard — exactly the pattern OpenAPI uses.

---

## Pack Taxonomy

Packs are split along three lines — spec-aligned, domain, and methodology — rather than shipping as a single monolithic default. Each pack is independently installable and composable with others.

### Spec-aligned packs

These packs contain templates that correspond to concepts in an external specification format. Each ships alongside its adapter (the component that imports/exports the spec format). Teams install the packs matching the spec formats their services use.

**`core` pack** — always loaded; required by all other packs  
Contains `Field` (the only `core: true` template).

**`rest` pack** — for HTTP/REST services (adapter: OpenAPI)  
Contains `APIEndpoint`.

**`messaging` pack** — for event-driven services (adapter: AsyncAPI)  
Contains the abstract `Event` base plus `IntegrationEvent` (extends Event) and `DomainEvent` (extends Event).

**`graphql` pack** — for GraphQL services (adapter: GraphQL SDL) — *planned*  
Will contain `GraphQLQuery`, `GraphQLMutation`, `GraphQLSubscription`, `GraphQLType`.

### Domain pack

**`domain` pack** — fills the internal domain gap; no external spec format  
Contains `DomainModel`, `DomainOperation`, `Command`, `ReadModel`, `ValueObject`, `Invariant`.  
The cluster files for these node types are the spec format — no external adapter exists or is needed.

### Methodology packs

These packs contain templates for design and facilitation concepts. They do not correspond to any spec format and have no adapters.

**`design` pack** — general design tooling  
Contains `UserJourney`.

**`event-storming` pack** — event storming facilitation concepts  
Contains `HotSpot`, `Aggregate`, `ExternalSystem`, `Policy`, `Actor`. Captures the output of event storming sessions as first-class graph nodes before they are refined into domain or messaging nodes.

**`event-modelling` pack** — event modelling methodology concepts  
Contains `Slice` (a vertical slice of command + event + read model), `Processor`, `AutomationPolicy`. Supports teams following the Adam Dymitruk event modelling approach.

---

### Default installation

The default installation bundles `core + rest + messaging + domain` — the most common combination for web service teams. No configuration required to get started.

Teams add packs in `graph.yaml`:

```yaml
templatePacks:
  - name: core
    version: "1.0.0"
  - name: rest
    version: "1.0.0"
  - name: messaging
    version: "1.0.0"
  - name: domain
    version: "1.0.0"
  # Optional — add as needed:
  # - name: graphql
  #   version: "1.0.0"
  # - name: event-storming
  #   version: "1.0.0"
  # - name: event-modelling
  #   version: "1.0.0"
  # - name: my-extensions
  #   path: ./template-packs/my-extensions
```

---

## Template Pack Directory Structure

Each pack is a directory with the same internal structure regardless of type.

```
core/
  pack.yaml
  templates/
    Field.yaml             # core: true — required by the tool itself
  edge-types.yaml          # Reserved for future custom edge type extension (see ADR-004b)
  components/              # Reserved for UI components (future ADR)

rest/
  pack.yaml
  templates/
    APIEndpoint.yaml

messaging/
  pack.yaml
  templates/
    Event.yaml             # abstract: true ??? base for all event subtypes
    DomainEvent.yaml       # extends: Event (from messaging pack)
    IntegrationEvent.yaml  # extends: Event (from messaging pack)

domain/
  pack.yaml
  templates/
    DomainModel.yaml
    DomainOperation.yaml
    Command.yaml
    ReadModel.yaml
    ValueObject.yaml
    Invariant.yaml

design/
  pack.yaml
  templates/
    UserJourney.yaml

event-storming/
  pack.yaml
  templates/
    HotSpot.yaml
    Aggregate.yaml
    ExternalSystem.yaml
    Policy.yaml
    Actor.yaml

event-modelling/
  pack.yaml
  templates/
    Slice.yaml
    Processor.yaml
    AutomationPolicy.yaml
```

---

## `pack.yaml` — Pack Manifest

Each pack has its own manifest. Cross-pack template references (e.g. `DomainEvent extends Event` where `Event` is in the `core` pack) are resolved at load time — the MCP server merges all loaded packs before resolving `extends` chains.

```yaml
# core/pack.yaml
name: core
version: "1.0.0"
description: "Core templates required by all graphs"
templates:
  - Field    # core: true
  - Event    # abstract: true
```

```yaml
# messaging/pack.yaml
name: messaging
version: "1.0.0"
description: "Templates for event-driven services. Adapter: AsyncAPI"
requires:
  - core
templates:
  - DomainEvent
  - IntegrationEvent
```

```yaml
# domain/pack.yaml
name: domain
version: "1.0.0"
description: "Internal domain model templates. No external spec format."
templates:
  - DomainModel
  - DomainOperation
  - Command
  - ReadModel
  - ValueObject
  - Invariant
```

The `requires` field declares pack dependencies. If a required pack is not loaded, the MCP server emits an error on startup. Template name collisions across loaded packs remain an explicit error.

---

## Template File Format

### Abstract base template

A template marked `abstract: true` defines shared schema for subtypes and cannot be instantiated directly. Concrete subtypes use `extends` to inherit the schema and override or supplement as needed.

```yaml
# messaging/templates/Event.yaml

name: Event
version: "1.0.0"
core: false
abstract: true
description: |
  Abstract base for all event types. Defines the shared payload schema.
  Use DomainEvent for internal facts; IntegrationEvent for cross-service contracts.

properties:
  type: object
  properties:
    correlationId:
      type: string
      description: "Optional correlation ID for tracing event chains"

ui:
  icon: event
  colour: "#E8A838"
  displayProperties: []
```

```yaml
# templates/DomainEvent.yaml

name: DomainEvent
version: "1.0.0"
core: false
extends: Event
description: |
  A fact that something happened within a bounded context.
  Internal to the component — whether other systems may subscribe
  to this event is an architectural decision made independently
  of this node type.
```

```yaml
# templates/IntegrationEvent.yaml

name: IntegrationEvent
version: "1.0.0"
core: false
extends: Event
description: |
  An event published for consumption by other bounded contexts
  or external systems. Represents a cross-service contract —
  changes to the payload schema affect consumers.
```

`DomainEvent` and `IntegrationEvent` are semantically distinct but structurally identical — both inherit the `Event` payload schema. The distinction is about bounded context boundaries, not about which spec format the event appears in. Whether a `DomainEvent` or `IntegrationEvent` is exported to AsyncAPI is a configuration decision in the adapter layer, not a property of the template.

---

### Minimal valid template

```yaml
name: DomainEvent
version: "1.0.0"
core: false
description: |
  A fact that something happened within a bounded context.
  Internal to the component — not part of the external contract surface.
  Published when an operation completes successfully.
```

A node can exist with just `name` and `version`. All other sections add schema enforcement and display configuration progressively.

---

### Full template structure

```yaml
name: APIEndpoint
version: "1.0.0"
core: false
description: |
  An HTTP operation exposed to external consumers. The authoritative
  definition of what callers may invoke, what they must provide, and
  what they will receive in return.

# The `properties` value is a standard JSON Schema document (written in YAML).
# The full JSON Schema specification is supported — $defs, default, readOnly,
# examples, additionalProperties, allOf, oneOf, and all other standard keywords.
#
# This schema validates the `properties` block in node cluster files of this type.
# Universal node properties (id, template, state, stability, etc.) are always
# present on every node and are not declared here.
#
# Owned child structures (request schema, response schemas, and their fields)
# are governed by the cluster file format in ADR-002 and the Field core template,
# not by this schema. Only flat, scalar-valued properties belong here.
properties:
  $defs:
    HttpMethod:
      type: string
      enum: [GET, POST, PUT, PATCH, DELETE]

  type: object
  additionalProperties: false
  required:
    - method
    - path
  properties:
    method:
      $ref: "#/properties/$defs/HttpMethod"
      description: "HTTP method"
      examples: [GET, POST]
    path:
      type: string
      pattern: "^/"
      description: "URL path pattern — e.g. /orders/{orderId}"
      examples: ["/orders", "/orders/{orderId}"]
    auth:
      type: string
      default: "bearer-token"
      description: "Authentication mechanism"
      examples: ["bearer-token", "api-key", "none"]
    basePath:
      type: string
      description: "Optional base path prefix applied to all routes in this service"
      examples: ["/api/v1", "/internal"]

# Edge declarations: which edge types this node may send and receive.
# References names from the core edge type vocabulary defined in ADR-003b.
# supports — participates in either direction (common case)
# outgoing — sends only; incoming — receives only
# See ADR-004b for the full declaration model and validation rules.
edges:
  outgoing: [calls, produces]
  supports: [reads]

# UI section: display hints used by the generic renderer in v1.
# Purpose-built UI components (bundled in components/) override these hints
# when available. See the future UI component bundling ADR.
ui:
  icon: api-endpoint
  colour: "#4A90D9"
  displayProperties:
    - method
    - path
  badge: method
```

**On `$defs`:** Use `$defs` within the `properties` schema to define reusable sub-schemas referenced by multiple properties within the same template. This is standard JSON Schema — do not use YAML anchors for this purpose as they do not survive JSON Schema validation.

**On `default`:** Properties with `default` values allow extractors and agents to create valid nodes without populating every optional field. The MCP server applies defaults when loading nodes that omit defaulted properties.

**On `readOnly`:** Properties marked `readOnly: true` are system-derived and should not be set manually. No enforcement is applied — it is a documentation signal to tooling and agents.

**On `examples`:** Standard JSON Schema `examples` array. Used by documentation generators, tooling, and as format hints to extractors and agents. No validation impact.

---

### Node type extension

A team that wants a specialisation of an existing node type defines a new template that declares `extends`. At load time the MCP server merges parent and child into a single resolved template:

- The child's `properties` JSON Schema is merged with the parent's using `allOf` — both must be satisfied
- `description`, `ui`, and other top-level sections in the child replace the parent's equivalents
- The child may add new optional or required properties
- The child may not remove or narrow parent required properties

```yaml
# templates/InternalAPIEndpoint.yaml

name: InternalAPIEndpoint
version: "1.0.0"
core: false
extends: APIEndpoint
description: |
  An API endpoint for internal service-to-service communication only.
  Not exposed to external consumers. Lower change-risk than external endpoints.

# Adds properties on top of the merged APIEndpoint schema.
# method, path, and auth are inherited and still required.
properties:
  type: object
  properties:
    rateLimit:
      type: integer
      description: "Requests per second limit for this endpoint"
    callerService:
      type: string
      description: "The expected calling service — for documentation only"

ui:
  icon: internal-endpoint
  colour: "#888888"
  displayProperties:
    - method
    - path
    - callerService
```

**Extension rules enforced by the linter:**
- Child `properties` are merged with parent via `allOf` — child may not remove parent required properties
- Child may override `description`, `ui`, and `edges`
- `extends` must reference a template present in the loaded packs
- Circular extension chains are rejected

---

### `Field` template (core)

`Field` is the only core template. The `type`, `nullable`, and `cardinality` properties are fixed — they are the structural invariants the graph depends on for field-level lineage. Teams may extend `Field` with additional properties.

```yaml
name: Field
version: "1.0.0"
core: true
description: |
  A named property within a schema node. Fields are the atomic unit of
  field-level lineage. Every field is independently addressable, stateful,
  and can be connected to fields in other nodes via maps-to edges.

properties:
  type: object
  required:
    - fieldType
    - nullable
    - cardinality
  properties:
    fieldType:
      type: string
      description: |
        Scalar type (uuid, string, integer, decimal, boolean, datetime) or
        a node ID referencing a DomainModel, EnumDefinition, or ValueObject
    nullable:
      type: boolean
      description: "Whether this field may be absent or null"
    cardinality:
      type: string
      enum: [one, many]
      description: "Whether this field holds a single value or a collection"

ui:
  icon: field
  colour: "#888888"
  displayProperties:
    - fieldType
    - nullable
    - cardinality
```

Note: the property is named `fieldType` rather than `type` to avoid collision with JSON Schema's own `type` keyword when the template's property schema is parsed.

---

## Template Pack Summary

### `core` pack

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `Field` | true | false | Named property within any schema node |
| `Event` | false | true | Abstract base for all event subtypes |

### `rest` pack

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `APIEndpoint` | false | false | HTTP operation exposed to external consumers |

### `messaging` pack

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `DomainEvent` | false | false | Fact that something happened; extends Event |
| `IntegrationEvent` | false | false | Cross-service published event; extends Event |

`DomainEvent` and `IntegrationEvent` share the same payload schema (inherited from `Event`). Whether a `DomainEvent` is subscribable externally is an architectural decision — teams use `IntegrationEvent` to signal that explicitly. Whether either type appears in an AsyncAPI spec is determined by adapter configuration, not by the template.

### `domain` pack

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `DomainModel` | false | false | Domain entity with fields, enums, invariants, operations |
| `DomainOperation` | false | false | Named unit of behaviour within a domain model |
| `Command` | false | false | Explicit intent to change state; optional for REST-centric teams |
| `ReadModel` | false | false | Derived query projection |
| `ValueObject` | false | false | Shared type with no independent identity |
| `Invariant` | false | false | Business rule that must always hold |

### `design` pack (optional)

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `UserJourney` | false | false | Sequence of steps across a user experience |

### `event-storming` pack (optional)

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `HotSpot` | false | false | Area of uncertainty or conflict identified in a storming session |
| `Aggregate` | false | false | Cluster of domain objects treated as a unit |
| `ExternalSystem` | false | false | System outside the bounded context |
| `Policy` | false | false | Reactive rule: "whenever X, then Y" |
| `Actor` | false | false | Person or system initiating a command |

Event storming nodes are design-time artefacts. They are typically refined into `domain` or `messaging` nodes as the design matures, with `renamed-from` or `derived-from` edges preserving the trail.

### `event-modelling` pack (optional)

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `Slice` | false | false | Vertical slice grouping a command, event, and read model |
| `Processor` | false | false | Automation that reacts to an event and produces a command |
| `AutomationPolicy` | false | false | Rule governing processor behaviour |

Event modelling nodes capture the structure of an Adam Dymitruk-style event model. They compose with `domain` and `messaging` templates — a `Slice` references `Command`, `DomainEvent`, and `ReadModel` nodes via edges.

### `graphql` pack (planned)

| Template | `core` | `abstract` | Purpose |
|---|---|---|---|
| `GraphQLQuery` | false | false | Read operation in a GraphQL schema |
| `GraphQLMutation` | false | false | Write operation in a GraphQL schema |
| `GraphQLSubscription` | false | false | Real-time stream in a GraphQL schema; extends Event |
| `GraphQLType` | false | false | Named type in a GraphQL schema; maps to DomainModel concepts |

The GraphQL pack ships with a GraphQL SDL adapter. `GraphQLSubscription` extends `Event` from the messaging pack.

---

## Schema Enforcement

Templates define schemas; node cluster files are instances of those schemas.

**Template validation:** The template file format is itself defined by a JSON Schema (the meta-schema for templates). The MCP server validates all template files against this meta-schema on startup. An invalid template file prevents the pack from loading.

**Node validation:** When a node cluster file is loaded, the MCP server extracts the node's `properties` block and validates it against the JSON Schema defined in the node's template. Validation errors are reported as linter warnings — not hard errors — to allow partial graphs. A node may exist before all required properties are populated.

**Extension merge:** When a template declares `extends`, the MCP server resolves the full merged template before loading any nodes. The child's `properties` JSON Schema is combined with the parent's using `allOf` — a node must satisfy both schemas. Top-level fields (`description`, `ui`) in the child replace the parent's. The resolved, merged template is what the linter and MCP server work with at runtime; `extends` is an authoring convenience only.

---

## Template Versioning

Each template carries `version` in semver. The pack manifest carries a pack-level `version`.

**Patch** (`1.0.0` → `1.0.1`): New optional properties added. No existing nodes affected.

**Minor** (`1.0.0` → `1.1.0`): New required properties with defaults. Existing nodes flagged with `schema-drift` warning but remain loadable.

**Major** (`1.0.0` → `2.0.0`): Breaking change — required properties removed, renamed, or type-changed. The linter reports `schema-violation` errors on affected nodes. A migration CLI command is provided.

When a template version changes and existing nodes no longer fully conform, those nodes are flagged in the graph. The tool surfaces which nodes are affected and what changed. Resolution is manual — the tool does not auto-migrate. This is consistent with the human-review model from PDR-001.

---

## Edge Vocabulary

Templates do not declare valid edge targets. This was considered and rejected because:

- Edge targets listed in a template couple the template to other template names by string reference — if a team renames `DomainModel` to `Entity`, all templates listing `DomainModel` as a valid target are broken
- A new template cannot become a valid edge target without modifying every template that could connect to it
- The coupling prevents independent pack composition

Edge validity is instead a graph-level concern, handled by the linter (ADR-006). The linter validates structural patterns — for example, flagging a `maps-to` edge that does not connect two `Field` nodes — based on node template names and the graph structure, not on lists embedded in template definitions.

---

## Pack Loading and Resolution

The active packs are declared in `graph.yaml`. The MCP server loads them in declaration order and resolves `extends` chains after all packs are loaded — a template may extend a template from any other loaded pack. Template names must be unique across all loaded packs — conflicts are an explicit error, not silently resolved.

Pack `requires` declarations are validated on startup. If a required pack is not declared in `graph.yaml`, the MCP server emits a startup error.

**v1 resolution:**
1. Built-in packs (`core`, `rest`, `messaging`, `domain`, `design`, `event-storming`, `event-modelling`) ship with the MCP server
2. Local packs declared in `graph.yaml` with a `path` reference take precedence over built-ins of the same name
3. The default installation automatically loads `core + rest + messaging + domain`

**Future:** Remote packs as npm packages or Git URLs, resolved on first use and cached locally. Community packs distributed via a pack registry.

---

## Linter Responsibilities (full specification in ADR-006)

From this ADR, the linter must enforce:

- Every node's `template` resolves to a template in one of the loaded packs
- No node's `template` references an abstract template — abstract templates cannot be instantiated (**error**)
- Every node's `properties` block is valid against its template's JSON Schema property definition
- Unknown properties in a node file are a warning (not an error) to support forward compatibility
- The `Field` core template is present across all loaded packs
- No two loaded packs define a template with the same name
- Template `extends` references resolve to a template in the loaded packs
- Child templates do not narrow or remove parent required properties
- Edge type names in `edges.supports`, `edges.outgoing`, and `edges.incoming` declarations are from the core vocabulary (see ADR-004b)

---

## Consequences

**What becomes easier:**
- Teams adopt with zero configuration — the default installation loads `core + rest + messaging + domain` immediately
- Teams with non-standard stacks (GraphQL, event storming, event modelling) install exactly the packs they need — no unused templates
- The pack taxonomy maps to how teams already think about their architecture — REST, messaging, domain
- Packs are independently versioned — a `messaging` pack update does not require a `domain` pack update
- Community ecosystem naturally organises around the same taxonomy

**What becomes harder:**
- Teams managing cross-pack template dependencies must declare `requires` correctly
- Template name collisions across packs from different authors must be resolved by renaming

**What is newly possible:**
- A GraphQL team installs `core + graphql + messaging + domain` and gets full graph support with no REST templates cluttering their vocabulary
- An event storming session's output is captured as first-class `event-storming` nodes, then progressively refined into `domain` and `messaging` nodes with the trail preserved via edges
- The community can build and distribute methodology packs (`saga`, `cqrs`, `hexagonal`) following the same pack format

---

## Deferred: UI Component Bundling

The `components/` directory in the pack structure is reserved for purpose-built UI components that render and edit specific node types. An `APIEndpoint` with request/response schemas benefits from a custom editor that knows how to display nested schemas, field mapping slots, and status codes — beyond what generic rendering from `ui:` hints can provide.

The mechanism for declaring, loading, and consuming these components — including the component format, the contract between a component and the MCP server, and the hosted frontend's component registry — is deferred to a later ADR. That ADR depends on the frontend technology choice and the hosted commercial tier architecture (ADR-007), both of which are unsettled.

The `ui:` hints in each template are the v1 fallback. Generic rendering uses them to display any node type. When a purpose-built component is available in the `components/` directory, it overrides the generic renderer. The two-tier model (hints as fallback, components as enhancement) is intentional — the tool is usable from day one without any purpose-built components.

---

## Related

- ADR-002: Graph file format — node cluster files are instances of template schemas; the `template` field references a name in the loaded packs
- ADR-003: Graph loading — the MCP server loads and validates packs on startup before building the SQLite cache; node validation runs against template JSON Schemas
- ADR-003b: Core logical data model — templates extend the universal node properties; `Field` is the only core template
- ADR-004b: Edge type vocabulary and connection constraints — core edge types are defined in the tool; templates declare `edges.outgoing` and `edges.incoming` referencing those types; custom edge type extension is deferred
- ADR-005: MCP tool surface — tool signatures reference template names from the loaded packs
- ADR-006: Linter and validator — enforces template compliance on all node files and validates pack integrity
- PDR-001: Tool scope and node taxonomy — progressive enrichment philosophy; state and stability model
- PDR-003: Template packs and plugin architecture — product decisions implemented by this ADR



