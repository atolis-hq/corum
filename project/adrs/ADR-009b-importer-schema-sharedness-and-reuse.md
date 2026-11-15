# ADR-009b: Importer Schema Sharedness and Reuse

**Status:** Accepted
**Date:** 2026-07-03
**Deciders:** Product Owner
**Depends on:** ADR-003d (Inline Schema Definition and Reference Resolution), ADR-009 (Importer Architecture)
**Related:** ADR-004b (Edge Type Vocabulary — amended 2026-07-03 to add `uses-type`), ADR-006 (Linter and Validator)

---

## Context and Problem Statement

Import adapters (OpenAPI, AsyncAPI) decide per spec document whether each named schema becomes a **standalone** `{component}.Schema.{name}` cluster or is **inlined** into the referencing root's cluster (`{rootId}.schemas.{name}`). The current rule is a per-document usage count: referenced by 2+ operations (directly or transitively via a shared schema) → standalone; referenced by exactly one → inlined.

The two representations produce structurally different graphs — different node identities, different ownership, different edges (containment vs `uses-type` reference), different lineage anchors. Because sharedness is computed per document in isolation, the same logical schema can end up represented **both ways**:

- Two specs each referencing `Money` once produce two separate inline copies under different endpoints.
- Spec A (2+ uses) plus spec B (1 use) produces a standalone `orders.Schema.Money` **and** an inline copy.
- A schema used once today is inlined; when a second operation adopts it, re-import flips it to standalone — a wholesale node-identity change with no continuity.

Deduplication cannot catch these: it matches only identical IDs or `x-aka` aliases, and inline vs standalone IDs are structurally different. Branch overlay and `diff_branch` compare by node ID, so misaligned representations across branches read as unrelated add/remove.

The mixed-representation problem means there is no single source of truth for a schema's identity when multiple import sources disagree. Priorities, in order: **effective graph construction and cross-branch comparability** first; file-level diff stability second.

## Options Considered

### Option A: Always extract named schemas to standalone clusters

Every `components/schemas` entry becomes standalone; only anonymous operation-inline shapes materialise under endpoints. Duplicates impossible by construction; perfectly stable identity.

**Rejected because:**
- **Noise**: real-world generated specs (e.g. the PRL sample) would gain hundreds of single-use standalone schemas, and every one converts a containment relationship into a `uses-type` reference edge — inflating semantic edge counts, densifying lineage traversals, and changing cluster-view shapes for every endpoint.
- **Worse identity collisions**: inline IDs are differentiated by their owning endpoint (`…get-order.schemas.Result` vs `…list-orders.schemas.Result`). Extraction collapses all same-named schemas in a component to one ID (`orders.Schema.Result`), so generically-named types from different sources would be silently and wrongly unified. Inlining is the *safer* identity model for genuinely endpoint-private shapes.

### Option B: Treat spec declaration location as authorial intent

`components/schemas` → standalone; operation-inline → inline. Deterministic and stable.

**Rejected because:** the shape of generated spec files is not authorial intent — code generators (Swashbuckle, NSwag, etc.) hoist everything into `components/schemas` as standard practice. This collapses into Option A in practice.

### Option C: Usage-count heuristic + graph- and run-aware reuse (chosen)

Keep the per-document heuristic for **new** schemas; consult the wider graph before inlining so existing standalone schemas are always reused.

## Decision

When an adapter resolves a schema named `N` mapped to component `C`:

1. **Reuse before inline.** If `{C}.Schema.{N}` already exists as a standalone node — in the target branch's graph, or produced by another entry in the same import run — reference it. Never create an inline copy of it, and never demote it back to inline. This also protects intentional structure: a schema that is standalone in the existing graph stays standalone regardless of how a new source represents it.
2. **Shape-drift warning on reuse.** When reuse resolves a reference to an existing standalone schema, compare the incoming field set against the existing node's fields and emit a warning diagnostic when they differ. This surfaces cross-source contract drift instead of silently merging it.
3. **New schemas keep the usage heuristic.** Referenced by 2+ operations (directly or transitively) → standalone; single-use → inline into the referencing root. Combined with (1), a schema is promoted **at most once** and the flip never reverses.
4. **Promotion rewrites edges mechanically.** When a re-import flips a previously-inlined schema to standalone, the rename is a deterministic prefix rewrite (`{rootId}.schemas.{N}…` → `{C}.Schema.{N}…`). The importer rewrites **all** edges whose endpoints fall under the renamed subtree — import-derived and design-derived (agent/UI-authored `maps-to`, `derived-from`, …) alike — in the same commit. Warnings are emitted only for unresolvable rewrites (the rewritten target does not exist in the new subtree).
5. **Lint rule.** Flag any inline schema whose `(component, name)` matches an existing standalone schema. This makes the order-dependent interim state visible: if source A (inlines) is imported before source B (creates the standalone), a duplicate exists until A is re-imported, at which point rule (1) converges it.
6. **Reference counting by ref-walk.** `countSchemaOperationUsage`'s JSON-substring matching is replaced with a structural walk of each operation's `$ref`s, eliminating false positives from ref-like strings in descriptions/examples.

The policy applies uniformly to OpenAPI and AsyncAPI adapters. In practice AsyncAPI payloads remain inline per event — an event is a self-contained contract and consumers couple to the event, not to a shared DTO behind it — but rule (1) still applies if a matching standalone schema exists.

## Known Limitations and Deferred Work

- **Name-based unification.** Reuse matches on `(component, name)` — two genuinely different schemas sharing a name in one component would be unified, with only the shape-drift warning (2) as the signal. This is the same assumption the existing `x-aka` deduplication makes. A shape-compatibility gate before reuse is a possible future hardening.
- **`renamed-from` continuity (deferred gap).** Promotion (4) rewrites edges for correctness but records no lineage continuity between the old inline identity and the new standalone identity. When rename/deletion handling lands (see `docs/tasks/renaminganddeletion.md`), promotion should additionally emit `renamed-from` edges for the moved subtree. Until then, git history is the only record of the rename.
- **Cross-run ordering.** Convergence across separately-run imports depends on re-import; only within a single run is resolution order-free.

## Consequences

- The same logical schema can no longer exist as both a standalone node and an inline copy after imports converge; branch comparison and lineage see one identity.
- Sharedness is sticky: identity changes happen at most once per schema (inline → standalone) and are accompanied by a full edge rewrite.
- Graphs that never hit the mixed-representation case are byte-identical to today's output.
