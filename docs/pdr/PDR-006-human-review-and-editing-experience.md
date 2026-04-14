# PDR-006: Human Review and Editing Experience

**Status:** Accepted  
**Date:** 2026-04-12  
**Decider:** Product Owner

---

## Problem Statement

The tool's primary human-facing experience needs to be defined. Specifically:

1. What form does the human interface take and where does it live?
2. How does a human navigate and review a graph that has no canonical starting point or prescribed design workflow?
3. How are signals — drift, threads, collision flags, state, stability warnings — surfaced without overwhelming?
4. How does the human editing experience work given agents are the primary authors?
5. How does the agent presentation layer relate to the human interface?

---

## Context

PDR-001 established that the editing and review UX matters more than the authoring UX — humans are editors and reviewers, not primary authors. Human review is optional and asynchronous; proposals become real when implemented in code, not when approved in the graph.

PDR-002 established that discussion threads are typed (`discussion`, `instruction`, `question`, `reasoning-trace`) and that the primary interaction pattern is asynchronous review, not real-time collaboration.

PDR-003 established that view plugins and output plugins are separate from the template pack and that the plugin architecture enables specialised views per node type and custom workflows.

PDR-004 established that agents have full write access to the design layer and that the agent presentation layer should be consistent with the human interface for thread management and review.

PDR-005 established signals that need surfacing: drift, collision flags, rename trails, reconciliation flags, stability warnings, and open threads by type.

A key constraint: the tool operates primarily at Tier 1 and Tier 2 with zero infrastructure. There is no user account system or server-side preference store. Personalisation as a feature is therefore not viable at the primary tiers and is not a goal.

Design workflows vary significantly across teams and even across features within a team. A team might start by designing the domain model, then extract events and APIs. Another might start with APIs and work inward. Another might begin with a journey view and progressively enrich each step. The UX must facilitate all of these equally without privileging any particular starting point.

---

## Options Considered

### Option A: Graph canvas as the primary interface
A visual node-and-edge canvas where humans navigate the graph spatially. Nodes are positioned on a 2D surface; relationships are visible as drawn edges.

- **Pros:** Familiar to users of tools like Miro or Lucidchart; relationships are visually immediate; good for high-level orientation
- **Cons:** Too abstract for detailed review work — a field-level drift flag on a node is nearly invisible at canvas zoom; doesn't scale to large graphs; poor fit for the thread and signal review workflow; no natural home for structured node properties
- **Effort:** High
- **Fit:** Poor as the primary interface — useful as a plugin view for orientation, not as the review surface

---

### Option B: List-based signal feed
A flat or grouped list of signals requiring attention — drift flags, open threads, collision alerts — as the primary interface. Humans work through the list, clicking into individual signals to resolve them.

- **Pros:** Optimises directly for the review workflow; nothing to navigate; clear prioritisation
- **Cons:** Loses the context of the node being reviewed; hard to understand a drift flag without seeing the full node; no support for exploratory browsing or human-led design
- **Effort:** Low-medium
- **Fit:** Partial — right for signal triage but insufficient as the complete experience

---

### Option C: Node-type-aware perspectives with branch-scoped signal entry *(accepted)*
A web UI built around **perspectives** — structured, node-type-specific views that present a node's properties, schema, relationships, and signals in a layout appropriate to that node type. A branch-scoped signal feed serves as the entry point, directing humans to the perspectives that need attention. Navigation between related perspectives replaces graph traversal.

- **Pros:** Review happens in context — a human sees the full node when reviewing a signal on it; design workflows have no prescribed starting point; branch scoping replaces personalisation without requiring infrastructure; the plugin architecture enables custom perspectives and entry points; consistent with the agent presentation layer
- **Cons:** Perspective design requires investment per node type in the default template pack; the branch-scoped entry point must be carefully designed to avoid becoming its own source of noise
- **Effort:** Medium-high for the initial perspective set; incrementally lower for subsequent node types
- **Fit:** Strong

---

## Decision

**Chosen option: Option C — node-type-aware perspectives with branch-scoped signal entry**

### The web UI as the primary surface

The human interface is a local web UI served by the MCP server process. It requires no hosted infrastructure — consistent with the Tier 1 and Tier 2 deployment model. IDE plugins and CLI enhancements are explicitly deferred as future additions; the web UI is the definitive experience.

### Perspectives

A perspective is the central interaction unit. Each node type in the template pack has a corresponding perspective that presents:

- **Node properties** in a structured, readable layout appropriate to the node type — an `APIEndpoint` perspective shows URI, method, description, and status codes as a clean endpoint definition; a `DomainModel` perspective shows fields as a structured table with types, descriptions, and lineage indicators
- **Related node data inline** where relevant — schema nodes are shown as field tables within the perspective, not as separate navigation targets; a field's lineage is expandable in place without leaving the perspective
- **Relationship and mapping data overlaid contextually** — field lineage mappings are shown alongside the fields they apply to; edges to related nodes are shown as navigable links within the perspective rather than as abstract graph connections
- **Signals embedded in context** — a drifted field is highlighted within the fields table; an open thread on a property appears inline next to that property; a collision flag on a field is visible at the field level, not in a separate panel

Perspectives support **progressive disclosure** — related node data expands in place on demand. A reviewer drilling into a field mapping can expand the linked domain model field, see its lineage, view its thread history, and collapse back without losing their place. This mirrors how a developer reads code rather than how they use a graph tool.

### Navigation

Perspectives form the top-level and sub-level navigation of the web UI. The primary navigation groups perspectives by node type — APIs, Domain Models, Events, Read Models, and so on — matching the template pack's node types. Teams using custom template packs see their own node type names in navigation.

Navigation between related nodes within a perspective is explicit and direct — "view domain model", "view publishing event", "view field lineage" as clear labelled actions rather than unlabelled graph edges. The human always knows where they are and where they are going.

A **search interface** over the full graph serves as a workflow-neutral entry point for teams that prefer to navigate by finding rather than browsing. Queries can be expressed naturally — "show me all proposed API endpoints", "find all fields named customerId across all node types", "show open questions in the checkout branch". The in-memory graph built by the MCP server makes this possible without a dedicated search infrastructure.

### Branch-aware viewing

Branch context is the primary scoping dimension for the human experience. Three viewing modes are available:

**Single branch view** — the graph as it exists in one branch. Perspectives show the node in that branch context, with drift from main highlighted. Proposed changes are front and centre. This is the primary mode for a developer working on a feature.

**Consolidated view** — the full graph with all in-flight branch changes overlaid simultaneously. Where multiple branches touch the same node, both versions are visible side by side. Collision flags surface naturally in this view. This is the mode for understanding the full team picture.

**Selected branches view** — a user-composed subset of branches shown together. Useful for reviewing related features or understanding how two in-flight branches interact before either is merged.

Branch selection is available at the entry point and persists as a filter across the session. Switching branch context updates all perspectives and the signal feed simultaneously.

This is a direct consequence of the git-native in-memory graph established in PDR-002 — building the graph from all branches simultaneously makes multi-branch views possible without additional infrastructure.

### Signal entry point

The landing experience is a **branch-scoped signal feed** — not a global dashboard of everything, but a prioritised view of what needs attention within the current branch context. Signals are grouped and prioritised:

| Priority | Signal type | Description |
|---|---|---|
| 1 | Open `question` threads | Agent is blocked waiting for human input |
| 2 | Collision flags | Structurally equivalent fields across branches |
| 3 | Reconciliation flags | Nodes present in design but absent from derived layer, or vice versa |
| 4 | Open `instruction` threads | Human directives not yet actioned by agent |
| 5 | Drift signals | Design layer diverges from derived layer on materialised nodes |
| 6 | Open `discussion` threads | Active conversations without resolution |
| 7 | Stability warnings | Breaking changes on `stable` nodes |

Each signal links directly to the relevant perspective at the relevant field or property, with the signal expanded in context. The human lands on the node with full context, not on a decontextualised alert.

### Warnings

Warnings are a distinct signal tier from the actionable signal feed. They are the output of continuous graph analysis — observations about potential problems or inconsistencies that inform judgement but do not necessarily require immediate action. Examples include schema drift between an API response and its domain model, similar-named fields across node types that may represent the same concept, lineage gaps, operations without acceptance criteria, and `stable` nodes with no derived layer counterpart.

Warnings are computed and optionally cached — not persisted as graph state. They are recomputed when the underlying nodes change. Warning severity is modulated by the stability level of the affected node — the same drift warning carries higher severity on a `stable` node than an `unstable` one.

The UI treats warnings as a quality sweep tool rather than an actionable queue. Warnings appear as a background layer on perspectives — a subtle indicator on affected fields or properties, with detail available on demand. A dedicated warnings view allows filtering and sorting by type, severity, and node type for deliberate quality reviews. Warning suppression with recorded reasons is a future concern.

### Thread interaction within perspectives

Threads attach at the field level within perspectives, not only at the node level. A reviewer can comment on a specific field mapping, a specific property value, or a specific drift flag in the same way a developer comments on a specific line in a code review. Thread types are visually distinguished — `question` threads that are blocking agent work are surfaced prominently; `reasoning-trace` threads are available but visually secondary.

Responding to a thread, resolving a discussion, or actioning an instruction are all inline interactions within the perspective — no modal, no separate thread management UI.

### Human editing

Human-led design is supported but not optimised. A human can create, edit, and update nodes directly within a perspective without agent involvement. Rename is surfaced as a distinct operation — not a property field edit — to enforce the first-class rename model established in PDR-005. The distinction is clear: editing a property value is one interaction; renaming a node or field is a separate, explicitly labelled action that carries the rename trail forward.

State transitions (`draft` → `proposed` → `agreed`, etc.) are available as explicit actions within the perspective, not as editable text fields. This reduces the risk of accidental state changes and makes the available transitions clear.

### Agent presentation layer

When an agent presents a node or analysis result during an MCP session, it uses the same perspective model as the web UI. The presentation is structured, node-type-aware, and thread-enabled — a human reviewing an agent's output in their agent interface sees the same layout they would see in the web UI, with threads attached at the same level of granularity. This consistency is essential for the commenting and feedback workflow — humans should not need to switch to the web UI to leave a meaningful thread on an agent's proposal.

### Plugin architecture and workflow flexibility

The perspective system is extensible via the plugin architecture established in PDR-003. View plugins can introduce new perspectives, new entry points, and new navigation structures. A team working event-first can load a journey view plugin that becomes their primary entry point. A team working API-first uses the default API perspectives as their starting point. The tool does not prescribe a design workflow — it provides perspectives and lets teams navigate in the order that suits their process.

Custom perspectives introduced by view plugins follow the same conventions as default perspectives: branch-aware, signal-embedded, thread-enabled, and progressively disclosable.

---

## Consequences

**What becomes easier:**
- Humans review signals in the full context of the node rather than as decontextualised alerts
- Branch scoping makes the signal feed manageable without requiring personalisation infrastructure
- No prescribed design workflow — teams start wherever they have something to design
- The agent presentation layer and web UI share a consistent model — no context switching for thread management
- Plugin architecture means teams can introduce new workflows without core tool changes

**What becomes harder:**
- Each node type in the default template pack requires a well-designed perspective — this is design and implementation investment per node type
- The branch-scoped signal feed must be carefully tuned — too many signals at once defeats the purpose of scoping
- Progressive disclosure within perspectives requires thoughtful interaction design to avoid perspectives becoming unwieldy as nodes accumulate relationships

**What is newly possible:**
- A human can review a drift flag, understand the full lineage context, respond to the relevant thread, and update node state without leaving a single perspective
- Multi-branch consolidated views surface collision flags that would otherwise require manual cross-branch comparison
- Teams using the tool event-first, API-first, or domain-model-first all get an equally coherent experience

---

## Success Criteria

- A human can open the tool, see the branch-scoped signal feed, navigate to a flagged node, understand the drift or collision in context, and leave a thread response in under two minutes
- A `question` thread blocking agent work is visible at priority 1 in the signal feed and resolvable inline without leaving the perspective
- Switching between single branch, consolidated, and selected branch views updates all perspectives and the signal feed within one second
- A human performing a rename correctly triggers the first-class rename operation rather than a property edit — the distinction is clear from the UI
- A view plugin introducing a new entry point and perspective type integrates into the navigation structure without requiring changes to the core web UI
- A human reviewing an agent-presented perspective in their agent interface sees the same layout and thread attachment points as the web UI

---

## Follow-on Decisions Required

- **PDR-007:** Extraction workflow — how and when the derived layer is populated, and how extraction results are surfaced to humans in the review experience
- **ADR:** Web UI technology stack — framework, local serving model, and how the UI consumes the MCP server graph API
- **ADR:** Perspective schema — how perspectives are defined in the template pack and what the plugin interface for custom perspectives looks like
- **ADR:** Signal feed implementation — how signals are computed, ranked, and kept current as the in-memory graph changes

---

## Related

- PDR-001 — node states, stability levels, and the materialised flag all surface as signals within perspectives
- PDR-002 — git-native in-memory graph built from all branches simultaneously enables multi-branch viewing without infrastructure
- PDR-003 — plugin architecture and template `ui` section provide the extensibility model for custom perspectives
- PDR-004 — agent presentation layer consistency requirement and thread types established here
- PDR-005 — drift, collision, rename, and reconciliation signals defined here are the primary signal types surfaced in the entry point feed
