# PDR-007: Derived Layer Integrity and Branch Model

**Status:** Accepted  
**Date:** 2026-04-12  
**Decider:** Product Owner

---

## Problem Statement

The derived layer must accurately and safely reflect what exists in merged code across a potentially incomplete multi-service graph. The tool needs to define:

1. How does extracted data enter the derived layer without corrupting existing state or silently losing history?
2. How is the separation between design intent and derived reality enforced structurally rather than by runtime rules?
3. How does the tool maintain graph integrity — no hard deletes, no silent data loss — at the point where branches are merged?

---

## Context

PDR-001 established the design/derived layer model. The derived layer is read-only to agents and humans during design work, and is the authoritative representation of what exists in merged code.

PDR-002 established that the tool is git-native — branches are the context model, the MCP server builds an in-memory graph from all branches simultaneously, and the design repo is the single source of truth.

PDR-004 established that the derived layer cannot be written to by agents or humans during design time. The extraction process is the only write path.

PDR-005 established that nodes are never hard deleted — only soft deleted via the `removed` state — and that renames are first-class operations carrying a `renamed-from` record.

A key insight: the derived layer update should follow the same branch and merge model as everything else in the tool. There is no special write path. Extraction produces a branch; that branch is merged to main via standard git mechanics. Integrity is enforced at the merge boundary, not by runtime write rules.

In a multi-service architecture the derived layer is **deliberately incomplete**. No single extraction run covers the entire graph. Cross-service relationships, agreed contracts, and organisational lineage live permanently in the design layer — they cannot be expressed by any individual service's spec or codebase. The design layer is not temporary scaffolding; it is the persistent connective tissue that makes the graph whole.

---

## Options Considered

### Option A: Direct write to a derived layer store
Extraction runs produce output that is written directly to a derived layer database or file store. Write rules enforce integrity — no deletes, always additive.

- **Pros:** Simple execution path; no branch management overhead
- **Cons:** Integrity depends on runtime write rules rather than structural enforcement; no audit trail without additional logging; bypasses the git-native model; special-cases the derived layer as a different kind of write; conflicts with design layer state must be detected separately
- **Effort:** Low initially, high to make reliable and auditable
- **Fit:** Poor — contradicts the git-native model and externalises integrity enforcement

---

### Option B: Snapshot replacement per extraction run
Each extraction run produces a complete snapshot of the derived layer which replaces the previous one. The latest snapshot is always authoritative.

- **Pros:** Simple mental model; always reflects current codebase state
- **Cons:** Violates the additive integrity requirement — nodes present in a previous snapshot but absent from the current one are silently lost; in a multi-service graph no single extraction covers everything so replacement destroys data from other services; history is lost between snapshots
- **Effort:** Low
- **Fit:** Poor — directly violates the no-deletion requirement and fails in multi-service graphs

---

### Option C: Derived branches merged to main *(accepted)*
Extraction produces a **derived branch** in the design repo containing the derived layer nodes for the extracted service at a specific commit. This branch is merged to main via standard git merge mechanics. Main is the authoritative graph state. Design branches are never merged to main directly — only derived branches are.

Integrity is enforced at the merge boundary by a pre-merge validation gate that runs before any branch — derived or design — is accepted into main.

- **Pros:** Integrity is structural — the branch merge model handles additivity naturally; full audit trail via git history; conflicts between derived state and existing design layer state surface through standard merge conflict detection; the git-native in-memory graph the MCP server builds already handles this correctly; no special write path or runtime rules required; branch naming conventions and repo merge rules enforce the design/derived separation without additional tooling
- **Cons:** Adds branch management overhead — every extraction run produces a branch; merge gate validation must be implemented and maintained; teams must understand the derived branch convention
- **Effort:** Medium — merge gate validation and derived branch conventions must be designed carefully
- **Fit:** Strong

---

## Decision

**Chosen option: Option C — derived branches merged to main**

### Branch model

The design repo has three types of branches with distinct roles and merge rules:

| Branch type | Naming convention | Merged to main by | Contains |
|---|---|---|---|
| `main` | `main` | Never edited directly | Current authoritative graph state — both derived and design nodes |
| Derived branch | `derived/{service-name}/{commit-hash}` | Extraction process (post code merge) | Derived layer nodes for one service at one commit |
| Design branch | `design/{feature-or-context-name}` | Never — design branches do not merge to main | Design layer proposals, enrichments, cross-service relationships |

**Main is never edited directly.** All changes to main arrive via branch merges. Repo branch protection rules enforce this.

**Design branches never merge to main.** Design intent becomes real when code is written and a derived branch is produced. The lifecycle is:

> design branch → informs implementation → code merged to codebase → extraction runs → derived branch created → derived branch merged to main

**Derived branches are always scoped to a single service and a single commit.** An extraction run for Service A cannot produce nodes belonging to Service B. Scope is enforced at the adapter level and validated by the merge gate.

### The merge gate

Before any branch is merged to main, a pre-merge validation gate runs. The gate enforces graph integrity across both derived and design branches:

**For derived branches:**
- No node present in main is absent from the derived branch without a corresponding reconciliation flag — absence becomes a flag, never a silent delete
- All nodes in the derived branch carry a valid type matching the active template pack
- No nodes from outside the declared service scope are present
- The commit hash in the branch name matches the extraction source metadata

**For design branches:**
- Design branches are rejected entirely — they cannot be merged to main under any circumstances
- This is enforced by branch naming convention and repo merge rules, with the gate as a secondary check

**For all branches:**
- Any node transitioning to `removed` state must be materialised — unmaterialised nodes may be hard deleted freely; materialised nodes must soft delete
- Any rename must carry a `renamed-from` record with the previous name
- No edges are deleted without a corresponding soft delete or rename on the source or target node

Branches that fail the gate are rejected with a structured report identifying which nodes or edges violated which rules. The extraction process or the authoring agent is responsible for remediation before re-attempting the merge.

### How the derived layer grows

Because derived branches are always additive when merged, main accumulates derived state over time from all services that have run extraction. The derived layer in main is a composite picture of all services that have contributed, each at their most recently extracted state.

A node that existed in a previous derived branch but is absent from a new derived branch for the same service is not deleted. The merge gate produces a reconciliation flag — surfaced to humans and agents via the review experience established in PDR-006 — prompting the team to either mark the node `removed` on a design branch or investigate whether the absence is intentional.

### The deliberately incomplete derived layer

In a multi-service architecture the derived layer is always partial. Service A's extraction run tells the tool about Service A. Service B's tells it about Service B. The cross-service relationships — Service A's API consuming Service B's event, a field in Service A's response mapping to a field in Service B's domain model — live exclusively in the design layer.

This is correct and intentional. The design layer is not temporary scaffolding waiting to be replaced by the derived layer. It is the permanent home for:

- Cross-service relationships and lineage
- Agreed contracts between service teams
- Organisational design intent that spans service boundaries
- Enrichments — acceptance criteria, descriptions, field semantics — that code cannot express

These design layer nodes and edges persist in design branches indefinitely. They are never merged to main but are always visible in the MCP server's in-memory graph, which reads main and all design branches simultaneously. A human or agent querying the full graph sees the complete picture — derived state from main plus design intent from all active design branches.

### Extraction triggers

Extraction is trigger-agnostic. The process that produces a derived branch is identical regardless of what initiates it:

| Trigger | Description |
|---|---|
| **Post code merge** | Extraction runs automatically when code is merged to the codebase main branch — the default and recommended trigger |
| **Manual** | A developer or CI process invokes extraction on demand — used for initial population of an existing codebase |
| **Scheduled** | Extraction runs on a defined schedule — for teams that want periodic refresh without full CI integration |

### Initial extraction and design layer bootstrapping

When a team first points the tool at an existing codebase, a manual extraction run produces the first derived branch. On merge to main this populates the derived layer baseline.

If no design layer exists yet, the tool simultaneously bootstraps the design layer — creating `proposed` state design nodes mirroring the derived layer. This gives the team a starting point for enrichment and review rather than a blank canvas. These bootstrapped design nodes live on an initial design branch, not on main, and are available for agent and human enrichment immediately.

---

## Consequences

**What becomes easier:**
- Graph integrity is structural — no runtime write rules to maintain or bypass
- The full audit trail of derived layer changes is git history — no separate logging infrastructure
- Multi-service graphs grow naturally — each service contributes its derived state independently without coordination
- The design layer's permanent value is made explicit — cross-service relationships and enrichments are not temporary

**What becomes harder:**
- Every extraction run produces a branch — branch management overhead increases with extraction frequency and service count
- The merge gate must be implemented and kept current with the node state and rename models
- Teams must understand the derived branch convention — operational clarity matters

**What is newly possible:**
- The provenance of every derived layer change is fully traceable — which service, which commit, which extraction run
- Reconciliation between services is a first-class workflow — the incomplete derived layer is a feature that surfaces what needs design attention
- The tool can show the derived layer history over time — how the graph has evolved across extraction runs

---

## Success Criteria

- A derived branch merged to main never causes a materialised node to disappear without a reconciliation flag
- The merge gate correctly rejects a derived branch containing a hard delete of a materialised node
- The merge gate correctly rejects a derived branch containing nodes from outside the declared service scope
- Running extraction twice against the same codebase at the same commit produces identical derived branches
- A design branch cannot be merged to main — the merge gate rejects it and the branch protection rules prevent it
- An unmaterialised node can be hard deleted on a design branch without triggering the soft delete requirement
- Initial extraction against an existing codebase with no design layer produces both a derived branch and a bootstrapped design branch within ten minutes

---

## Follow-on Decisions Required

- **ADR:** Derived layer contract schema — the precise format and validation rules for derived branch content
- **ADR:** Merge gate implementation — how the pre-merge validation runs, where it runs (CI, git hook, MCP server), and how it reports violations
- **ADR:** Branch naming conventions and repo protection rules — the specific conventions and how they are enforced across common git hosting platforms
- **ADR:** Extraction adapter interface — how extraction tools produce derived branches regardless of tech stack or spec format
- **ADR:** Incremental extraction — whether extraction can be scoped to changed files for performance in large codebases

---

## Related

- PDR-001 — establishes node states, the materialised flag, and the design/derived layer distinction that the branch model implements
- PDR-002 — establishes the git-native model and MCP server in-memory graph that this branch model builds on
- PDR-004 — establishes that derived layer writes are not permitted to agents or humans during design time; the derived branch model is the only sanctioned write path
- PDR-005 — establishes soft deletes, first-class renames, and the integrity rules that the merge gate enforces
- PDR-006 — establishes how reconciliation flags and drift signals surface to humans following a derived branch merge
