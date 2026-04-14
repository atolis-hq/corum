# ADR-005: MCP Interface Design

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-001 (Storage and Interaction Architecture), ADR-003b (Core Logical Data Model), ADR-004 (Template Pack Format), ADR-004b (Edge Type Vocabulary)  
**Related:** ADR-006 (Linter and Validator)  
**Implements:** PDR-004 (Agent and MCP Interface)

---

## Context and Problem Statement

ADR-001 established two valid interaction paths with the graph: direct file access and the MCP server. The MCP server must justify its existence over direct file access — it must provide equal or greater semantic value than reading YAML files directly, while also enabling queries that files alone cannot answer.

This ADR makes four design decisions that together define the character of the MCP interface:

1. **Response unit** — what shape does a response take?
2. **Query filter model** — how do agents express what they want?
3. **Branch scope** — how do agents reason across branches?
4. **Analysis placement** — where do drift detection and conflict analysis live?

The specific tool catalogue — which tools exist, their exact signatures — is an implementation concern documented separately (see Reference: MCP Tool Catalogue). This ADR decides the principles those tools are built on.

---

## The Core Requirement: Equal or Greater Value Than Files

An agent can already read the graph by cloning the repo and reading YAML files directly. The MCP interface only earns its place if its responses are at least as semantically rich as the cluster files, and additionally provide things files cannot:

**What files provide in a single read:**
- A root node with all its owned children — an `APIEndpoint` with its request schema, response schemas, all their fields with types, cardinalities, and nullability

**What files cannot provide without assembly:**
- Edges declared in separate edge files
- Field-level mappings across schema boundaries
- Drift status against the derived layer
- Open threads attached to the node or its fields
- In-flight versions on other branches

The MCP interface must provide cluster-level semantic richness (matching files) plus assembled context (exceeding files). If it returns generic graph nodes without owned children, direct file access wins — agents will bypass MCP entirely.

---

## Decision 1: Response Unit

### Option A: Graph nodes

Responses return individual node objects from the graph model. A `Field` is a separate response from its parent `DomainModel`. Agents assemble meaning from parts.

**Pros:** Consistent with the internal graph model; small, predictable response sizes  
**Cons:** Loses the semantic cluster structure that gives nodes their meaning; an agent receiving a `Field` without its parent schema has no useful context; direct file access is strictly better  
**Verdict:** Disqualified — fails the core requirement

---

### Option B: Cluster documents

Responses map to cluster files. An `APIEndpoint` response includes the endpoint's flat properties, its request schema with all fields, and its response schemas with all fields. Owned children are always included inline. Edge-declared relationships are referenced by ID but not inlined.

**Pros:** Matches the semantic unit humans and agents naturally reason about; response is self-contained and meaningful without additional calls; equals the richness of reading the cluster file directly  
**Cons:** Edge context (what does this endpoint connect to?) requires a follow-up call; analysis overlays (drift, threads) are separate  
**Verdict:** The minimum viable response shape — preserves semantic meaning

---

### Option C: Fully assembled semantic object

Responses include the cluster document plus all connected edges with their field mappings, plus drift status, thread summary, and branch provenance. One call, maximum context.

**Pros:** Agents rarely need follow-up calls; maximum reasoning quality  
**Cons:** Response payloads are large even when the agent only needs part of the information; slow for high-frequency queries; analysis results mixed with facts  
**Verdict:** Good intent, wrong granularity

---

### Option D: Layered cluster — core plus overlay summary (selected)

Responses always include the full cluster document (Option B). Additionally, a lightweight overlay summary is included: thread count and status, a drift flag (boolean — is this node drifting from the derived layer?), and the list of branches where this node has an in-flight version. Full overlay detail is fetched via dedicated tools when the agent needs it.

**Pros:**
- Matches or exceeds the richness of reading the cluster file directly
- Agents have enough context in one call to decide whether to investigate overlays
- Core facts and analysis are structurally separate within the response
- Overlay detail calls are cheap because they are infrequent

**Cons:** Two response shapes to maintain (cluster + overlay summary vs overlay detail)  
**Verdict:** Correct balance — semantic richness without always paying for full analysis

---

### Decision: Option D — layered cluster response

Every response includes:

**Core cluster** (always):
- Root node universal properties (id, template, state, stability, name, description, extractedFrom, lastModifiedAt)
- Template-specific flat properties
- All owned nodes inline (fields with type/nullable/cardinality, enum definitions with values, invariants, operations)
- Direct edges (outbound and inbound) with their field mappings — not just IDs, the full edge including field mapping detail

**Overlay summary** (always, lightweight):
- `threadCount`: number of open threads on this node or its owned nodes
- `drifting`: boolean — does the derived layer differ from this node?
- `inFlightBranches`: list of branch names where this node has an in-flight version

**Overlay detail** (on request, via dedicated tools):
- Full thread list with body text and history
- Full drift report for this node
- Per-branch node state

---

## Decision 2: Query Filter Model

### Option A: Typed parameters

Each query tool has explicit typed parameters: `template`, `state`, `stability`, `namespace`. Simple to implement; predictable; fails when agents need compound or novel filter combinations.

### Option B: Filter object

A single `filter` parameter accepts a structured object:

```json
{
  "template": "APIEndpoint",
  "state": ["proposed", "agreed"],
  "namespace": "orders",
  "inFlight": true
}
```

All fields are optional and combinable. New filter dimensions are added to the object schema without breaking existing calls.

### Option C: Query language

A string-based query language (e.g. `template:APIEndpoint state:agreed namespace:orders`). Flexible but requires parser implementation and documentation.

### Decision: Option B — filter object (selected)

The filter object is extensible without breaking changes, handles compound conditions naturally, and is straightforward to implement. A query language is premature — Option B covers all identified use cases. Typed parameters lock the interface to today's known dimensions.

**Standard filter fields:**
- `template` — template name or list of names
- `state` — state value or list
- `stability` — stability value or list
- `namespace` — logical namespace (maps to component directory; the term `namespace` is preferred over `component` as it is semantic rather than structural)
- `inFlight` — boolean; if true, only nodes with in-flight versions on any open branch
- `drifting` — boolean; if true, only nodes where the derived layer diverges

---

## Decision 3: Branch Scope

### Option A: Single branch per call

Every tool accepts an optional `branch` parameter. When omitted, main is used. Agents make separate calls per branch.

**Pros:** Simple; predictable payload size  
**Cons:** Comparing a node across three branches requires three calls and manual merging in the agent; loses the cross-branch awareness that is the tool's core value proposition

### Option B: Multi-branch scope per call

Tools accept a `branches` parameter accepting a list. The response includes one version of the requested data per branch, with conflicts flagged inline.

**Pros:** One call to see a node across all in-flight branches; directly supports the cross-branch awareness use case  
**Cons:** Response payloads grow with branch count; implementation is more complex

### Option C: Session-level branch context

The MCP session is initialised with a branch scope. All calls within the session operate on that scope without specifying branches per call.

**Pros:** Clean call signatures; no repetition  
**Cons:** Inflexible when an agent needs to compare branches mid-session; requires session state management

### Decision: Option B — multi-branch scope (selected)

The primary differentiating capability of the tool is branch-aware provenance. A single-branch interface underserves this. Agents frequently need to answer "what does this look like across all in-flight work?" and that requires multi-branch responses.

**Implementation:** The `branches` parameter accepts a list of branch refs. When provided, the response includes a `branchVersions` array — one entry per branch — each containing the cluster document as it exists on that branch. The primary (main) version is always included as the baseline. Conflicts between branch versions are flagged in the overlay summary.

When `branches` is omitted, the response reflects main only.

---

## Decision 4: Analysis Placement

Drift detection and branch conflict analysis are *computed* results — they compare stored facts and produce a derived view. They are distinct from graph queries, which retrieve stored facts.

### Option A: Analysis tools on the MCP surface

`get_drift` and `get_branch_conflicts` are first-class MCP tools, callable by agents on demand.

**Pros:** Agents can trigger analysis whenever they need it; flexible  
**Cons:** Analysis on demand can be slow for large graphs; mixes retrieval and computation in the same interface; agents may call analysis tools redundantly

### Option B: Pre-computed analysis surfaced as node properties

Drift status and conflict flags are computed by the MCP server on the refresh cycle and stored as derived properties on nodes. No separate analysis tools — the overlay summary on every cluster response includes the current computed status.

**Pros:** Zero-latency analysis results; no redundant computation; naturally integrated with the response model  
**Cons:** Analysis results are as fresh as the last refresh cycle; agents cannot force a recomputation

### Option C: Hybrid — pre-computed summary, on-demand detail (selected)

The overlay summary on every cluster response carries pre-computed boolean flags (`drifting`, in-flight branch count). These are computed on the refresh cycle and are always fresh relative to the last sync. Dedicated analysis tools exist for fetching *detail* — the full drift report for a node, the specific fields that differ, the full branch conflict breakdown. Agents use the flags to decide whether to fetch detail.

**Pros:** Fast for the common case (agent checks flag, decides to proceed or investigate); full detail available when needed; computation is concentrated at refresh time, not scattered across agent calls  
**Cons:** Detail tools add surface area; the detail is only as fresh as the last refresh

**Decision: Option C — pre-computed summary flags, dedicated detail tools**

This maps cleanly to the layered cluster response in Decision 1: the overlay summary carries the pre-computed flags; the overlay detail tools return the full analysis. The two decisions are consistent.

---

## Consequences

**What this enables:**
- An agent reading a single cluster response gets semantic richness equal to the YAML file plus assembled edge context and analysis flags — one call beats direct file access
- Multi-branch responses let agents reason about in-flight work without multiple calls and manual merging
- The filter object model means query capability grows without breaking existing agent code
- Analysis is fast (pre-computed flags) and detailed (on-demand detail tools) — agents pay only for what they need

**What this constrains:**
- Response payloads for large clusters with many branches can be large — agents should use namespace and template filters to scope queries
- Analysis detail is bounded by refresh freshness — agents requiring real-time drift computation must trigger a sync before fetching detail

**What this does not decide:**
- The specific tool names, parameters, and response field names — those are in the tool catalogue reference document
- Authentication and rate limiting — deferred to ADR-007 (hosted commercial tier)
- Streaming responses for large payloads — deferred; all responses are currently request-response

---

## Related

- ADR-001: Storage and interaction architecture — establishes the MCP server role and Git-backed write model
- ADR-002: Graph file format — the cluster structure the response unit mirrors
- ADR-003: Graph loading and runtime representation — the SQLite cache this interface queries
- ADR-003b: Core logical data model — the entity shapes surfaced in responses
- ADR-004: Template pack format — template definitions included in cluster responses
- ADR-004b: Edge type vocabulary — edge types included in cluster responses
- ADR-006: Linter and validator — the linter enforces file-level rules that mutation tools must produce conforming output for
- PDR-004: Agent and MCP interface — product decisions implemented by this ADR
- Reference: MCP Tool Catalogue — the specific tools, signatures, and response schemas derived from these decisions
