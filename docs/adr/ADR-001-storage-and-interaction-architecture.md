# ADR-001: Storage and Interaction Architecture

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Supersedes:** n/a — this is the foundational ADR; all others are downstream  
**Related:** ADR-002 (Canonical Node File Format), ADR-003 (Graph Data Model), PDR-001 (Tool Scope and Node Taxonomy)

---

## Context and Problem Statement

Before any file format, data model, or query interface can be designed, the tool needs a foundational answer to: **where does the graph live, how is it changed, and how is it read?**

This is the most consequential architectural decision in the project. Every other ADR is downstream of it.

The tool's core value — branch-aware provenance of in-flight design changes across service contracts — requires a storage model that supports:

- Versioning and diffability of graph changes
- Collaboration between multiple engineers and AI agents across services
- Local operation without hosted infrastructure as the primary adoption path
- Direct readability and writability by AI agents without requiring a running intermediary
- A clear path to a hosted commercial tier for non-engineer access later

---

## Decision Drivers

- **Adoption is the primary constraint for v1.** The tool must work by cloning a repository and running a local process. No provisioned database, no cloud service, no persistent daemon. Every additional infrastructure requirement is an adoption barrier.
- **Direct file access by agents is a first-class capability.** An agent with filesystem access should be able to read and write graph files directly without an MCP server running. This is the lowest-friction integration path and one of the strongest arguments for a file-based store.
- **The MCP server is an enhancement, not a requirement.** It provides richer querying, validation, cross-component traversal, and drift detection on top of the file layer. The floor is "clone the repo, the agent reads the files."
- **Git is the sync and collaboration primitive.** Branching, PRs, blame, and history are inherited for free. Engineers review design changes using the same tools and workflows as code review.
- **AI agent compatibility.** Agents read and reason about structured files in Git natively. This is the emerging pattern for agent memory and context, and the file-based model is natively compatible with it.
- **Scale is not a v1 constraint.** A design graph is orders of magnitude smaller than the codebases that tools like Serena and Repomix already index incrementally. Incremental cache invalidation via Git — fetching and comparing commit SHAs rather than rescanning all files — solves the performance problem without hosted infrastructure.
- **Non-engineer access is a commercial addon, not a v1 requirement.** A hosted tier with UI, commenting, and deeper analysis can be introduced later as a paid layer. It does not need to be solved now.
- **The graph repo is separate from service repos.** The design graph lives in a dedicated repository, not alongside the code it describes. This keeps service repos clean and allows the graph repo to have its own PR workflow, CODEOWNERS, and branch protection.

---

## Options Considered

### Option A: Git-native file store with local MCP server and Git-backed incremental cache (selected)

YAML files in a dedicated Git repository are the source of truth. The local MCP server builds and maintains an incremental local cache (SQLite or equivalent) by interfacing with Git directly — tracking the last-seen commit SHA and fetching only what has changed since. It does not watch the filesystem and does not rebuild from scratch on each start. All reads and writes can go through either the MCP server (for richer operations) or directly via filesystem access (for agents and CLI tools that understand the schema).

```
graph-repo/
  components/
    orders/
      api-endpoints/
        POST-orders.yaml        # Cluster file: root node + owned schemas + fields
        GET-orders-{id}.yaml
      domain-models/
        order.yaml
      domain-events/
        order-placed.yaml
      edges/
        api-endpoints--operations.yaml
        operations--domain-events.yaml
  edges/
    orders--payments.yaml       # Cross-component edges
  graph.yaml                    # Repo metadata, template pack declaration
```

The local MCP server:
- Starts on demand when an agent session begins (no persistent daemon)
- On first start, fetches the graph repo and builds a local cache from the current HEAD
- On subsequent starts, fetches from the remote, compares the new HEAD SHA to the cached SHA, and updates only the files that changed between the two commits — using `git diff --name-only <old-sha> <new-sha>`
- During a session, re-fetches and applies incremental updates on a configurable interval or on demand via an MCP tool call
- Serves MCP tool calls (query, propose, validate, detect drift)
- Can query any branch or commit ref, not just HEAD — enabling true branch-aware graph queries
- Exits when the agent session ends

Direct file access path:
- An agent or human with a locally cloned graph repo reads and writes YAML files directly
- Changes are committed and pushed by the agent or human using standard Git operations
- The MCP server picks up those changes on its next fetch cycle
- No MCP server needs to be running for direct file access to work

**Pros:**
- Zero hosted infrastructure — clone the repo, done
- Direct file access by agents is a first-class path, not a workaround
- Git branching, PRs, blame, and history inherited for free
- Engineers review design changes as PR diffs — no new workflow
- Incremental Git-based cache means no meaningful startup cost at any realistic graph size
- Git-native cache invalidation is more reliable than filesystem watching — works regardless of whether files are edited locally, by a remote agent, or via the GitHub UI
- Branch-aware queries are native — the MCP server can fetch and parse any ref without the user switching branches
- File format is human-readable and directly editable without tooling
- Natively compatible with AI agent file-reading patterns
- The MCP server provides richer capabilities without being a hard dependency
- Commercial hosted tier can be added later without replacing the foundation

**Cons:**
- Referential integrity enforced at linter/CI time, not at write time
- Concurrent writes by multiple agents to the same branch require branch discipline
- MCP server requires network access to fetch from the remote — does not work fully offline (direct file access still works offline; MCP query richness requires connectivity)
- File format design carries real complexity (handled in ADR-002)

**Effort:** Medium — file format conventions and MCP server with Git-interfacing cache are the main investments

---

### Option B: Database-first (local SQLite or hosted Postgres)

A database is the source of truth. The MCP server reads from and writes to the database. No YAML files in Git.

**Pros:**
- Referential integrity at write time
- Efficient concurrent writes
- Efficient graph traversal without in-memory loading
- Non-engineer UI straightforward to build

**Cons:**
- SQLite is a binary file — not diffable, not human-readable in Git
- Agents cannot read the store directly — everything must go through an API
- Breaks the "Git as collaboration primitive" model
- Design changes are not PR-reviewable without building a separate export layer
- Not compatible with the AI agent pattern of reading structured files directly
- Harder adoption story — requires understanding a new storage model

**Effort:** Medium to build, but fundamentally misaligns with the adoption strategy

---

### Option C: Database with Git as generated export layer

Database is source of truth. System periodically generates YAML files into Git as a human-readable audit and review surface.

**Pros:**
- Database solves all graph integrity problems natively
- Git export provides diffability and auditability
- Non-engineers and engineers both served

**Cons:**
- Two representations of the same data — sync complexity and drift risk
- YAML is read-only (generated) — agents and humans cannot write files directly
- Requires both a database and a Git repository
- Significantly more complex for v1
- Generated PR review experience is subtly worse — reviewers know they're reviewing machine output
- YAGNI for a tool without validated user demand at scale

**Effort:** High — two systems, synchronisation logic, generated PR pipeline

---

### Option D: Hosted API-first (no local files, no Git involvement)

The graph lives in a hosted service. Agents and engineers interact via API and MCP only. No files, no Git in the graph lifecycle.

**Pros:**
- Simplest consistency model — one store, one truth
- Native concurrent write handling
- Efficient querying at any scale without cold start concerns
- Non-engineer access from day one
- No file format design complexity

**Cons:**
- Requires hosted infrastructure — violates the primary adoption driver for v1
- Agents cannot read the graph directly without a running service — removes the lowest-friction integration path
- No offline capability
- Front-loads authentication, rate limiting, and multi-tenancy before product validation
- Every team must either self-host or trust a third-party service with their design data
- Removes Git as the collaboration and audit primitive — a meaningful loss for engineering teams

**Verdict:** A valid architecture for a later commercial tier. Not the right starting point. The problems it solves (concurrency, query performance at scale) are not the problems that matter for v1 adoption.

**Effort:** Medium to build, but wrong product for this stage

---

## Decision

**Chosen option: Option A — Git-native file store with local MCP server and incremental cache**

### Rationale

**Adoption is the deciding factor.** Options C and D require hosted infrastructure before the product has demonstrated value. Option B removes direct file access, which is one of the tool's primary advantages for AI agent workflows. Option A is the only model where the floor is genuinely zero: clone a repo, read the files, done.

**Option D was explored seriously and rejected for now, not forever.** A hosted API-first model solves concurrency and cross-repo queries more elegantly. But it trades away the two things that matter most for early adoption: zero infrastructure and direct agent file access. These are not problems to defer — they are the primary reasons engineers adopt the tool. Scale and concurrency are problems worth solving when the product has proven its value, not before. The commercial hosted tier (ADR-007) will be the right home for Option D's architecture.

**The scale concern is resolved by Git-backed incremental caching.** The objection to file-based stores at scale is cold start cost and query performance. Both are solved without a hosted service: the MCP server builds a local cache on first run and on subsequent starts uses `git diff --name-only` between the cached SHA and the current HEAD to identify only the files that changed — fetching and re-parsing those files alone. Tools like Serena index entire codebases incrementally. A design graph — far smaller than a full codebase — presents no meaningful challenge. The Git-based approach is also more reliable than filesystem watching: it works regardless of whether changes were made locally, by a remote agent, or directly via GitHub.

**Direct file access is a genuine competitive advantage.** An agent that understands the YAML schema can read and write graph nodes without any intermediary running. It can propose a new API endpoint by writing a YAML file, commit to a branch, and open a PR — exactly the same workflow as editing code. This is not a workaround or a fallback; it is a first-class interaction model, and it is only possible with a file-based store.

---

## The two valid interaction paths

Both paths are first-class. Neither is preferred over the other.

**Path 1 — Direct file access**

An agent or human with a locally cloned graph repo reads and writes YAML files directly. The schema is documented and stable (ADR-002). The agent commits changes to a branch and pushes. The MCP server, if running, picks up those changes on its next fetch cycle. If the MCP server is not running, nothing breaks — the files are the truth.

This is the minimum viable integration. It requires no running service, no installation beyond cloning the repo, and no knowledge of the tool beyond the file schema. It also works fully offline.

**Path 2 — MCP server**

An agent calls MCP tools to query, propose changes, validate lineage, or detect drift. The MCP server reads from its local cache, kept current by periodic Git fetches. It writes changes as YAML files, commits them, and pushes to the remote. This path provides richer operations — cross-component traversal, drift detection, branch-aware queries, completeness filtering — without the agent needing to understand the file format or Git operations.

The MCP server starts on demand (no persistent daemon), requires network access to the graph repo remote, and exits when the agent session ends.

---

## The cache model

The cache is a local implementation detail of the MCP server. It is not infrastructure — agents and humans never interact with it directly.

- On first start, the MCP server fetches the graph repo and builds the cache from the current HEAD, recording the HEAD SHA
- On subsequent starts, it fetches from the remote and runs `git diff --name-only <cached-sha> <new-sha>` to identify changed files — only those files are re-parsed and the cache updated
- During a session, it re-fetches on a configurable interval (e.g. every few minutes) or on demand via an explicit MCP tool call, applying the same incremental diff approach
- When the MCP server writes changes (via a mutation tool call), it commits and pushes, then updates the cached SHA to the new HEAD
- If the cache is deleted or corrupted, it is rebuilt from the current remote HEAD — the remote Git repo is always the source of truth
- The cache technology (SQLite, in-memory, or similar) is an implementation detail not exposed to users or agents

This approach is more robust than filesystem watching: it is agnostic to where edits originated — local filesystem, remote agent, GitHub web UI, or CI pipeline — because it operates on Git's own change history rather than local file events.

---

## The graph repository model

The design graph lives in a dedicated repository, separate from all service repositories:

- Engineers clone this repo to query or review the graph locally
- The MCP server is pointed at the local clone
- Agents working in service repos have the graph repo cloned alongside, interacting via direct file access or MCP tools
- PRs to the graph repo are the design review workflow, governed by their own CODEOWNERS and branch protection
- Cross-service edges live in the graph repo, not in any service repo

---

## The commercial hosted tier

The hosted tier is a future commercial addon built on top of this foundation, not a replacement for it. It reads from the same Git repository, materialises the graph into a database for efficient large-scale querying and non-engineer access, and provides a UI with commenting and deeper analysis. Engineers continue to use the local MCP server and direct file access. This is a proven SaaS model: local-first open tier, hosted commercial tier.

---

## Consequences

**What becomes easier:**
- Zero-friction adoption — clone a repo, an agent can read files immediately with no setup
- Agents integrate without an MCP server running — direct file access is sufficient to start
- Design changes are PR-reviewable with no new tooling or workflow
- Git history is the complete audit trail for every graph change
- The MCP server provides richer capabilities progressively — teams adopt it when they need it
- The commercial hosted tier has a clear, non-disruptive path

**What becomes harder:**
- Referential integrity is enforced by the linter at CI time, not at write time — broken references are caught later than in a database
- Concurrent writes by multiple agents to the same branch require branch discipline
- Cross-repo graph queries require the graph repo to be cloned and up to date locally

**What is newly possible:**
- An agent proposes a design change by writing a YAML file and committing — no running service required
- The graph repo becomes a legible, reviewable, independently governed engineering artefact
- Design PRs are reviewed in the same tools as code PRs — no context switch for engineers
- The linter runs in CI — broken relationships are caught before merge, not after

---

## Downstream ADRs

- **ADR-002:** Canonical file format — directory structure, cluster granularity, edge file conventions, naming rules, YAML schema
- **ADR-003:** In-memory graph data model — how the MCP server represents the graph at runtime, how context and branch awareness work
- **ADR-004:** Template pack format — how node types are defined, versioned, and loaded
- **ADR-005:** MCP tool surface — what tools the server exposes and their contracts with agents
- **ADR-006:** Linter and validator design — referential integrity rules enforced at CI time
- **ADR-007:** Hosted commercial tier architecture — how the central service reads from Git and materialises a database layer

---

## Related

- PDR-001: Tool scope and node taxonomy — establishes the progressive enrichment model and node state semantics this architecture must support
- Vision and brief chat — establishes branch-aware provenance as the primary differentiating capability and the AI-extracted, human-reviewed workflow
