# Architecture Decisions

> **Status:** Draft v0.1  
> **Last updated:** April 2026  
> **Note:** These decisions reflect the current best understanding. All are revisable as the system evolves.

---

## ADR-001: Central Service as Primary, Not Optional

**Decision:** The central aggregation service is required infrastructure, not an optional enhancement.

**Context:** Cross-repo, cross-service contract intelligence — the core value proposition — requires a shared layer that all repos and agents can read from and write to. A purely local or per-repo model cannot answer "what is being proposed across all teams that touches this domain."

**Consequences:**
- Managed SaaS and self-hosted Docker Compose are both valid deployment targets
- Pure local mode is a degraded but functional experience, not the primary use case
- The hosted central service is the thing agents query — not local files

**Rejected alternative:** Local-first with optional central sync. Rejected because cross-team awareness is impossible without a shared live layer.

---

## ADR-002: Git for History, Postgres for Queries

**Decision:** Git-committed files are the versioning and audit layer. Postgres is the operational query layer. Neither is sufficient alone.

**Context:** Git provides branching, PR review, diffability, and history for free. Postgres provides the transactional consistency, referential integrity, and query expressiveness needed for cross-repo graph traversal and concurrent agent writes.

**The split:**
- Human-authored design changes → committed to Git as structured files → ingested into Postgres
- Agent queries → against Postgres, not file scans
- Historical reconstruction → Git history on spec files
- Current state queries → Postgres

**Consequences:**
- Postgres is a projection, not the source. If corrupted, rebuild from Git history.
- Every meaningful design change must produce a Git commit — this is the audit trail.
- Agent write frequency must be managed — batch into commits at meaningful boundaries, not on every change.

**Rejected alternative:** Postgres only. Rejected because no diffable PR review, no history without bespoke audit tables, harder for agents to read directly.

**Rejected alternative:** Git/files only. Rejected because cross-repo queries require scanning all files, no referential integrity for relationships, no real-time collaboration.

---

## ADR-003: YAML Files for Node Definitions, Postgres for Relationships

**Decision:** Spec files (YAML/JSON) define nodes — field declarations, contract shapes, event schemas. Cross-service relationships (edges) live in Postgres only, never in files.

**Context:** Cross-file YAML references are strings with no enforcement. A dangling reference to a field in another service's spec file fails silently. Relationships require referential integrity — a node being removed must immediately surface broken edges.

**Consequences:**
- Files are always self-contained and valid in isolation
- Cross-service edges are registered through the central service API
- AI inference pipeline proposes edges; humans or agents confirm them
- The graph is not fully reconstructable from files alone — Postgres owns the relationship layer

**Rejected alternative:** Cross-file YAML references. Rejected because no referential integrity, silent failures, hard for agents to traverse.

---

## ADR-004: OpenAPI and AsyncAPI as Base Formats

**Decision:** Use OpenAPI for API schemas and AsyncAPI for event schemas as the canonical file formats, extended with custom metadata via extension fields.

**Context:** These are industry standards that agents already understand, that existing tooling generates, and that can be imported from existing service repos without requiring teams to adopt a new format from scratch.

**Consequences:**
- Adoption friction is lower — teams with existing OpenAPI/AsyncAPI specs can import immediately
- Agents have prior knowledge of these formats
- Custom metadata (domain links, delivery tags, branch provenance) lives in extension fields
- The tool consumes these formats, it does not replace them

**Rejected alternative:** Custom graph schema format. Rejected because higher adoption friction and agents have no prior knowledge of it.

---

## ADR-005: Branch Provenance as Context Memberships

**Decision:** Nodes and edges carry a set of context memberships rather than a single branch tag. A context has a type (branch, epic, milestone, feature flag, design session) and a relationship type (introduced_by, modified_by, deprecated_in, removed_in).

**Context:** A node exists on multiple branches simultaneously. A field might be introduced on a feature branch, belong to an epic, be behind a feature flag, and be part of a pre-branch design session. A single branch column cannot represent this.

**Schema:**
```sql
node_contexts (
  node_id,
  context_id,
  context_type,        -- branch | epic | milestone | flag | design
  relationship_type,   -- introduced_by | modified_by | deprecated_in | removed_in
  repo,
  created_at
)
```

**Consequences:**
- Removal is a new context relationship (removed_in), never a deletion
- Full history is preserved — nodes are immutable, context memberships accumulate
- Time travel is a query over context memberships filtered by timestamp
- Conflict detection compares nodes with the same canonical_id across different branch contexts

---

## ADR-006: Canonical ID Strategy (Unresolved)

**Decision:** Pending. Stable node identity across branches, renames, and cross-repo references is required but the implementation strategy is not yet decided.

**Context:** The composition engine merges nodes with the same canonical_id across branches. If a field is renamed on a branch, is it the same node (modification) or a new node (delete + create)? The answer determines whether the composition engine sees a conflict or a divergence.

**Options under consideration:**
- Content-addressed ID (hash of node definition) — stable but changes on any modification
- Path-based ID (repo/service/file/field) — human readable but breaks on rename
- Assigned UUID with rename tracking — stable but requires explicit rename operations
- Combination: UUID assigned on creation, path as a mutable alias

**Status:** Needs decision before composition engine is built.

---

## ADR-007: MCP Server as Primary Agent Interface

**Decision:** The MCP server is the primary interface for agent access to the graph. The REST API serves the UI and integrations. Agents do not query files or databases directly.

**Context:** The MCP interface is becoming a standard for how agents consume structured context. Building to MCP means the graph is immediately accessible to any MCP-compatible agent or IDE without custom integration. It also forces the query interface to be self-describing — agents must be able to discover schema and construct queries without system prompts.

**Consequences:**
- MCP server is built before the UI, not after
- Every query type that matters to agents must be expressible as an MCP tool
- The MCP interface must be self-describing — tool definitions include enough context for an agent to use them correctly without documentation
- UI is built as a consumer of the same API agents use

**Rejected alternative:** Agents read files directly. Rejected because cross-repo queries require the central index, file parsing is slow and brittle, and referential integrity for relationships only exists in Postgres.

---

## ADR-008: Automated Extraction for Main State

**Decision:** Main branch state is derived automatically from code via CI pipeline, not maintained manually.

**Context:** Manual maintenance of the main graph is the primary adoption failure mode. If keeping the graph current requires human discipline, it will drift. Automated extraction from OpenAPI/AsyncAPI specs generated by each service on every push to main keeps the graph honest without human effort.

**Consequences:**
- Each repo gets a lightweight CI step that extracts specs and pushes to the central service
- Main state is always a reflection of what is actually in code
- The reconciliation engine compares design graph (intended) with extracted graph (actual) and flags divergence
- Semantic enrichment — domain links, field equivalences — still requires AI inference or human confirmation

**Known risk:** Code extraction reliability varies by language and framework. This is the highest technical risk in the adoption strategy and must be validated early.

---

## ADR-009: Composition Over Merging

**Decision:** The global graph is a composition of multiple branch graphs viewed simultaneously, not a merged result. Conflicts are surfaced as data, not resolved as a prerequisite to querying.

**Context:** Merging implies conflict resolution before you can see the combined state. Composition means you can query across conflicting branches and see the conflict as information. This is more useful for the "what's coming" and "what conflicts exist" query patterns that are central to the value proposition.

**Consequences:**
- The composition engine holds multiple versions of the same canonical_id simultaneously
- Queries can specify a view: main-only, branch-specific, or composed across selected branches
- Conflict detection is a query result, not a gate
- A View is a named set of contexts — agents pass a view parameter, the engine handles projection

---

## ADR-010: Delivery Linkage at Epic Level, Story Level Optional

**Decision:** Linking graph nodes to epics is a must-have. Story-level granularity is a should-have, deprioritised until epic-level linkage is proven useful.

**Context:** Story-level field provenance is appealing but maintaining it is expensive even with automation. Epic-level linkage provides most of the impact analysis value at lower maintenance cost. Story-level can be added once the pattern is established.

**Rejected scope:** Milestone and sprint-level linkage. Too granular for initial delivery, too volatile to maintain reliably.

---

## ADR-011: Discussions Are Graph Artifacts, Not UI Features

**Decision:** Comments and discussion threads are first-class graph entities that attach to nodes and edges with full provenance. They are not a UI layer bolted on top.

**Context:** In current practice, design discussions happen in Confluence comments on domain model tables, in PR review threads, in Slack, and in meetings. This rationale is detached from the artifacts it concerns, invisible to agents, and lost over time. The pattern of commenting on a specific field name or type — "should this be nullable?", "this conflicts with how payments defines this term" — is a critical part of the design process that needs to live where the artifact lives.

**The model:**

```sql
discussions (
  id uuid primary key,
  anchor_node_id uuid references nodes(id),   -- attaches to a node
  anchor_edge_id uuid references edges(id),   -- or an edge (nullable)
  anchor_field    text,                        -- specific field within a node, e.g. "name", "type"
  status          text,                        -- open | resolved | superseded
  created_by      text,                        -- human or agent identifier
  created_at      timestamptz
)

discussion_comments (
  id              uuid primary key,
  discussion_id   uuid references discussions(id),
  author          text,                        -- human or agent identifier
  author_type     text,                        -- human | agent
  body            text,
  references      uuid[],                      -- other node/edge ids mentioned
  created_at      timestamptz
)
```

**Consequences:**
- A comment on a field survives branch merges, renames, and graph mutations — it is part of the field's permanent history
- Discussion resolution can trigger a graph mutation — the thread concludes, a change is applied, the resolution is recorded
- Agents are first-class participants in discussions — they can open threads explaining their reasoning and respond to human challenges
- Notifications are driven by node ownership and thread participation — owning team is notified when a discussion opens on their node
- Agents querying design rationale ("why is this field a string not a UUID") can read resolved discussion threads as structured context
- Discussions are queryable — "all open discussions on nodes in the payments domain" is a valid query

**What this replaces:**
- Confluence comments on domain model tables — discussions now travel with the artifact
- PR review comments on schema changes — structural change discussions belong on the node, not the diff
- Slack threads about field definitions — ephemeral conversations become durable graph artifacts

**Rejected alternative:** Comments as a UI feature only, stored in a separate system. Rejected because agents cannot access them, they don't survive tool migrations, and they're invisible to impact analysis and rationale queries.

---

## Key Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Code extraction unreliable across languages | High | High | Validate early against real service repos, support manual override |
| Canonical ID strategy wrong early on | Medium | High | Decide before building composition engine, design for migration |
| Adoption fails without full coverage | Medium | High | Automated extraction removes dependency on human discipline |
| Agent writes produce Git commit noise | Medium | Medium | Batch commits at meaningful boundaries, not per-change |
| Discussion threads become noisy without resolution discipline | Medium | Medium | Resolution is a required step, not optional — open threads are surfaced as technical debt |
| Central service becomes single point of failure | Low | High | Read replicas, local cache for degraded operation |
| Larger platforms (GitHub, Anthropic) absorb the space | Medium | High | Establish file format as open standard early, build community |
