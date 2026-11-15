# PDR-003: Template Packs, Node Types, and Plugin Architecture

**Status:** Accepted  
**Date:** 2026-04-12  
**Decider:** Product Owner

---

## Problem Statement

The tool needs a model for how node types are defined, configured, and extended by teams. Specifically:

1. How are node types defined and what do they contain?
2. How does the tool maintain intelligence (drift detection, lineage, agent reasoning) across different team vocabularies?
3. How do views and output formats — such as a journey view or an OpenAPI export — relate to node types?
4. Where do primitive concepts like fields sit relative to the template system?

---

## Context

PDR-001 established that the tool has a small set of semantic primitives (node, edge, context). The tool's intelligence operates on node type names and template definitions — specifically the `agent` metadata section of each template, which describes the node type's purpose to the tool and to agents.

PDR-001 also established a default set of node types for the standard web service pattern. What was not decided is how those node types are defined, where they live, and how the system stays extensible without losing intelligence.

The tool targets a single shared design repo as the primary deployment model (PDR-002). Template packs are therefore repo-level configuration — one pack per design repo, authored by the team when they set up the repo, changed rarely thereafter.

The tool is intended to be open source with a community ecosystem deferred to a later phase. Cross-repo template sharing is a future concern. Copy-paste is an acceptable bridge for now.

---

## Key Concepts Established During Exploration

### All node types are templates

The tool has no hardcoded node types. It only has primitives (node, edge, context) and the semantic role system. Every node type — including those in the default pack — is a template. This means:

- The tool is testable with zero templates; untyped nodes with edges form a valid graph
- The default pack is a curated set of templates that ships with the tool, not special-cased behaviour
- Teams can add, customise, or replace any non-core template without losing tool intelligence

### Core templates vs. standard templates

Some templates are load-bearing — the tool's intelligence depends on them existing in a predictable shape. These are marked `core: true` and cannot be removed, only extended. All other templates are standard and fully replaceable.

`Field` is the primary example of a core template. Drift detection, field-level lineage, and the mapping system all depend on fields being addressable and queryable regardless of template pack configuration. Field is therefore both a semantic primitive and a template — the primitive guarantees the tool can always reason about fields; the template gives teams a customisable surface.

The general principle: **some primitives ship with a default core template. The primitive defines the minimum the tool needs to reason. The template defines what teams configure.**

### Templates are cohesive units

A template is a single configuration unit containing everything needed to define a node type. UI representation is included as optional hints with sensible defaults — teams should not need to configure UI to get started, but can customise it when needed.

### Plugins target node types, not semantic roles

View and output plugins declare dependencies on specific node type names from the template pack. A journey view plugin declares it needs `UserJourney` nodes. An OpenAPI output plugin declares it needs `APIEndpoint` nodes and their associated schema nodes. The tool validates that all node types a plugin depends on are present in the active template pack and warns if any are missing.

Node type names are explicit, readable, and unambiguous as plugin targets. The tool's intelligence — drift detection, lineage validation, agent reasoning — operates directly on node type names and template definitions without an additional abstraction layer.

---

## Options Considered

### Option A: Hardcoded node types with a configuration layer
The tool ships with a fixed set of node types. Teams configure properties and UI but cannot add or remove types.

- **Pros:** Simple to implement; consistent behaviour across all teams; no risk of misconfigured templates breaking tool intelligence
- **Cons:** Cannot accommodate teams with different architectural vocabularies; blocks community ecosystem; contradicts the extensibility goal established in PDR-001
- **Effort:** Low initially, high cost when extension requests arrive
- **Fit:** Poor — directly contradicts PDR-001 decisions

---

### Option B: Fully freeform node types with no semantic layer
Teams define node types with arbitrary properties. No semantic roles. The tool treats all nodes equally.

- **Pros:** Maximum flexibility; no constraints on team vocabulary
- **Cons:** Tool cannot reason about the graph; drift detection, lineage, and agent reasoning are impossible; reduces the tool to a diagramming tool
- **Effort:** Low
- **Fit:** Poor — abandons the core value proposition

---

### Option C: Template pack system with semantic roles and a plugin architecture *(accepted)*
All node types are defined as templates in a repo-level template pack. Each template describes its purpose via the `agent` metadata section. The tool ships a default template pack as a curated set. Teams customise the pack when setting up the repo. A separate plugin system for views and output formats targets node type names directly.

- **Pros:** Teams use their own vocabulary without losing tool intelligence; default pack provides immediate value with no configuration; plugin system targets node type names directly — explicit and readable; community ecosystem is a natural future extension
- **Cons:** The `agent` metadata section must be well-authored to give the tool and agents meaningful context — this is the primary configuration responsibility for teams
- **Effort:** Medium — template pack format and plugin interface must be designed carefully as they are extensibility contracts
- **Fit:** Strong

---

## Decision

**Chosen option: Option C — template pack system with semantic roles and a plugin architecture**

### What a template contains

Each template defines a single node type and contains:

| Section | Description | Required |
|---|---|---|
| `name` | Display name of the node type | Yes |
| `core` | Whether this template is load-bearing and cannot be removed | No (default: false) |
| `properties` | Schema definition — property names, types, descriptions, required flags | Yes |
| `edges` | Valid outbound edge types from this node type, with target role constraints | No |
| `ui` | Display hints — icon, colour, prominent properties | No |
| `agent` | Metadata for agent reasoning — which properties are agent-writable, description of the node type's purpose for agent context | No |

### Edge type definitions

Edge types are defined within the template that owns the outbound edge. An edge type declaration includes the edge name, a description, and a constraint on the valid target node types. This gives agents and the tool a vocabulary of valid connections without requiring plugins or teams to understand the role system.

Example: a `DomainOperation` template declares an outbound edge type `publishes` targeting `DomainEvent` or `IntegrationEvent` nodes. Teams that rename these types update their edge declarations accordingly.

### Default template pack

The tool ships with the following default templates:

| Template | Core | Notes |
|---|---|---|
| `Field` | Yes | Core template — load-bearing for lineage and drift detection |
| `APIEndpoint` | No | External contract boundary; URI, method, request/response schema |
| `IntegrationEvent` | No | External contract boundary; crosses service boundaries |
| `DomainOperation` | No | Internal behaviour unit; acceptance criteria, name, description |
| `DomainModel` | No | Internal schema; fields and operations |
| `DomainEvent` | No | Internal fact; published when an operation succeeds |
| `ReadModel` | No | Derived schema; projected from domain model or events |
| `UserJourney` | No | Journey definition; steps and participating components |
| `Command` | No | Optional; explicit intent separate from HTTP transport |

`Field` is the only core template. All others can be customised or replaced. `Command` is included but optional — teams that do not use it are not required to include it in their lineage chains.

`IntegrationEvent` and `DomainEvent` are distinct templates. Integration events cross service boundaries and are part of the contract surface; domain events are internal facts. This distinction is expressed via the `agent` metadata section of each template, giving agents and the tool the context needed to treat them differently for drift detection and reasoning.

### Plugin architecture

Two plugin types are defined:

**View plugins** render the graph or a subset of it in a specific layout within the UI. The journey view — swim lanes for components, columns for journey steps — is the primary example. View plugins declare which node types they require by name and receive the relevant subgraph to render.

**Output plugins** export graph data into external formats. OpenAPI spec generation is the primary example — it reads all `APIEndpoint` nodes and their associated schema nodes and produces a spec file. Output plugins also declare node type dependencies by name.

Plugins do not modify graph data. They are read-only consumers of the graph. The tool validates plugin dependencies against the active template pack at startup and warns if a required node type is missing. Template packs do not reference plugins — the dependency runs in the other direction only.

### UI representation

UI hints in the template are optional. The tool provides sensible defaults (derived from the semantic role) when no UI section is present. Teams configure UI when they want to — not as a prerequisite to getting started. A richer UI plugin system for custom node rendering is a future concern and does not need to be solved in the template pack format.

### Template pack evolution and change management

Template packs are expected to be stable once established. When a template changes — a property is added, renamed, or removed — existing nodes defined against the previous template shape are flagged with a `schema-drift` warning. Resolution is manual: the tool surfaces which nodes are affected and what has changed, but does not attempt automated migration. This is consistent with the human-review model established in PDR-001 and PDR-002.

---

## Consequences

**What becomes easier:**
- Teams adopt the tool immediately using the default pack with no configuration required
- Teams with non-standard vocabularies get full tool intelligence by customising template names without changing semantic roles
- New view and output plugins can be added without modifying existing template packs
- The community ecosystem path is clear — template packs are self-contained and shareable

**What becomes harder:**
- Teams authoring custom templates must write clear `agent` metadata sections — this is the primary configuration responsibility and the quality of tool intelligence depends on it
- Core templates (Field) cannot be removed — teams that want radically different field semantics must extend rather than replace

**What is newly possible:**
- OpenAPI spec, AsyncAPI spec, and other output formats can be generated directly from the graph without additional data entry
- Journey views and other specialised layouts are first-class features, not workarounds
- Template packs can be versioned, committed to the repo, and reviewed in PRs like any other configuration

---

## Success Criteria

- A team can adopt the default template pack and create a meaningful graph with no template configuration
- A team that renames `APIEndpoint` to `ServiceContract` and configures the `agent` metadata section equivalently receives identical drift detection and agent reasoning
- An OpenAPI spec can be generated from a graph populated using only the default template pack with no additional data entry beyond what the template already requires
- When a template property is renamed, all affected nodes are surfaced to the team within one tool invocation
- A view plugin and an output plugin can be added to the tool without modifying any template pack, provided the node types they depend on are present in the active pack
- The tool warns at startup if a plugin declares a dependency on a node type that is not defined in the active template pack

---

## Follow-on Decisions Required

- **PDR-004:** Local tool process model and developer experience — how the tool is installed, invoked, and run
- **PDR-005:** Agent and MCP interface — how agents read and write nodes, how the `agent` section of a template is exposed, how `instruction` and `question` threads are surfaced to agents
- **ADR:** Template pack file format — the specific schema and file structure used to define templates in the repo
- **ADR:** Plugin interface contract — how view and output plugins are registered, what API they consume, and how they declare role dependencies

---

## Related

- PDR-001 — establishes semantic primitives, semantic roles, and progressive enrichment model that template packs build on
- PDR-002 — establishes single shared design repo as primary deployment model; template pack is repo-level config
