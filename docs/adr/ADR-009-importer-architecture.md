# ADR-009: Importer Architecture — Producers, Contract, and the Shared Reconcile Pipeline

**Status:** Proposed
**Date:** 2026-06-17
**Deciders:** Product Owner
**Depends on:** ADR-001 (Storage and Interaction), ADR-003b (Core Logical Data Model), ADR-004 (Template Pack Format), ADR-006 (Linter and Validator)
**Related:** ADR-004b (Edge Type Vocabulary), ADR-005 (MCP Interface), [01 — Architecture Overview](../architecture/01-architecture-overview.md) §5.4, §6.3, §7

---

## Context and Problem Statement

Main graph state is derived from existing artefacts, not authored by hand (VISION: "Main state is derived automatically from code"). Those artefacts are heterogeneous:

- **Spec files** — OpenAPI and AsyncAPI documents. Single portable files, parseable in-process with existing libraries.
- **Source code** — domain models and events that have *no* spec format. Extraction requires language-specific toolchains (tree-sitter grammars, optionally a semantic backend such as a compiler frontend or language server), is convention-driven, and per [01 §7](../architecture/01-architecture-overview.md) runs **agent-side, in the source repo's CI** — not inside the Corum engine.
- **Proprietary analysis tools** — e.g. an organisation's own static-analysis tool emitting its own contract format.

The [Architecture Overview](../architecture/01-architecture-overview.md) already establishes a `SpecAdapter` port (§4.2), the `CandidateGraph` produced by adapters (§5.4), the reconcile→emit→lint→review import flow (§5.4), and the "adapters not converters" decision (§6.3). What it does **not** yet decide is how a fundamentally different *kind* of producer — an out-of-process, language-specific code extractor — plugs in without dragging extraction concerns into the core, and how heterogeneous producers share one ingestion pipeline.

This ADR decides:

1. **What abstraction unifies all producers**, given that some run in-process and some cannot.
2. **Where the engine boundary sits** so the core stays solution- and language-agnostic.
3. **The order in which the first producers are built**, and why.

---

## Decision Drivers

- **Solution- and language-agnosticism is non-negotiable.** The core engine must contain no knowledge of OpenAPI, any source language, tree-sitter, or any proprietary format. Producers are replaceable; the core is not.
- **One reconcile pipeline, not many.** Matching against existing nodes, `extractedFrom` provenance, `renamed-from` semantics, `maps-to` proposal, and lint gating must happen in exactly one place (ADR-006, §5.4). Every producer benefits from it; none reimplements it.
- **Extraction is agent-side (§7).** Code extraction needs language toolchains and runs in source-repo CI. The engine is TypeScript; it must not host N language runtimes or compiler frontends.
- **Clean architecture (§6.1).** Dependencies point inward. Producers depend on a published contract; the core depends on nothing a producer owns.
- **Confidence is first-class.** Derived data carries how reliably it was established (see Companion decision below). The ingestion path must preserve this end to end.
- **De-risk before novelty.** The first producer should validate the pipeline against a well-understood standard format before the harder, novel extractor is introduced.

---

## Options Considered

### Option A: One in-process adapter interface for everything

Every producer — including code extractors — implements `SpecAdapter` and runs inside the engine.

**Pros:** Single interface; one code path.
**Cons:** Forces language toolchains (tree-sitter grammars, compiler frontends) into the TypeScript core, breaking language-agnosticism and §7's agent-side model. A native semantic backend for some languages cannot run in-process at all.
**Effort:** Low to start, unbounded as languages are added.

### Option B: Standalone converters per format/language writing YAML directly

Each producer is an independent CLI that transforms its input to cluster YAML.

**Pros:** Fully decoupled processes.
**Cons:** The option already rejected in §6.3 — converters lose awareness of the existing graph (no match/dedupe/reconcile), cannot propose cross-boundary `maps-to`, and duplicate the `file-format` emitter. Provenance and `renamed-from` fall apart.
**Effort:** Medium, with permanent divergence cost.

### Option C: Two front doors converging on one `CandidateGraph` and one reconcile pipeline (selected)

There is exactly one internal target — `CandidateGraph` — and one pipeline that reconciles, emits, lints, and reviews it. A producer reaches that target through one of two front doors:

- **In-process `SpecAdapter`** — for formats the engine can parse directly (OpenAPI, AsyncAPI). Produces an import payload in memory.
- **Contract import** — for external producers (code extractors, proprietary tools). The producer emits a **versioned serialization of the import payload** (the *ingestion contract*); the engine deserializes and feeds the same pipeline.

The ingestion contract is, by construction, "serialized import payload." This is not a second pipeline — it is a second way to *obtain* the pipeline's input.

**`CandidateGraph` is not a new type.** It is a conceptual term for "nodes and edges awaiting reconciliation." The `SpecAdapter` interface returns `{ nodes: Node[], edges: Edge[], diagnostics: Diagnostic[] }` using the existing schema types. The serialized ingestion contract uses the same `Node`/`Edge` structure. No new runtime type is introduced.

**Pros:** Core stays language-agnostic; extraction stays agent-side; one reconcile pipeline for all; producers are swappable behind a versioned contract; in-process spec parsing kept where it is cheap and correct.
**Cons:** Two ingestion front doors to document; a contract format to version and maintain.
**Effort:** Medium — mostly formalising existing pieces.

---

## Decision

**Chosen option: Option C — two front doors, one `CandidateGraph`, one reconcile pipeline.**

- **`{ nodes, edges }` is the single convergence point.** All ingestion produces it using existing `Node`/`Edge` types; the pipeline consumes only it.
- **Spec files use the in-process `SpecAdapter` port.** OpenAPI and AsyncAPI parse directly in the engine.
- **Code and external producers use Contract import.** They emit the versioned ingestion contract; `corum import contract <file>` deserializes it into the same `{ nodes, edges }` shape.
- **The tree-sitter code extractor is an external producer, not an in-process adapter.** It runs in service-repo CI (§7), may use a semantic backend per language, and emits the ingestion contract. The engine never hosts a language toolchain.
- **One pipeline downstream of both front doors:** reconcile → emit (via `@corum/file-format`) → stage-1 lint → atomic write → stage-2 lint → review, exactly as §5.4 defines.

### The two front doors

| Front door | Input | Where it runs | Produces | Used by |
|---|---|---|---|---|
| In-process `SpecAdapter` | a spec document | inside the engine | `{ nodes, edges }` in memory | OpenAPI, AsyncAPI |
| Contract import | an ingestion-contract file | external producer (CI / standalone) | `{ nodes, edges }` deserialized | tree-sitter extractor, proprietary analysis tools |

### The ingestion contract (serialized `Node[]` + `Edge[]`)

A versioned, documented wire format. Sketch:

```yaml
contractVersion: 1                 # producer targets a version; engine declares MinSupported
producer: { name: "corum-extractor", version: "1.0", language: "<source-language>" }
generatedAt: "<iso-8601>"          # stamped by the producer
nodes:
  - id: orders.DomainModel.order
    template: DomainModel
    component: orders
    extractedFrom: "src/modules/orders/domain/Order.<ext>"
    derivation: determined       # see Companion decision
    properties: { ... }
    fields:                         # owned children -> has-field implied (ADR-004b)
      - { name: id, type: uuid, nullable: false, derivation: determined }
edges: []                           # node-first producers usually emit none
```

Rules:

- The contract references **Corum vocabulary only** — `template` names and scalar field types resolve against the active template packs (ADR-004). The contract format itself is engine-owned; producers target it.
- It is **versioned with a minimum-supported floor**, mirroring the discipline a producer's own format already uses. A contract below `MinSupported` is rejected with a diagnostic; the engine never silently best-guesses.
- `extractedFrom` and `derivation` are carried per node and per field/edge and survive into the emitted cluster files.

### Reconcile is producer-agnostic

Once an import payload exists, reconciliation (ADR-006, §5.4) is identical regardless of front door: match by canonical ID (`{component}.{Template}.{name}[.section.path]`, ADR-003b), diff properties, propose edges, gate on lint. Multi-producer concerns (the same logical node arriving from OpenAPI *and* the extractor) are a reconcile concern, specified separately, not an ingestion concern.

---

## Build Sequence

The first two producers are ordered to validate each half of the architecture:

1. **OpenAPI adapter — in-process, first.** A standard, well-understood format with an existing parser. Validates the full pipeline end to end — `SpecAdapter` port, reconcile, pack binding, emit, stage-1/2 lint, review — at the lowest risk. (Already build-sequence step 9 in [01 §10](../architecture/01-architecture-overview.md).)
2. **tree-sitter code extractor — external producer, second.** Validates the **contract-import front door** and **multi-source reconciliation** (extractor nodes meeting OpenAPI nodes). The novel, higher-risk piece, introduced only once the pipeline is proven.

Subsequent producers (AsyncAPI adapter; a proprietary analysis-tool → contract plugin) reuse whichever front door fits and require no pipeline changes.

---

## Companion Decision (specified separately)

This architecture assumes nodes and edges carry a **`derivation`** axis (`determined | inferred | manual`) orthogonal to lifecycle `state`, so that confidence-tagged data (e.g. a heuristically resolved field reference) can land on main without overloading `proposed`. That is a change to the universal node/edge model and is captured as an amendment to **ADR-003b**; this ADR depends on it but does not define it.

---

## Consequences

**What becomes easier:**
- A new producer is a contract emitter (or a `SpecAdapter`) — never a new pipeline. Reconcile, provenance, lint, and review come for free.
- Multi-language support adds language-specific *external* extractors without touching the engine.
- Producers are swappable behind a versioned contract: a heuristic extractor can be replaced by a semantic one with zero engine or graph-schema change.

**What becomes harder:**
- Two ingestion front doors must be documented and kept consistent in what they emit.
- The ingestion contract is a public surface that must be versioned and evolved carefully.

**What is newly possible:**
- External, proprietary, or cross-language tools can populate the graph through the contract without the engine ever learning their native formats (preserving the agnostic core).
- Confidence (`derivation`) flows from producer to emitted cluster file, enabling the linter and consumers to treat `inferred` data distinctly.
- Extraction can run agent-side in CI (§7) and push contracts to the graph repo, keeping the engine free of language runtimes.

---

## Amendment: 2026-06-19 — OpenAPI adapter referential model constraint and gap policy

**Added:** The OpenAPI `SpecAdapter` enforces a named-nodes-only constraint and documents a gap policy for structural patterns it cannot faithfully represent.

**Referential model constraint:** Corum's graph requires every type to be a named node with a resolvable ID. OpenAPI's structural model allows types to be described inline and recursively without names. The adapter bridges this by:

- Inlining anonymous objects (when inside an endpoint context) as sibling `Schema` nodes with auto-generated IDs registered in `localSchemas`
- Promoting schemas referenced by 2+ operations to shared `Schema` nodes in a `shared` component
- Transitively promoting schemas referenced by shared schemas (BFS closure over `$ref` links)

**Gap categories and fallback policy:** When a structural pattern cannot be faithfully represented as named nodes and typed fields, the adapter emits a `warning`-severity diagnostic and uses the best-effort fallback:

| Pattern | Fallback | Note |
|---|---|---|
| `oneOf` / `anyOf` union | `type: string` | No union type on `Field`; open gap |
| Anonymous inline object inside a shared schema (no endpoint `rootId`) | `type: string` | Cannot attach sibling `Schema` without context; open gap |
| Triple-nested or untyped `additionalProperties` | `type: string, collection: map-of-map` | Inner value unresolvable; warning emitted |

The following are **handled without warnings** (not gaps):

- `collection: map-of-array` with scalar or `$ref` items — items type resolved from inner `additionalProperties.items`
- `collection: map-of-map` with scalar or `$ref` inner value — value type resolved from inner `additionalProperties`
- `allOf: [{$ref}]` nullable pattern — unwrapped by `resolveAllOfRef` before field processing
- Recursive / self-referential schemas — handled by pre-registering `localSchemas` before `emitFields`

The complete gap taxonomy is maintained in `docs/tasks/openapi-gaps.md`.

**Also amended:** the ingestion contract YAML example in the Decision section above removes `cardinality: one` — the Field model no longer uses `cardinality` (see ADR-003b amendment 2026-06-19).

---

## Related

- [01 — Architecture Overview](../architecture/01-architecture-overview.md) — §5.4 import flow, §6.3 adapters-not-converters, §7 agent-side extraction
- ADR-001 — Storage and interaction: Git-canonical, SQLite-as-projection; the pipeline writes YAML, not a database
- ADR-003b — Core logical data model: `CandidateGraph` nodes/edges, canonical IDs; amended to add the `derivation` axis
- ADR-004 — Template pack format: producers target template names defined here
- ADR-004b — Edge type vocabulary: `has-field`/`has-value` implied by emitted structure; `maps-to` proposed during reconcile
- ADR-006 — Linter and validator: the stage-1/stage-2 gate every producer flows through
