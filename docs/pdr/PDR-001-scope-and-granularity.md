# PDR-001: Tool Scope, Granularity, and Node Taxonomy

**Status:** Accepted  
**Date:** 2026-04-12  
**Decider:** Product Owner  

---

## Problem Statement

The graph design tool needs a clear answer to three related questions before any node schema or UI work begins:

1. How deeply should it model software design artefacts — broad strokes only, or down to individual fields?
2. Should it be opinionated about architectural style (e.g. DDD, event-driven) or architecture-agnostic?
3. What is the minimum a team needs to define to get value, and what can be added progressively?

Without answering these, the tool risks being either too generic to reason about (a diagramming tool with no intelligence) or too opinionated to adopt (requires teams to retrofit their architecture to the tool's worldview).

---

## Context

The tool's primary value proposition is **branch-aware provenance of in-flight changes across service contracts**, with a secondary — and highly differentiated — capability of **contract drift detection**: identifying where API resources are not representative of the domain model (missing fields, renamed fields, flattened structures that lose semantic meaning).

Both of these require some degree of structured, typed knowledge about what nodes represent. A fully freeform graph cannot detect drift. A fully rigid taxonomy cannot accommodate the diversity of how engineering teams design systems.

The intended workflow is **AI-extracted, human-reviewed**: coding agents extract graph structure from existing codebases, propose changes, and humans review and correct. Humans are editors and approvers, not primary authors. This means:

- Extraction quality sets the floor for the entire experience
- The editing and review UX matters more than the authoring UX
- The graph must be useful even when partially populated

The tool is not tied to any specific design methodology. In particular, it deliberately does not adopt event modelling or DDD vocabulary as required concepts, as these remain niche practices. The spirit of progressive design — start with shapes, enrich with detail — is adopted without the orthodoxy.

---

## Options Considered

### Option A: Fixed, opinionated node taxonomy
Define a closed set of node types (`APIEndpoint`, `DomainOperation`, `DomainModel`, `Event`, `Command`, `ReadModel`, `Field`) with strict validation and required relationships. The tool enforces structural completeness before a lineage chain is considered valid.

- **Pros:** Maximum intelligence; agent reasoning is precise; drift detection is fully automatable; acceptance criteria generation is tractable
- **Cons:** Bets heavily on DDD/event-driven patterns; alienates CRUD-centric or REST-centric teams; commands are a foreign concept in many codebases; hard to evolve without breaking existing graphs
- **Effort:** High — upfront schema design is critical and expensive to change

---

### Option B: Fully generic graph (typed edges only)
Nodes are user-defined with arbitrary properties. Edge types carry the semantic weight. Teams define their own node types from scratch.

- **Pros:** Maximum flexibility; no architectural bets
- **Cons:** Tool cannot reason about the graph; agents receive no structural guidance; drift detection is impossible; effectively a diagramming tool with no intelligence ceiling
- **Effort:** Low to build, but fundamentally limited value

---

### Option C: Schema-centric primitives with a configuration-driven template system *(accepted)*
Define a minimal set of **semantic primitives** the tool always understands, and deliver **built-in templates** as pre-configured specialisations of those primitives. Teams use the defaults, customise them, or define their own. Each template describes its purpose via an `agent` metadata section that the tool's intelligence layer reasons about.

- **Pros:** Intelligence is anchored to template definitions and agent metadata regardless of team vocabulary; built-in templates handle the 80% case immediately; extensibility handles diverse architectural styles; progressive enrichment is a first-class concept; no methodology imposed
- **Cons:** Requires careful primitive design upfront; the `agent` metadata section must be well-authored to give the tool meaningful context
- **Effort:** Medium upfront; significantly lower cost of future evolution than Option A

---

### Option D: Do nothing — build one opinionated slice first
Defer the generality question. Build the specific chain described (API → Operation → Event → Model) deeply and validate usefulness before designing extensibility.

- **Pros:** Fastest to feedback; avoids over-engineering flexibility nobody has asked for
- **Cons:** High risk of architectural lock-in; retrofitting a template system later is a significant rewrite
- **Effort:** Low initially, high total cost if Option C is the eventual destination

---

## Decision

**Chosen option: Option C — schema-centric primitives with a configuration-driven template system**

Execution strategy: build the default template pack first (the Option D slice), but on top of the Option C primitive and template architecture from day one. The generality costs very little if the primitive design is done on paper before implementation begins.

### Semantic primitives

The tool's intelligence layer reasons about three universal primitives regardless of team taxonomy:

| Primitive | Description |
|---|---|
| **Node** | A named schema or schema fragment, with a declared type (from a template), user-defined properties, a state, and a stability level |
| **Edge** | A typed, directional relationship between nodes, carrying optional field-level mapping data |
| **Context** | The branch, epic, feature flag, or design session a node or edge belongs to |

Every node declares its purpose via its template name and the template's `agent` metadata section. The tool's drift detection, lineage validation, and agent reasoning operate directly on node type names and template definitions — no additional abstraction layer is required. A team that calls their contract boundary a `ServiceContract` configures the `agent` metadata section to describe its purpose, and the tool reasons from that description.

### Default template pack

The tool ships with a default template pack covering the standard web service pattern:

| Template | Core | Notes |
|---|---|---|
| `Field` | Yes | Core template — load-bearing for lineage and drift detection |
| `APIEndpoint` | No | URI, HTTP method, description; schema property links to request/response schema nodes |
| `IntegrationEvent` | No | Crosses service boundaries; part of the external contract surface |
| `DomainOperation` | No | Name, description, acceptance criteria |
| `DomainModel` | No | Fields collection, operations collection |
| `DomainEvent` | No | Internal fact; published when an operation succeeds |
| `ReadModel` | No | Derived from domain model or events; response fields mapped here |
| `UserJourney` | No | Journey definition; steps and participating components |
| `Command` | No | Optional; use when teams want to distinguish intent from HTTP transport |

**No node type is required.** A valid graph can consist of two named boxes with a single edge between them. Completeness is surfaced as a signal, not enforced as a gate.

### Commands are optional

In many systems the API is the command. Requiring a `Command` node in the lineage chain would impose a DDD-style separation that does not reflect how REST-centric or CRUD-heavy teams design software. `Command` is available as a template for teams who want it; it is never required to complete a valid lineage chain. An `APIEndpoint` may link directly to a `DomainOperation` or `DomainModel`.

### Design layer and derived layer

Every node exists in one or both of two layers:

**Design layer** — intent. Created and edited by agents and humans. Represents what the team is designing, has designed, or intends to build. Always speculative relative to the codebase.

**Derived layer** — reality. Extracted automatically from merged code. Read-only. Represents what actually exists in the codebase at the time of the last extraction.

A node has a single identity across both layers. Drift is where the derived layer diverges from the design layer. The tool surfaces this divergence as a signal — it does not resolve it automatically.

### Node states

Every node in the design layer carries a state. The tool surfaces state as a signal to humans and agents but does not enforce behaviour based on it — how teams and agents respond to state is their judgement.

| State | Layer | Meaning |
|---|---|---|
| `draft` | Design | Uncertain or incomplete — a human or agent has flagged this needs more thought before it can be acted on |
| `proposed` | Design | Default working state — coherent enough to be visible, discussed, and built against |
| `agreed` | Design | Consciously signed off — represents stable design intent |
| `future` | Design | Intentionally deferred — known but not in current scope |
| `removed` | Design | Existed and was deliberately retired — history and lineage preserved; never hard deleted |
| `implemented` | Derived | Exists in merged code — set by extraction, never set manually |

`proposed` is the default state when a node is created or extracted. A node in the derived layer with no corresponding design layer node is implicitly `implemented` with no design intent recorded.

Every node carries a `stability` level — `unstable` (default), `stable`, or `deprecated` — that modulates how the tool signals drift and breaking changes. Teams set stability when they are ready; the default of `unstable` means no contract protection overhead during early development. See PDR-005 for the full stability model.

Every node carries a `materialised` flag. Once a node has ever existed in the derived layer, `materialised` is set to `true` permanently — it does not revert if the code is later deleted. This flag is the threshold at which soft delete records, rename trails, and drift reconciliation signals become meaningful. Nodes that have never been materialised are pure design work and can be freely edited without trails.

---

## Consequences

**What becomes easier:**
- Teams can start with two boxes and a line and get value immediately
- The tool can reason about drift and lineage without requiring full graph completion
- Template packs can be published and shared across teams or organisations
- Agents can extract at any level of detail without invalidating the graph — nodes at any state are valid
- The tool is not tied to DDD, event-driven, or any other methodology

**What becomes harder:**
- The `agent` metadata section of each template must be designed carefully — it is the primary mechanism by which the tool's intelligence understands node purpose
- Template pack authoring requires enough clarity in the `agent` section to give the tool and agents meaningful context

**What is newly possible:**
- Teams define custom template packs that match their actual architectural vocabulary
- Drift detection operates across any node types the team defines — the template structure and agent metadata provide the context the tool needs
- Acceptance criteria can be generated against any node whose template declares it as an operation type via agent metadata
- Multiple template packs can coexist in a single graph for heterogeneous architectures

---

## Success Criteria

- A team with no prior knowledge of the tool can create a meaningful two-node graph in under five minutes
- A team using a non-default template pack (custom node type names) receives equivalent drift detection to a team using the default pack
- An agent extracting from a real codebase can populate nodes to `proposed` state without human intervention for at least 70% of nodes
- Field-level lineage between an `APIEndpoint` response schema and a `DomainModel` can be populated and queried without requiring all intermediate nodes to be present
- Drift detection correctly identifies at least one renamed or missing field in a representative test codebase

---

## Follow-on Decisions Required

- **PDR-002:** Adoption model and deployment tiers — established
- **PDR-003:** Template packs and plugin architecture — established
- **PDR-004:** Agent and MCP interface — established
- **PDR-005:** Deletions, renames, and semantic collision detection — established
- **PDR-006:** Human review and editing experience — established
- **PDR-007:** Derived layer integrity and branch model — established
- **ADR:** Node schema design should reflect the state model, dual-layer distinction, materialised flag, and stability level defined here

---

## Related

- Vision and brief chat — establishes the contract drift detection use case and AI-extracted / human-reviewed workflow
- ADR chat — storage mechanism, merge gate implementation, derived layer contract schema, and branch naming conventions are the primary ADRs to write next
