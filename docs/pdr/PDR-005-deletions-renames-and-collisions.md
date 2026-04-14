# PDR-005: Deletions, Renames, and Semantic Collision Detection

**Status:** Accepted  
**Date:** 2026-04-12  
**Decider:** Product Owner

---

## Problem Statement

The two-layer model (design layer and derived layer) works cleanly for additions and modifications. Deletions and renames break the symmetry in ways that produce misleading or irreconcilable drift signals without deliberate product decisions:

1. When something is deleted from the codebase, should the design layer automatically reflect that removal — and what happens to its history and lineage?
2. When something is renamed, how does the tool distinguish an intentional rename from a deletion and unrelated addition — and how does lineage propagate across the rename?
3. When two in-flight branches independently introduce semantically equivalent fields with different names, how does the tool surface that collision?

Without answers to these, the tool produces drift signals that are ambiguous, misleading, or impossible to reconcile — undermining the core value of the design/derived layer model.

---

## Context

PDR-001 established the design/derived layer model and the node state vocabulary. PDR-004 established that agents have full write access to the design layer and that the derived layer is read-only, rebuilt from merged code.

The current state model (`draft`, `proposed`, `agreed`, `future`, `implemented`) has no representation for deliberate removal. Without it, a node deleted from the derived layer looks identical whether the removal was intentional, accidental, or in-flight. The tool cannot distinguish these cases and therefore cannot give humans and agents meaningful signals.

A rename treated as a property update — old name overwritten with new name — breaks lineage silently. Any edge, mapping, or thread that referenced the old name now points to nothing. The tool has no record that the old name ever existed or that the new name is its successor.

The two-branch semantic collision problem is distinct but related: it is the prospective version of the rename problem. Two teams independently name the same concept differently. If undetected, this inconsistency propagates into the codebase and becomes expensive to resolve later. The tool is uniquely positioned to catch this early because it holds the full graph across all in-flight branches simultaneously.

---

## Options Considered

### Option A: Hard deletes and property-level renames
Nodes deleted from the design layer are removed entirely. Renames are property updates — old name overwritten. No collision detection.

- **Pros:** Simple data model; no additional states or operations required
- **Cons:** History is permanently lost on deletion; lineage breaks silently on rename; the tool cannot distinguish intentional from accidental removal; semantic collisions are invisible until they manifest in the codebase
- **Effort:** Low
- **Fit:** Poor — produces exactly the irreconcilable drift signals the tool exists to prevent

---

### Option B: Soft deletes only
Nodes are never hard deleted — they transition to a `removed` state. Renames remain property updates. No collision detection.

- **Pros:** History is preserved on deletion; reconciled removals are distinguishable from unexpected ones
- **Cons:** Lineage still breaks silently on rename; no mechanism to propagate rename through dependent mappings; semantic collisions remain invisible
- **Effort:** Low-medium
- **Fit:** Partial — solves the deletion problem but leaves renames and collisions unaddressed

---

### Option C: Soft deletes, first-class renames, and structural collision detection *(accepted)*
Nodes are never hard deleted — they transition to `removed` state with full history preserved. Renames are explicit operations that carry the old name, link the old and new identities, and propagate through lineage. The tool detects structurally equivalent fields across branches and surfaces them for human or agent review.

- **Pros:** History is fully preserved; lineage survives renames; the tool can distinguish intentional from accidental removal; semantic collisions are surfaced early before they reach the codebase; agents have the context they need to reason about change impact
- **Cons:** Rename as a first-class operation adds surface area to the agent and human interface; structural collision detection requires careful definition of what counts as a potential collision to avoid noise
- **Effort:** Medium
- **Fit:** Strong

---

## Decision

**Chosen option: Option C — soft deletes, first-class renames, and structural collision detection**

### Soft deletes and the `removed` state

Nodes and edges in the design layer are never hard deleted. Deletion transitions a node to `removed` state. The node remains in the graph, retains its full history, properties, and edges, but is flagged as intentionally retired.

The updated state model for PDR-001:

| State | Layer | Meaning |
|---|---|---|
| `draft` | Design | Uncertain or incomplete |
| `proposed` | Design | Default working state |
| `agreed` | Design | Consciously signed off |
| `future` | Design | Intentionally deferred |
| `removed` | Design | Existed and was deliberately retired — history and lineage preserved |
| `implemented` | Derived | Exists in merged code — set by extraction only |

**Reconciliation behaviour with the derived layer:**

| Design layer state | Derived layer | Interpretation |
|---|---|---|
| `removed` | Absent | Fully reconciled — removal is complete |
| `removed` | Present | Flag — code has not caught up with design intent, or removal was premature |
| `agreed` / `proposed` | Absent | Flag — node exists in design but not in code; either not yet implemented or accidentally deleted |
| Any design state | Present | Normal — compare properties for drift |

The primary reconciliation scenario is: code is deleted from the codebase, the derived layer stops producing the node, but the design layer still holds it at `agreed` or `proposed`. This looks identical to an unimplemented node. The tool surfaces this for review — prompting the team to either mark it `removed` (confirming the deletion was intentional) or investigate whether the code was accidentally deleted.

The inverse scenario — code reintroduced after being deleted, derived layer producing a node that is `removed` in the design layer — is a rare edge case handled the same way: surfaced as a reconciliation flag rather than silently accepted.

Agents and humans can hard delete a `removed` node explicitly if they want to purge it entirely — this is a deliberate secondary action, not the default deletion behaviour.

### The materialised threshold

First-class rename and soft delete treatment only applies once a node or field has existed in the derived layer — once it has been **materialised** in merged code. A node that has never reached the derived layer is pure design work; it can be freely renamed, restructured, or deleted without trails or soft delete records. Tracking the full history of exploratory pre-implementation work is noise.

Every node carries a `materialised` flag. Once the derived layer has ever produced a node, `materialised` is set to `true` permanently — it does not revert if the code is later deleted. This flag is the threshold at which rename trails, soft deletes, and reconciliation signals become meaningful.

### First-class renames

A rename is not a property update. It is an explicit operation that:

1. Records the old name on the node as `previousName` alongside the new name
2. Creates a directed `renamed-from` edge between the new node identity and the old name record
3. Flags all edges, lineage mappings, and threads that referenced the old name so they can be reviewed and updated
4. Preserves the full history of the node under its new identity

This means the tool always knows that `EmailAddress` was previously `CustomerEmail`, that the rename happened at a specific point in time, and which dependent mappings may need updating as a result. Agents performing impact analysis receive the rename history as part of the node context payload.

A rename in the design layer that has not yet propagated to the derived layer is surfaced as intentional in-flight drift — distinguishable from accidental drift because the rename record exists.

### Structural collision detection

When two in-flight branches both introduce or modify fields that are structurally equivalent, the tool surfaces a potential semantic collision for review. Structural equivalence is assessed on:

- **Positional equivalence** — the fields occupy the same position in equivalent lineage chains (e.g. both are output fields on nodes with the same semantic role, connected to nodes of the same type)
- **Type equivalence** — the fields share the same data type
- **Name similarity** — the field names are similar enough to suggest the same concept (e.g. `customerId`, `customer_id`, `clientId`)

The tool does not determine whether two fields are semantically equivalent — that judgement is human or agent assisted. The tool surfaces the structural signal; a human or agent reviews it and either confirms the collision (triggering a discussion about which name to standardise on) or dismisses it (recording that these are intentionally different fields).

Confirmed collisions create a `discussion` thread on both fields linking them together, with the resolution recorded when a name is agreed. Dismissed collisions are recorded so the tool does not re-surface them.

### Node stability levels

Breaking change severity is context-dependent. A field rename on a pre-production API consumed only by internal teams is a very different risk to the same rename on a production API with external consumers. Enforcing no-breaking-changes discipline before a contract is stable creates overhead that slows early-stage development without meaningful benefit.

Stability is a property of a node, not a property of a change type. Every node carries a stability level that modulates how the tool signals drift and breaking changes:

| Stability | Meaning | Breaking change signals |
|---|---|---|
| `unstable` | Default — contract is in flux; breaking changes are expected and permitted | Informational only |
| `stable` | Team has declared this contract is worth protecting; consumers may depend on it | High severity — flagged for review |
| `deprecated` | Contract is being retired; changes trend toward removal | Signals focus on consumer migration |

Stability is orthogonal to node state. A node can be `implemented` and `unstable`, or `agreed` and `stable`. State describes where a node is in the design and delivery process; stability describes how much protection its contract warrants.

Toggling breaking change enforcement is not a separate feature — it is a consequence of setting stability. Teams set stability when they are ready and signal severity adjusts automatically. The default of `unstable` means teams are never burdened with contract protection overhead until they explicitly opt in.

Stability inheritance — whether a `stable` parent node makes its child fields implicitly stable — and the precise rules for what constitutes a breaking change at each stability level are deferred to an ADR. The product decision is the model and its defaults, not the implementation detail.

---

## Consequences

**What becomes easier:**
- The tool can always distinguish intentional removal from accidental disappearance
- Lineage survives renames — no silent breaks in the lineage chain
- Impact analysis correctly identifies downstream effects of a rename across the full graph
- Semantic inconsistencies between branches are caught before they reach the codebase
- The design layer never silently accepts reintroduction of deliberately removed nodes

**What becomes harder:**
- Rename must be surfaced as a distinct operation in both the agent interface and the human editing experience — it cannot be a simple property edit
- Collision detection thresholds must be tuned carefully — too sensitive produces noise, too lenient misses real collisions
- The graph accumulates `removed` nodes over time — the tool needs a way to archive or hide them without losing history
- The materialised threshold means unmaterialised nodes behave differently to materialised ones — this distinction must be clearly communicated in both the agent interface and the human editing experience

**What is newly possible:**
- A full audit trail of every name a node has ever had and why it changed
- Agents can perform accurate impact analysis across renames without manual cross-referencing
- Cross-branch semantic standardisation becomes a tool-assisted workflow rather than a manual coordination problem
- Teams are never burdened with contract protection overhead until they explicitly declare a contract stable

---

## Success Criteria

- Deleting a node from the design layer transitions it to `removed` state; its history, properties, and edges remain queryable
- A node that reappears in the derived layer after being `removed` in the design layer is flagged immediately rather than silently accepted
- A rename operation correctly flags all dependent lineage mappings and threads for review without breaking the lineage chain
- An agent performing impact analysis on a renamed field receives the full rename history and dependent mapping list in its context payload
- Two branches that independently introduce structurally equivalent fields with different names produce a collision flag before either branch is merged
- A dismissed collision is not re-surfaced in subsequent tool runs unless new structural evidence emerges

---

## Follow-on Decisions Required

- **PDR-006:** Human review and editing experience — how soft deletes, renames, and collision flags are surfaced and acted on in the UI
- **ADR:** Storage model for the design layer — whether the design layer stores a full copy of each node or a diff relative to the derived layer. This is deliberately deferred as it is primarily a technology decision (git vs. database) rather than a product decision. The product requirement is that the design layer is self-contained and independently readable; how that is achieved is an engineering concern.
- **ADR:** Rename operation implementation — how rename history is stored and how dependent mappings are identified and flagged
- **ADR:** Collision detection algorithm — the specific structural equivalence rules, similarity thresholds, and cross-branch comparison mechanism
- **ADR:** Stability inheritance and breaking change rules — how stability propagates to child nodes and what constitutes a breaking change at each stability level
- **PDR-001 update required:** Add `removed` state and `materialised` flag to the node model

---

## Related

- PDR-001 — establishes the design/derived layer model and node state vocabulary; `removed` state is an addition to that model
- PDR-004 — establishes the agent interface; rename must be a first-class operation in the agent write capability and context payload
