# Extracting and Synchronising the Corum Graph from Code

**Date:** 2026-07-12 · **Status:** execution-ready strategy — revised twice after independent adversarial reviews. §1a is the prerequisite work list with phase dispositions; §6.4 fixes the layout/tooling decisions; §8 is the phased plan of record with acceptance gates.
**Context:** a Roslyn extractor exists and yields good results on a complex C# codebase, but is high-effort per language/pattern. The default path for most teams should be an agentic, LLM-assisted approach that leans on deterministic, token-saving tooling wherever possible. This document lays out the options, the recommended architecture, and the algorithms that matter — for one-off initial generation and continuous sync, on developer machines and ephemeral CI (GitHub Actions), across JS/TS, Python, Go, Java, Kotlin, C#, and peers.

---

## 1. The framing that makes everything else fall into place

Two Corum design facts should anchor the whole strategy:

1. **The interchange format is the extraction contract.** Every extractor — Roslyn, a generic mechanical pipeline, an LLM agent — should emit `corum` interchange documents (`.corum/packs/extract/interchange.schema.yaml`) and nothing else. The import pipeline provides idempotent diffing, rename-trail alias resolution, `x-aka` cross-source matching, dedup, schema promotion, and provenance (`derivation: determined | inferred`, `derivedBy`, `extractedFrom`). **Extraction tools should never write the graph directly.** This decouples "how we read code" from "how the graph evolves", and means every technique below is swappable.

   ⚠ *Qualifier:* the contract and pipeline are the right shape, and more capable than they first appear (field-addressed edges and provenance work today), but four extensions are needed before the contract can carry everything this strategy emits — node/edge `properties`, provenance `confidence`, an open edge-type vocabulary, and a `state` override. §1a.1 states exactly what exists and what is missing, with phase dispositions.

2. **Provenance is the trust model.** `determined` = static analysis proved it. `inferred` = heuristic/probabilistic/LLM. The graph can hold both simultaneously, and reviewers can filter by it. Every trade-off between token efficiency and correctness resolves to: *emit at the honesty level you achieved, and let a later, better pass upgrade `inferred` → `determined`.*

The consequence: extraction is not one tool. It is a **ladder of passes**, each cheaper and more general than hand-built compiler plugins, where deterministic passes do the bulk of the work and the LLM is reserved for what genuinely needs judgment.

---

## 1a. Prerequisites: Corum-side work, with phase dispositions

Verified against the actual pipeline code across two review rounds. Each item carries a **disposition** — build it in the phase named, not before. The §8 phases reference these tags; this list is the single source of truth for what blocks what.

| # | Prerequisite | Disposition |
|---|---|---|
| 1a | Node `properties` passthrough in interchange | **Phase 1** — spine extraction is lossy without it |
| 1b | Edge `properties`/`notes`, provenance `confidence`, open edge vocabulary, `state` override | **Phase 2 entry** — only the lineage tiers consume them |
| 2 | Provenance ratchet in the merge core | **Phase 1** — before the first LLM-derived import |
| 3 | `--dry-run` import + diff output | **Phase 0.5** — the MVP depends on it |
| 4 | Partial-import removal semantics | **Phase 0.5** — blocks the per-PR diff, the flagship feature |
| 5 | Graph-branch concurrency control | **Deferred** — until merge-time import is enabled on a second repo |
| 6 | Entry-keyed dedup rules | **Deferred** — until a second service emits interchange docs (Phase 2) |
| 7 | Stability-signal hygiene (empty-diff) | **Phase 0.5** — it is the MVP's acceptance gate |
| 8 | `x-aka` lifecycle semantics | **Phase 1 exit** — before multi-extractor imports become routine |
| 9 | Import through the working session | **Phase 1** — hardening; schedule alongside, not ahead of, extractor work |

Details and decisions:

1. **Interchange schema extension.** What exists today (verified in `adapters/corum/mapper.ts`): per-node/per-edge provenance metadata flows through; field-level edge endpoints resolve via JSON-pointer refs (`#/components/schemas/X/properties/Y` → field node IDs, `mapper.ts:131`, with case-insensitive fallback); `state: implemented` is set by convention — so field-addressed `maps-to` edges are expressible today. What is missing, split by consumer:
   - **(1a, Phase 1)** `properties` passthrough on node entries. The mapper maps only `schema`/`title`/`x-aka` (`mapper.ts:61-73`) and **silently drops everything else** — spine nodes emitted with route/method/topic properties lose them. This blocks Phase 1, not Phase 2.
   - **(1b, Phase 2 entry)** edge `properties`/`notes` (confidence scores, `via:` lineage evidence), a `confidence` field in provenance, an open pack-validated edge-type vocabulary (both the schema's 9-type enum and the mapper's 11-type `VALID_EDGE_TYPES` are closed; unknown types are dropped), a `state` override for extractors (e.g. `future` for feature-flagged code paths), and a two-endpoint `gaps` shape for unresolved lineage pairs (the current gap schema has a single `nodeId`).
2. **Provenance ratchet.** The current reconciler does the opposite of the §3.4 policy: `mergeProperties` for non-`determined` derivation spreads incoming over current (`reconcile/index.ts:78`), so an inferred re-import *overwrites* determined properties, and `derivation` is stamped with the incoming value. Implement in the merge core: inferred never overwrites determined; lower confidence never overwrites higher. Until it lands, LLM-derived imports are branch-only and human-gated.
3. **`--dry-run` import + diff output.** The runner commits unconditionally (`runner.ts:155`). Add a mode that computes the same `diffNodes` result and emits it (machine-readable + human summary) without committing.
4. **Partial-import removal semantics.** Removal is scoped by `extractedFrom === specPath` (`reconcile/index.ts:57-64`), so an *incremental* interchange doc marks every unchanged node from that source as `removed` — and this poisons the **dry-run diff too**, not just commits: the per-PR comment would show phantom removals. **Decision: add an explicit partial-merge mode** (`imports[].partial: true` — diff adds/updates only, never removals) rather than per-anchor source scoping; full runs (§6.2 weekly) remain the removal authority.
5. **Concurrency control.** Imports commit whole-graph (`replaceGraphContent: true`, `runner.ts:159`) — concurrent merge-time imports are last-writer-wins. **Decision: serialised import queue (single writer)** — a GitHub Actions concurrency group per graph repo is sufficient and requires no pipeline changes; revisit sharding only if queue latency becomes real. Deferred until a second repo enables merge-time import.
6. **Entry-keyed dedup rules** (code review §6.3) — dedup rules key on adapter IDs, so two interchange-emitting services can't be deduplicated. Deferred to Phase 2 (its trigger is the second emitter).
7. **Stability-signal hygiene.** `diffNodes` equality includes volatile fields; concretely, the mapper stamps `lastModifiedAt` with the run date on every node (`mapper.ts:664`), so a re-import on a later day marks everything modified, and `path.resolve` makes `extractedFrom` differ between Windows dev machines and CI. **Decision — all three fixes:** exclude `lastModifiedAt` from `nodesEqual`; stamp it only on actual change; replace resolved-path `extractedFrom` with stable config-declared source IDs (also fixes code review §2.5's portability problem and the removal-scoping fragility in one move).
8. **`x-aka` lifecycle** — strip/keep semantics are inconsistent (code review §2.7) and matching can't cross components (§6.3); fix before multi-extractor imports are routine.
9. **Import through the working session** (code review §6.5) — imports bypass the lint gate; unify to one writer path during Phase 1 hardening.

---

## 2. The extraction ladder

Ordered by preference. Each tier emits interchange docs; tiers compose in one import run (the runner already merges multiple entries with dedup rules).

### Tier 0 — Contracts, not code (deterministic, zero tokens)
OpenAPI, AsyncAPI, protobuf/gRPC, GraphQL SDL, Avro/JSON-Schema registries, SQL DDL/migrations, Terraform for infra edges. Corum already has openapi/asyncapi adapters. **Where a contract exists, it is always the authority for the spine node it describes** — code extraction should attach to contract-derived nodes (via `x-aka`) rather than compete with them. Many teams can get 60–80% of their spine from Tier 0 alone. If specs are generated at build time (Swashbuckle, springdoc, FastAPI), run the build and harvest — that is effectively "extraction via the framework's own reflection", the cheapest high-fidelity extractor there is.

### Tier 1 — The mechanical spine (deterministic, zero tokens)
Identify the *anchor nodes*: components, entrypoints (HTTP routes, message handlers/consumers/producers, scheduled jobs, CLI commands), and the types they exchange. Two complementary technologies cover all major languages without per-language compiler plugins:

- **Symbol indexes — SCIP where mature, LSP as the fallback.** A cross-file symbol index gives you **symbol resolution**: every definition, every reference, fully qualified names — the single most valuable input for stable IDs and type reachability. Maturity is uneven and must be stated honestly: scip-typescript, scip-go, and scip-java (Java) are mature; **scip-dotnet is early (0.1.x)**; **Kotlin goes through scip-kotlin/semanticdb-kotlinc, which has publicly lagged Kotlin 2.x/K2** — a real hole in one of the six target languages. The fallback that covers every gap is the **language's LSP server** (`textDocument/definition`, `references`, `implementation`, `typeHierarchy`): slower per query than an index, but query volume here is anchor-scoped, not whole-repo, and Kotlin's LSP story (JetBrains tooling) is strong exactly where SCIP is weak. **Do a one-day SCIP-vs-LSP bake-off per language before committing**; the architecture is indifferent — it needs the query contract, not a specific index format. Note the limits either way: an index gives references and (indexer-permitting) implements/extends relationships; it does **not** give a resolved call graph or dataflow — those are the semantic backend's job (§4a).
- **Structural pattern rules** — tree-sitter–based engines (ast-grep, semgrep, GritQL). These find *framework idioms*: `[HttpPost]` attributes, `@RestController`/`@KafkaListener`, `app.post(...)`, `router.HandleFunc`, FastAPI decorators, MediatR handlers, MassTransit consumers. Rules are YAML data, not code — they ship and version like Corum template packs (see §5: "extraction packs").

Spine building = fingerprint the repo (build files, lockfiles, imports → which frameworks are present) → select rule packs → run rules to find anchors → resolve anchor symbols through the symbol index (SCIP or LSP, per the bake-off) → emit `APIEndpoint`/`DomainEvent`/`Command`/`DomainModel` interchange nodes with `derivation: determined`.

### Tier 2 — Mechanical schema extraction (deterministic, zero tokens)
Anchor types found in Tier 1 (request/response DTOs, event payloads, entities) are expanded into `components.schemas` in the interchange doc. This is mostly serialization-library introspection, which is highly mechanical per ecosystem: Jackson/kotlinx.serialization annotations, `System.Text.Json`/Newtonsoft attributes, pydantic models/dataclasses, Go struct tags, zod/TypeScript interfaces. Two implementation routes:

- **Static:** walk type declarations via SCIP + tree-sitter; read wire names from annotations. Handles 90% of shapes.
- **Runtime-assisted (where a build exists):** many stacks can *emit* JSON Schema for their types (pydantic `.model_json_schema()`, zod `toJSONSchema`, Jackson schema module). A tiny generated harness that reflects over the anchor types and dumps schemas is often cheaper and more correct than reimplementing serialization semantics statically. Prefer it when the repo builds in CI anyway.

Generics, inheritance, and discriminated unions are where static extraction degrades — emit what is resolvable as `determined`, and record the rest in the interchange `gaps` array rather than guessing. Gaps become the LLM's work queue (Tier 3), which is precisely the token-efficiency mechanism: **the LLM only sees what the deterministic passes could not settle.**

### Tier 3 — LLM agentic extraction (probabilistic, token-budgeted)
The LLM's comparative advantages are *classification, naming, and semantics* — not discovery. Use it for:

- **Template classification:** is this type a `DomainModel`, a `ReadModel`, a `ValueObject`? Is this message a `DomainEvent` or `IntegrationEvent`? Give it the type + usage digest and a **closed choice list** (the pack's template names) via structured output. Closed-set classification is stable and cheap.
- **Component assignment:** which bounded context does this belong to? This deserves more design weight than the other classifications because **component is the first segment of every node ID** — a wrong cold-start assignment isn't a metadata fix later, it's a mass rename of every node in that component. Mechanism: the LLM *proposes* a `component-map` (path/namespace prefix → component) from a digest of paths, namespaces, CODEOWNERS, and import neighbourhoods; the map is a **committed, human-reviewed config file**, curated *before* the first full import mints IDs; subsequent runs consult the map deterministically and only re-invoke the LLM for unmapped prefixes. Assignment thus happens once, visibly, and up front — not per-node, per-run.
- **Gap resolution:** each `gaps` entry from Tier 1/2, with a *program slice* as context (see §4).
- **Field-level lineage** where deterministic techniques run out (§4).
- **Rule synthesis** — the highest-leverage use, covered next.

### Tier 3a — LLM-synthesised extractors: the adaptivity mechanism
The requirement "don't couple extraction to specific codebase patterns — adapt to whatever code exists" has a known failure mode: either you hand-write rules per framework forever (your Roslyn experience), or you pay LLM tokens on every file on every run. The resolution, used by the current generation of code-transformation tools (Grit, Codemod, ast-grep's own assistant tooling), is:

> **The LLM writes the deterministic rule; the rule does the extraction.**

When repo fingerprinting finds an unrecognised idiom (a homegrown message bus, a bespoke handler registration), the agent examines a handful of representative instances, **synthesises an ast-grep/semgrep rule + a mapping to interchange constructs**, validates the rule against the repo (does it match the known instances? does it over-match?), and commits it to the repo's own extraction pack (`.corum/extract/rules/`). From then on, that pattern is extracted deterministically, for free, forever — and the rule is reviewable in a PR like any code. Token cost is *once per pattern*, not per file per run. This is the core answer to adaptivity **and** run-to-run stability **and** token efficiency simultaneously, and it is where I would spend the engineering effort that would otherwise go into a second Roslyn-class extractor.

Two honest caveats on the convergence claim. First, "once per pattern" is really "once per pattern **variant**": framework upgrades, mid-flight style migrations, and five-ways-to-register-a-handler codebases each spawn synthesis events and review PRs — the cost is a decaying stream, not a one-off. Second, some idioms have **no syntactic anchor at all** (DI-by-convention, reflection scanning by namespace, config-driven wiring); these route to the semantic backend or remain LLM-resolved, and rules should not pretend to capture them. **Falsify the bet early with telemetry:** track rules-per-repo and variants-per-rule over the first months on real repos. If rules-per-repo stabilises (order ~30 for a typical service repo) and recall vs the Roslyn reference exceeds ~85% on the C# estate, the bet holds; if variants keep spawning, the review queue becomes rubber-stamp theatre and the design needs revisiting before scale-out.

### Tier 3b — Rule synthesis: validation, testing, and lifecycle

Synthesised rules are code and must be treated as code — but the testing burden can be almost entirely automated, and the user's protection against endless re-tuning comes from **two orthogonal safety nets**, not from rules being perfect:

**At synthesis time (automated gates before a rule is ever proposed):**

1. **Exemplar-anchored synthesis.** The agent must first *enumerate* the instances it believes exist (from cheaper evidence: index queries, naming conventions, a capped LLM scan). These become the labelled positive set. The candidate rule must match 100% of exemplars — a recall gate.
2. **Counter-exemplars.** The agent also names near-misses (types that look like handlers but aren't). The rule must match none of them — a precision gate.
3. **Match-budget guard.** If the agent expected ~12 handlers and the rule matches 400 nodes, it is over-matching — rejected before a human sees it.
4. **Semantic post-filter — the accuracy backstop.** Rules never feed the graph directly. Every rule match is a *candidate* that must pass a semantic check against the symbol index (does this method's enclosing type actually implement the expected interface, transitively? does the attribute resolve to the right framework type?). **Rules propose; the index disposes.** A sloppy rule therefore costs recall (candidates filtered out, logged as gaps), never precision (wrong nodes in the graph).

**At commit time:** each rule ships with a minimized fixture file (real matched examples) plus the expected-match snapshot. The rule PR shows the reviewer exactly what it matches — review takes minutes, and this PR is the *only* human touchpoint in the loop. Newly synthesised rules may emit `inferred` until approved, then promote to `determined`.

**In steady state (regression detection without human attention):**

5. **Fixture tests in CI.** The extraction pack's fixtures run like lint — a grammar or code-style change that breaks a rule fails visibly, and the agent is re-invoked to repair the rule against the same fixtures.
6. **Per-rule telemetry.** Every run records match counts per rule; a count dropping to zero or spiking triggers a review item rather than silent graph drift.
7. **Coverage invariants — the under-match detector.** Rules failing to match are invisible to fixtures (you can't test for what you didn't know to look for). The detector is cross-tier: every Tier-0 contract operation should have a matched code anchor; every message type published should have a producer node; components with anomalously few anchors per KLoC stand out. A coverage violation auto-queues rule synthesis for that area. **Coverage invariants generate the work queue; the user tunes by approving PRs, not by editing rules.**

### Where the Roslyn extractor fits
Keep it — as the **gold reference**. Run it on the C# estate and use its output to measure recall/precision of the generic pipeline (SCIP + rules + LLM) on the same code. It also remains the right choice for teams who want maximum fidelity on a flagship codebase. But the *default* path is the generic ladder; compiler-plugin extractors become an optional Tier 1 upgrade per language, not the entry cost.

---

## 3. Stability across runs (the LLM determinism problem)

The graph must not churn when the code hasn't changed. Four mechanisms, in order of importance:

1. **Deterministic node IDs — the LLM never invents identity.** Node IDs derive mechanically from stable code anchors: the fully-qualified symbol, sanitised through the existing `sanitizeIdSegment` grammar (`{component}.{Template}.{symbol-derived-name}`). On the SCIP path that is the SCIP symbol string; **on the LSP path (e.g. Kotlin), the FQN is constructed from the `documentSymbol` container chain (package → type → member) and normalised to the same SCIP symbol grammar**, so IDs are identical regardless of which backend produced them — this rule is what makes the backends interchangeable. The LLM chooses *which template* and *which component* from closed sets; it never free-texts an ID. When it proposes a friendlier display name, that goes in `title`/`x-aka`, not the ID. (Corum's rename machinery then lets humans rename curated nodes later without breaking re-import — the alias map absorbs it.)

2. **Content-addressed memoisation.** Every LLM decision is cached keyed on `hash(input digest + prompt version + model id)`. Unchanged code slice → cache hit → zero tokens, byte-identical output. The memo store is a directory of JSON files, committed or cached (see §6) — this makes re-runs on unchanged code *both* free and perfectly stable. This is the single most effective technique on the tokens-vs-stability axis and should be built into the agent harness from day one.

3. **Structured, closed-set outputs at temperature 0.** JSON-schema-constrained responses; enumerated template names, component names, edge types; confidence as an explicit field. Free-form generation is limited to descriptions (which are display-only and low-stakes if they drift).

4. **Ratchet, don't regenerate.** Continuous runs never rebuild the graph from scratch; they emit interchange and let `diffNodes` merge. Corum's reconciler already preserves human-owned fields (`state`, `stability`, `notes`) across `determined` re-imports and keeps rename trails. The ratchet policy — an `inferred` claim never overwrites a `determined` one; lower confidence never overwrites higher — **must be implemented in the merge core; it is prerequisite §1a.2, not an add-on.** The current `mergeProperties` does the opposite for inferred re-imports (incoming spreads over current). Once the ratchet lands, LLM output flapping cannot degrade the graph — at worst it fails to add. Until it lands, treat LLM-derived imports as branch-only and human-gated.

Residual nondeterminism (model version bumps, prompt changes) is handled by versioning `derivedBy` (e.g. `extractor:llm-lineage@v3/claude-fable-5`) and treating a version bump as a deliberate re-extraction event with a reviewable diff — never a silent drift.

---

## 4. Field-level lineage across many layers

The hard case: `OrderController.Create(CreateOrderRequest)` → service → domain entity → mapper → `OrderCreatedEvent` → consumer → read model, where `request.customerId` becomes `order.CustomerId` becomes `event.customer_id` becomes a column. The goal is `maps-to`/`derived-from` edges between **spine schema fields**, skipping the intermediate plumbing.

**Cascade order (revised — inference-first):** 4.1 mapper configs (free, `determined`) → **4.4 spine-constrained similarity matching as the broad-coverage default** (free, `inferred` + score) → 4.2/4.3 dataflow as *sampled verifiers* and ambiguity resolvers → 4.5 LLM slices for what matching structurally cannot see (renames, splits, computed fields) → 4.6 dynamic confirmation for cross-service promotion. Most lineage is *inferred through the spine*, then selectively verified — code-evidence tracing is the upgrade path, not the entry cost. Tier details:

### 4.1 Mapper-config extraction (deterministic, high yield)
Most layered codebases centralise field mapping in a library: AutoMapper/Mapster (C#), MapStruct/ModelMapper (Java/Kotlin), `mapstructure` (Go), marshmallow/pydantic `alias` (Python), class-transformer (TS). These configs *are* field-lineage declarations — parse them directly. MapStruct even generates the mapping code, so either the annotation or the generated source can be read mechanically. This is frequently the majority of real field lineage, at zero tokens, `derivation: determined`.

### 4.2 Structural dataflow between adjacent layers (deterministic)
For hand-written mapping (`dto.X = entity.Y`, constructor calls, object initialisers, named-argument construction), intra-procedural def-use analysis over the AST resolves field-to-field assignment within one function. tree-sitter + the symbol index is enough for the assignment/constructor idioms; Roslyn/ts-morph/go SSA give it compiler-grade where available. Compose across layers by **chaining adjacent-layer mappings** (A→B in the controller, B→C in the service ⟹ A→C) — with two guards the naive transitive closure lacks: **hop-confidence attenuation** (a hop through a conditional (`if premium: dto.x = a else b`), a collection re-shape, or a partial mapping caps the composed edge at `inferred` with reduced confidence, never `determined`), and evidence retention (intermediate hops recorded in edge properties, `via: [...]`, so a reviewer can audit the chain). Composition without attenuation emits confident wrong edges — the worst failure mode this tier has.

### 4.3 Whole-path taint/dataflow engines (deterministic, compute-heavy, zero tokens)
**CodeQL** deserves specific mention: it does interprocedural, field-sensitive dataflow across all the target languages, runs natively in GitHub Actions, and its path queries answer exactly "does source field X reach sink field Y, through what?" Writing a query pack that treats spine-schema fields as sources/sinks turns field lineage into a database query. Costs: DB build time (minutes to tens of minutes; cacheable), query authoring, and licensing (free for OSS; GHAS for private repos). Joern (open-source code property graph, similar query model) is the licensing-neutral alternative. Use this tier where the graph's lineage precision matters most (regulated data, PII tracking) — it upgrades §4.5's inferences to `determined`.

### 4.4 Spine-constrained similarity matching (probabilistic, zero tokens) — the default broad-coverage tier

Don't *track* most lineage — **infer it, constrained by the spine**. The insight that makes name-matching viable as a primary tier rather than a last resort: never match all fields against all fields (hopeless false-positive surface); match only between schema pairs **already connected by spine edges** — the endpoint that `produces` the event, the event a handler `triggers` on, the schemas on either side of a `calls` edge. The spine topology (which Tiers 0–2 established deterministically) supplies the prior that two schemas are related at all; similarity only has to answer *which field corresponds to which* within that pair. Mechanics:

- Score candidate field pairs on normalised-name similarity (case/underscore folding, abbreviation tables), type compatibility, enum value-domain overlap, nesting position, and nullability; solve the **assignment problem (Hungarian algorithm)** over the matrix so each field maps to at most one counterpart.
- **Margin requirement:** accept a match only when its score beats the runner-up by a gap threshold — this is what handles near-duplicate names (`id`, `orderId`, `externalOrderId`) and is the single most important precision control.
- **Generic-name demotion:** `id`, `name`, `type`, `status`, `createdAt` and friends carry low standalone weight — they match only when type/position/enum evidence corroborates, since same-name-different-meaning fields are the dominant false-positive class.
- Emitted as `inferred` with the score as confidence; below the floor → `gaps`, never a guess. Deterministic given the same inputs; embedding-based similarity is an optional booster (pin the model version and memoise).

**What this restructures:** with 4.4 as the broad-coverage default, the expensive tiers stop being the base requirement and become **selective verifiers and gap-fillers** — 4.2 dataflow confirms a *sample* of matches per schema pair (if sampled precision is high, the pair's remaining matches are accepted at higher confidence; if low, the pair escalates), and 4.5 LLM slices handle exactly the cases matching structurally cannot: **renamed fields** (`total` → `grandAmount`), **split/merged fields** (`fullName` → `first`+`last`), and **computed fields** (`netAmount` = gross − tax, which is `derived-from`, not `maps-to` — matching can never produce transformation semantics). This removes per-language def-use analysis from the lineage critical path entirely — the largest single cost in the plan.

**Calibration for free:** the Roslyn extractor's lineage output is ground truth — run the matcher on the C# estate and *measure* its precision/recall empirically before trusting it estate-wide. Matching is the one tier whose real-world error rate can be known in advance.

### 4.5 LLM over program slices (probabilistic, token-budgeted)
For the residue — reflection-based mapping, dynamic dispatch, stringly-typed plumbing, "the trail went cold in layer 3" — hand the LLM a **slice, not files**: the two spine schemas, plus the minimal code path between them, computed as a static program slice. Be clear about what builds the slice: the symbol index supplies reference locations, but **def-use chains come from the semantic backend's AST analysis (§4a), not from SCIP** — slicing is the hard half of this tier, and its quality bounds the tier's token-efficiency claim (start from the sink field's writes, walk def-use/call edges backwards until reaching the source type; cap depth). Slicing typically cuts a 5-layer traversal from ~10k lines of context to a few hundred. Ask for field-pair mappings with per-pair confidence and the line-level evidence it relied on (evidence goes into edge properties for review). Memoise per slice hash (§3.2). Self-consistency (sample 3, keep pairs proposed by ≥2) is worth its 3× token cost only for high-stakes schemas; make it a per-schema opt-in flag rather than a default.

### 4.6 Dynamic confirmation (optional, high precision)
Where a test suite exists, instrument serialisation boundaries (or use OpenTelemetry payload capture in a test environment) and record which concrete values traverse which fields. Value-equality correlation across boundaries confirms or refutes proposed lineage empirically. This is the only technique that sees through reflection and runtime configuration reliably. Best used not as a primary extractor but as a **verifier that promotes `inferred` edges to `determined`** — and it composes beautifully with CI (run during the existing test job).

### 4.7 Bridge nodes: the extractor's working model (never persisted)

A proven learning from the Roslyn extractor: **bridge nodes** — the intermediate types and members a value traverses between spine nodes (internal DTOs, mapper classes, service-method parameters) — were identified during path tracing and collapsed when rendering. Adopt this as the generic pipeline's lineage working model, with a firm boundary: **bridge nodes live only inside the extractor. They never appear in interchange documents or the Corum graph.** The graph stays spine-only; extraction traces through plumbing and emits contracted spine-to-spine edges.

What the extractor keeps internally (its *trace graph*, held in the extraction cache alongside the LLM memo store):

1. **Per-hop mappings keyed by content hash** — the incremental-recompute win. A changed mapper invalidates only its local hops; the spine-to-spine edges re-contract mechanically from cached hops. This matters enormously for the per-PR flow (§6.2), since most PRs touch middle layers — without cached bridges, one middle-layer change forces re-tracing every chain through it.
2. **Hop-attenuation state** — the §4.2 confidence guards (conditionals, re-shaping, partial mappings) attach at bridge boundaries and compose into the contracted edge's final confidence.
3. **Slice cut points** — a tier-4.5 LLM slice is exactly "the code between two bridge nodes"; bridges give slicing its boundaries.

What crosses the boundary into interchange: only the contracted edge, plus **evidence as data, not as nodes** — a `via:` list of code locations/symbols (`OrderMapper.ToEvent@src/mappers/order.cs:41`) in edge properties (requires §1a.1's edge-properties extension). That preserves the auditability benefit — a reviewer can follow the chain — without the graph ever knowing bridges existed. No new template role, no lineage-engine changes, no graph bloat; Corum's spine-level model stays clean and the entire mechanism remains an extractor implementation detail that different extractors are free to do differently.

**Cross-service lineage — a structural honesty note.** For the most architecturally valuable edges — producer serialises, broker carries, consumer deserialises — **there is no static code path at all**, so tiers 4.1–4.3 are structurally unavailable, not merely degraded. Those edges will be `inferred` (4.4 name-matching, 4.5 schema-pair reasoning) unless confirmed dynamically. This inverts the tier ordering for event-driven estates: **promote 4.6 (trace-based confirmation) from optional verifier to the primary cross-service tier**, and treat static tiers as the intra-service workhorse.

**Confidence policy across the cascade:** 4.1–4.3 emit `determined` (except attenuated compositions, §4.2). 4.4–4.5 emit `inferred` with confidence; below a floor (say 0.5) emit nothing but log a `gaps` entry — an absent edge with a recorded gap is far better for trust than a wrong edge. Corum's linter/review flow then surfaces gap counts per component as an extraction-quality metric.

**Sequencing (de-risk before building the whole cascade):** prototype 4.1+4.2 alone on the C# estate and score field-lineage yield against the Roslyn extractor's output. If they recover under ~40% of Roslyn's lineage, rethink the cascade (likely 4.6-first) before investing in 4.3–4.5.

---

## 4a. Semantic resolution: inheritance, interfaces, and language-specific constructs

Syntactic rules (tree-sitter/ast-grep) are deliberately dumb: they cannot see that a class implements `IEventHandler<T>` three levels up an inheritance chain, that a Go type satisfies an interface it never names, or that `Response<Order>` embeds `Order`'s fields. This is why the architecture is **rules + index, never rules alone**. The division of labour:

- **Rules** find *syntactic candidates* (attribute shapes, decorator shapes, registration idioms). Portable, cheap, LLM-synthesisable.
- **A per-language semantic backend** answers *type-system questions*: the inheritance/implementation hierarchy, generic instantiation, symbol resolution. Baseline: the symbol index or LSP (see Tier 1 maturity notes — Kotlin in particular needs the LSP route today). Where index relationships are thin, escalate to the native checker API — `tsc`/ts-morph, `go/types` + `golang.org/x/tools` implementation queries, Roslyn workspace, Pyright. The backend is deliberately scoped to *queries* (hierarchy, type resolution), not extraction — but be honest about size: hierarchy-only wrappers are small; add generic instantiation, TS conditional-type evaluation, and the def-use analysis that slice construction (§4.5) actually requires, and the contract grows to low-thousands of lines per language. **Prototype one backend end-to-end and measure before trusting any size estimate** — the difference from "a Roslyn extractor per language" is real (queries vs full extraction) but smaller than a slogan.

**Schema extraction specifics:**

- **Inherited fields** flatten through the `extends` chain via the index, respecting shadowing/overrides and serialization annotations on base members (`[JsonIgnore]` declared on the base must suppress the derived field).
- **Polymorphic serialization** (Jackson `@JsonTypeInfo`, System.Text.Json polymorphism, pydantic discriminated unions, Kotlin sealed hierarchies) maps to discriminated `oneOf` schemas — the implementation set is computed closed-world from the index's implementation relations; open-world cases (plugins, external assemblies) are emitted as `gaps`, not guessed.
- **Generics** are instantiated at the usage site: mechanical type-argument substitution covers the common `Envelope<T>` cases; deeply conditional types (TS `Pick`/`Omit`/mapped types) need the checker to *evaluate* the type, which ts-morph exposes directly.
- **Codegen'd members** (Lombok, C# source generators, Kotlin data classes): scip-java runs inside the compiler so it sees post-Lombok reality; where the indexer doesn't, static extraction sees a lie.
- **The runtime harness is the great equalizer.** Reflection-based schema dumps (pydantic `model_json_schema`, Jackson schema module, a small generated harness per language) sidestep *all* of the above — inheritance flattening, generics, Lombok, annotation semantics — because the serializer itself computes the wire shape. Where the repo builds in CI anyway, **runtime dump should be the preferred schema tier and static extraction the fallback**, not the reverse. Python and heavily-generic codebases especially.

**Lineage specifics:**

- Dataflow through **virtual dispatch** resolves deterministically when the receiver type is statically known or via cheap call-graph algorithms (CHA/RTA — class-hierarchy and rapid-type analysis, both standard and index-derivable); CodeQL resolves virtual dispatch natively; **Go struct embedding** promotes fields and must be flattened before field matching; **Python duck typing** is where static lineage honestly runs out — prefer the dynamic-confirmation tier (§4.6) and LLM slices with the class-hierarchy digest included in context.
- The LLM slice for a lineage question must include a *hierarchy digest* (the relevant type's flattened member list + implementing types), not just the raw code path — otherwise it re-derives inheritance from partial context and errs.

Honest coverage statement: static tiers will handle inheritance/interfaces/generics well in the nominal-typing languages (C#, Java, Kotlin, Go with embedding flattening), adequately in TypeScript (checker required), and poorly in dynamic Python/JS patterns — for which the runtime harness and dynamic confirmation are not optional extras but the designed-in answer.

## 5. Not coupling to codebase patterns

Assembled from the pieces above, the adaptivity story is:

1. **Fingerprint, then select.** A deterministic probe (lockfiles, build files, import statements, annotation scans) produces a capability profile: languages, frameworks, serialisation libs, mapper libs, messaging libs. No assumptions — detection.
2. **Extraction packs mirror template packs.** Rules for each framework idiom live in versioned, shareable packs (`.corum/extract/rules/aspnet.yaml`, `.corum/extract/rules/spring.yaml`, `.corum/extract/rules/fastapi.yaml`…), selected by the fingerprint. Corum already established this pattern for templates and adapter configs (`.corum/packs/*/adapters/*.yaml`); extend it, don't invent a parallel mechanism. (Canonical layout: §6.4.)
3. **The LLM fills pack gaps by writing rules, not by reading everything** (§ Tier 3a). Unrecognised idioms get a synthesised rule, validated and committed to the repo-local pack. The system therefore *converges* toward fully deterministic extraction on any codebase, with LLM cost proportional to the codebase's novelty, not its size.
4. **The interchange format is the only coupling point.** Adding a language = adding a symbol-index backend (SCIP indexer where mature, LSP adapter otherwise — Tier 1) + rule packs (community/synthesised). No engine changes.

---

## 5a. Packaging: skills, self-built tools, and the community path

A constraint shapes the delivery model: the maintainer cannot train or evaluate on other teams' codebases, and cannot pre-build the semantic backends, rule packs, and harnesses for every language × framework combination. So the product is not a finished toolchain — it is a **methodology the agent carries, plus the contracts that keep its self-built tools honest**.

**Ship skills, not (only) tools.** The extraction ladder, the rule-synthesis gates, the lineage cascade, and the sync-review flow should be encoded as well-defined agent skills (Claude Code skills or equivalent), each with its checklist and its contract. A plausible skill set:

| Skill | Encodes |
|---|---|
| `corum-extract-orientation` | the ladder, tier selection, provenance honesty rules, interchange contract |
| `corum-rule-synthesis` | exemplar/counter-exemplar gates, match budgets, fixture format, PR etiquette (§Tier 3b) |
| `corum-backend-bootstrap` | how to stand up a missing semantic backend or SCIP indexer for a language, and how to prove it works |
| `corum-schema-harness` | how to generate and validate a runtime schema-dump harness for the repo's serializer |
| `corum-lineage-cascade` | the §4 cascade order, slice construction, confidence policy |
| `corum-sync-review` | dry-run diffing, drift triage, gap-queue management |

Skills enforce the invariants (interchange schema, `determined`/`inferred` honesty, validation gates, memoisation discipline) while leaving implementation open — which is exactly the right split when the implementation must adapt to unknown codebases.

**The agent builds its own tools where gaps exist — under the same gates as rules.** Rule synthesis (§Tier 3a) already establishes the pattern: LLM writes a deterministic artifact once, validates it, commits it, and it runs for free thereafter. Generalise it one level up: when the fingerprint finds a language/framework with no rule pack, no semantic adapter, or no schema harness, the skill directs the agent to scaffold one, prove it against the repo (exemplar-anchored, coverage-checked — the §Tier 3b harness generalises from rules to tools), and commit it to the repo's `.corum/extract/` toolchain. The convergence argument holds at this level too: token cost is proportional to the *novelty of the stack*, not the size of the estate, and every generated tool is a reviewable file, not model behaviour.

**Evaluation without access to other teams' code.** Since centralised eval is impossible, quality assurance must be structural and portable:

1. **Conformance kits instead of trained models.** Ship small synthetic fixture repos per language/framework pairing, each with a known ground-truth interchange document. Any generated tool (rule pack, backend adapter, harness) must reproduce the ground truth before it is trusted — this is the eval the maintainer *can* own, because the fixtures are synthetic.
2. **In-repo invariants as per-team eval.** The coverage checks (§Tier 3b point 7 — contract↔code cross-checks, anchors-per-KLoC anomalies) evaluate extraction quality on the team's real code without anyone else seeing it. Empty-diff-on-unchanged-code (§6.2) is the stability eval.
3. **Benchmark escrow.** Teams that can share nothing else can still report conformance-kit scores and coverage metrics — enough signal to rank community packs without code leaving the building.

**Community contribution path** *(target state — gated per Scope discipline below; not part of v1)*. Corum already has pack registry/installer machinery (see `test/pack-registry.test.ts`, `pack-installer.test.ts`) — extraction packs should ride the same channel rather than a new one. The loop, once the gate is met:

1. Fingerprint → **check the registry first**; pull a community pack for the detected stack if one exists (zero synthesis cost).
2. Nothing found → synthesise locally (Tier 3a / backend bootstrap), use privately.
3. Upstream later: because every generated artifact is data + fixtures + conformance results, a contribution PR is reviewable by strangers. One skill step matters here: **fixture sanitisation** — fixtures derived from private code must be re-synthesised into neutral examples (rename domains, regenerate bodies, keep only the idiom shape) before leaving the repo. The skill should treat this as a hard gate on the contribution path, not an afterthought.
4. Registry packs carry `derivedBy` provenance and versioning like template packs, so a team can pin, audit, and diff what extraction logic they run.

**Scope discipline (post-review):** the registry, benchmark escrow, and community machinery are **explicitly out of scope until ≥3 external teams run the pipeline**. A three-sided platform proposed at one-maintainer capacity is the classic way to ship none of the sides. The skills v1 is two skills — `corum-extract-orientation` and `corum-sync-review` — with real acceptance tests; **they are the operating manual for the Phase 0.5/Phase 1 deliverables (§8), written alongside them, not a separate workstream** — Phase 3's "skills hardening" extends these two and adds the rest of the table, it does not create them. Backend-bootstrap runs as a *human-supervised* flow only in v1; extraction packs are repo-local. Note also that community rule packs, when they arrive, are a **code-execution-adjacent attack surface** (an agent acts on what a rule matches) — registry intake needs a security review bar, which is another reason to defer it. The skill table above is a scope sketch; requirement-grade delivery means each skill gets a spec with inputs/outputs, failure modes, and acceptance criteria.

Net effect, at target state: the maintainer maintains the skills, the contracts, the conformance kits, and (eventually) the registry; the community grows the per-stack coverage. That is the only shape of this that scales past one person — but it is grown into, not launched.

## 6. One-off generation vs continuous sync

### 6.1 Initial graph generation
- Run the full ladder against a **new design branch** (Corum already enforces import-to-branch on git sources). Expect the first run to be the expensive one: full SCIP index, full rule scan, the LLM working through the entire gap queue and synthesising rules.
- **Human curation is a first-class stage, not cleanup.** The output to review is not "the graph" but three ranked lists: low-confidence inferences, `gaps`, and possible-rename/dedup warnings the reconciler emitted. Review in the web UI on the branch; fix by `rename_node`/`update_node` (trails preserve identity for subsequent re-imports); then merge.
- Budget guidance: aim for the deterministic tiers to carry ≥80% of nodes and ≥60% of field lineage before any LLM call; if they don't, invest in rules (one-time) before spending tokens (recurring).

### 6.2 Continuous sync
Two cadences, both valid — choose per team:

- **Per-PR (recommended default):** an Action job on `pull_request` computes the *changed scope* — changed files → containing symbols → affected spine anchors via symbol-index reverse-references — and re-extracts **only those slices**, emitting a partial interchange doc (`partial: true`, §1a.4). It then runs the import in dry-run mode and posts the graph diff as a PR comment: "this PR adds field `refund_reason` to `orders.Schema.refund`; breaks `maps-to` from `billing.Schema.credit-note.fields.reason`". This is where Corum earns its keep: **design-vs-implementation drift surfaces at review time.** On merge to the code repo's main, the same scope is extracted and imported (committed) to the graph's designated branch; a human (or auto-merge policy for `determined`-only diffs) promotes it to the graph default branch.
- **Scheduled full runs (weekly):** a full-ladder pass catches drift the incremental scope missed (deleted code, moved files, rule regressions) and is the natural point to re-run expensive tiers (CodeQL lineage, dynamic confirmation). Because everything is memoised and the reconciler is idempotent, a full run on unchanged code should be cheap and produce an empty diff — the health check. (*Should*: this invariant currently fails on volatile-field noise — prerequisite §1a.7 — and must be made CI-enforceable before it can be trusted.)

> **Prerequisites for this section:** `--dry-run` (§1a.3), partial-import removal semantics (§1a.4 — without it, an incremental interchange doc marks all unchanged nodes from that source as removed), and graph-branch concurrency control (§1a.5 — concurrent PR merges are last-writer-wins today).

### 6.3 Developer environments vs ephemeral CI
One CLI (`corum extract` orchestrating the ladder, emitting interchange; `corum import` unchanged), one container image, three cache concerns:

| Cache | Dev machine | GitHub Actions |
|---|---|---|
| Symbol index (SCIP file or LSP-derived cache) | local dir, incremental | `actions/cache` keyed on lockfile+source hash; warm restores are minutes → seconds |
| LLM memo store + lineage trace graph (§4.7) | local dir | `actions/cache`, or committed to the graph repo (small, textual, auditable — committing makes runs reproducible across runners; weigh §7a(c) sensitivity first) |
| CodeQL DB (if used) | optional | `actions/cache`; rebuild on lockfile change |

Policy differences: on dev machines the agent may run interactively (ask the developer to confirm a synthesised rule); in CI it must be **non-interactive and budgeted** — a hard token ceiling per run (`--budget`, default 200k tokens ≈ single-digit dollars; per-PR runs should normally use zero), deterministic tiers always complete, and if the LLM budget is exhausted the run still succeeds, emitting the unprocessed queue as `gaps` (fail-open on enrichment, fail-closed on nothing). Secrets: the CI path needs only an LLM API key and the graph-repo token Corum already supports (`CORUM_GIT_TOKEN`).

### 6.4 Repo layout, tooling decisions, and CLI surface

Decisions an implementer would otherwise have to guess, made here once:

| Decision | Choice |
|---|---|
| Where `corum extract` lives | A workspace package in the corum repo (TypeScript orchestrator, same CLI entry as `corum import`), shipping as a container image that bundles ast-grep and per-language index tooling. Extraction logic that must be per-language (semantic backends) are separate processes the orchestrator drives over a small JSON-RPC contract — they can live in their own repos later without moving the orchestrator. |
| Rule engine (v1) | **ast-grep** — single binary, YAML rules, tree-sitter grammars for all six target languages, permissive licence. Semgrep/GritQL revisited only if ast-grep's pattern language proves insufficient; the rule-pack format carries an `engine:` field so this is not a one-way door. |
| Target-repo layout | `.corum/extract/` in the analysed code repo: `config.yaml` (source IDs, budgets, provider), `component-map.yaml` (§Tier 3 — prefix → component, human-committed), `rules/` (synthesised + adopted packs, with `fixtures/` beside each rule), `cache/memo/` and `cache/trace/` (gitignored by default; committable per §6.3). |
| CLI surface (v1) | `corum extract [--scope <paths/diff-range>] [--budget <tokens>] [--emit <dir>] [--no-llm] [--coverage]` → interchange docs + `gaps`; `corum import --config … -b <branch> [--dry-run]` unchanged. Provider/endpoint and `llm.mode` (frugal default vs coverage, §7a) live in `config.yaml`, not flags. |
| Conformance kit | One synthetic fixture repo per language/framework pairing with a committed ground-truth interchange doc; lives in the corum repo under `conformance/`; built in Phase 2 alongside rule synthesis (its first consumer). |

---

## 7. Token efficiency vs correctness — the explicit trade-off table

| Technique | Correctness | Tokens | Compute | Stability | Emit as |
|---|---|---|---|---|---|
| Contract adapters (Tier 0) | very high | 0 | trivial | perfect | determined |
| SCIP + rule-pack spine | very high | 0 | low (cached) | perfect | determined |
| Mechanical schema extraction | high | 0 | low | perfect | determined |
| Runtime schema dump (build harness) | very high | 0 | needs build | perfect | determined |
| Mapper-config lineage | very high | 0 | low | perfect | determined |
| Adjacent-layer dataflow + composition | high | 0 | medium | perfect | determined |
| CodeQL/Joern path queries | high | 0 | high (cached DB) | perfect | determined |
| Hungarian name/type matching | medium | 0 | trivial | perfect | inferred + score |
| LLM classification (closed set, memoised) | medium-high | low | — | high (memoised) | inferred |
| LLM rule synthesis | high (human-reviewed) | one-time | — | perfect after synthesis | (produces determined) |
| LLM slice lineage | medium | medium | — | high (memoised) | inferred + score |
| LLM slice lineage + self-consistency ×3 | medium-high | high | — | higher | inferred + score |
| LLM whole-file / whole-repo reading | low-medium | very high | — | poor | avoid |
| Dynamic/test-trace confirmation | very high | 0 | test-suite run | high | promotes to determined; **primary tier for cross-service edges (§4.7)** |

The "avoid" row is worth stating as a principle: **never pay tokens for discovery or for anything a symbol index answers.** The LLM's budget goes to judgment calls on pre-digested, content-hashed slices.

*(Caveat on the table's confidence: the deterministic-tier correctness grades are design expectations, not measurements — no prototype exists yet. The Phase 1 acceptance gates (§8) exist to replace these grades with numbers.)*

## 7a. Cost model and security posture

**Cost.** A strategy whose spine is a token/correctness trade-off needs order-of-magnitude numbers, produced empirically in Phase 1 and tracked thereafter. Placeholders to validate: an initial run on a ~500-KLoC repo should target the low tens of dollars of LLM spend (classification digests + gap queue + rule synthesis), not hundreds — if early measurements exceed that, the deterministic tiers are underdelivering and the fix is rules/backends, not bigger budgets. A per-PR incremental run should typically cost **zero tokens** (memo hits, no new gaps) and cents when a new slice needs judgment. CI enforces this as a hard per-run token ceiling (fail-open to `gaps`, §6.3); publish the measured numbers in the conformance kit docs so adopting teams can predict spend.

**Coverage mode — authorised LLM spend for improved coverage.** The defaults above are frugal (LLM as residue-handler, hard ceilings, fail-open to `gaps`) — right for cost-sensitive teams, but coverage is deliberately left on the table. Teams that treat LLM spend as an acceptable cost for coverage enable **coverage mode** (`config.yaml: llm.mode: coverage`, per-gap-class budgets), which changes behaviour in four ways:

1. **Escalation ladder per gap, not one attempt.** Each unresolved item climbs: digest-only classification → program slice → widened slice (whole file/module) → self-consistency ×3. Each rung is memoised independently; a gap that resolves at rung 2 never pays for rung 4. The frugal default stops at rung 2; coverage mode climbs until resolved or the per-class budget is spent.
2. **Batched gap resolution.** Gaps sharing context (same module, same schema pair-set) resolve in one call over a shared digest — batching typically cuts per-gap cost several-fold versus one-call-per-gap, and is what makes "work the whole queue" affordable on estates.
3. **Generator/verifier split.** For lineage and spine claims above a stakes threshold, a second, cheap verification pass checks the first pass's claim against the cited code (does line 41 actually assign this field?). Generation proposes; verification gates what enters the graph as higher-confidence `inferred`. This is the mechanism that lets extra spend buy *trustworthy* coverage rather than more guesses — without it, coverage mode just raises the volume of medium-confidence edges, which is counterproductive (see the trust failure mode, §4).
4. **Value-weighted triage.** Budget goes where `(confidence gap × architectural value)` is highest — cross-service schema pairs and contract-less endpoints first, internal utility types last — rather than queue order.

Two things coverage mode does **not** change: the honesty rules (LLM output is still `inferred` + confidence; the ratchet still applies; below-floor still emits `gaps`, though the floor may be lowered per class), and the stability machinery (memoisation and closed-set outputs apply at every rung). And one structural limit no budget removes: **cross-service lineage has no in-code ground truth** — coverage mode raises proposal quality there, but only dynamic confirmation (§4.6) can promote it to `determined`.

**Security / data egress.** §4.5 ships program slices of proprietary source to an LLM API from CI. This needs an explicit, per-team decision, not a default: (a) which provider/endpoint (including self-hosted or VPC-scoped models as a supported configuration); (b) slice minimisation as a *security* control, not just a token one — send the minimum resolving context, strip literals/secrets (a deterministic secret-scrubber pass over slices before dispatch is cheap insurance); (c) the memo store contains code-derived text — treat it with the same sensitivity as source when choosing where it's cached or committed; (d) CI secrets are limited to the LLM key and the graph-repo token Corum already supports. Fixture sanitisation (§5a) covers the community path; this paragraph covers the every-run inference path, which matters more.

---

## 8. Recommended architecture (concrete)

```
corum extract
 ├─ A. fingerprint        repo probe → capability profile           (det.)
 ├─ B. index              symbol index per language (SCIP or LSP;   (det.)
 │                        cached, incremental)
 ├─ C. spine              rule packs × index → anchors              (det.)
 │     └─ C'. rule-synth  LLM writes rules for unmatched idioms,    (LLM, one-time)
 │                        validates, commits to repo extraction pack
 ├─ D. schemas            serialization introspection / harness     (det.)
 ├─ E. lineage cascade    mappers → dataflow → [CodeQL] →           (det.)
 │                        Hungarian → LLM slices (memoised)         (prob.)
 ├─ F. enrichment         LLM classification/components/x-aka,      (LLM, memoised)
 │                        closed-set, budgeted
 └─ emit interchange docs (+ gaps) per component
corum import --config … -b <branch> [--dry-run]   ← existing pipeline
```

Phasing — the plan of record. Each phase carries an **acceptance gate with a measurement procedure** (a gate without a procedure is a vibe with a number). Prerequisite numbers refer to §1a.

- **Phase 0 — pipeline fixes (small, days):** `--dry-run` (§1a.3), partial-merge mode (§1a.4), empty-diff hygiene (§1a.7).
  *Gate & procedure:* import the same interchange doc twice on consecutive days (dev machine then CI runner); the second `--dry-run` reports zero adds/updates/removes. Enforced as a CI test using an existing Tier-0 adapter output as the input.
- **Phase 0.5 — contract-only MVP (the first user-visible win):** Tier 0 adapters (exist) + a GitHub Action that extracts contracts on `pull_request`, runs `--dry-run`, and posts the graph diff as a PR comment; merge-time import to a graph branch; curation in the existing web UI. **No code extraction, no LLM.** This ships the product moment — design-vs-implementation drift at review time — months before any extractor exists, and proves the sync loop in anger before the ladder depends on it.
  *Gate & procedure:* on a real service, an OpenAPI change in a PR produces a correct diff comment; re-running on the unchanged spec produces an empty diff; two near-simultaneous merges do not lose updates (Actions concurrency group, §1a.5 decision).
- **Phase 1 — the C# extractor:** ladder stages A–D + F for C# only (the Roslyn extractor is the measuring stick), node-properties passthrough (§1a.1a), provenance ratchet (§1a.2), memo store, deterministic IDs (§3.1 rule incl. the LSP normalisation), component-map flow, C# SCIP-vs-LSP bake-off (other languages' bake-offs happen at their adoption, not now), session-gated import (§1a.9), `x-aka` fixes (§1a.8) at exit. The two v1 skills (`orientation`, `sync-review`) are written as this phase's operating manual.
  *Gate & procedure:* run both extractors on the C# estate; match nodes by symbol name declared in `x-aka` (unmatched counts as a miss); require ≥85% node recall, ≥95% precision vs Roslyn; initial-run LLM spend within the §7a envelope, measured and published.
- **Phase 2 — lineage + adaptivity:** interchange 1b extensions (§1a.1b); lineage via **4.1 mapper configs + 4.4 spine-constrained matching** (both zero-token; per-language dataflow is *not* on this critical path — 4.2 arrives later as a sampled verifier), on the extractor-internal trace graph (§4.7); rule synthesis (Tier 3a) with its telemetry; conformance kit (first consumer is rule synthesis); entry-keyed dedup (§1a.6) when the second service starts emitting; second and third languages (rule packs + one semantic backend prototype end-to-end, replacing the §4a size guess with a measurement).
  *Gates:* lineage — calibrate the matcher against Roslyn's lineage as ground truth on the C# estate; require ≥60% recall at ≥90% precision from 4.1+4.4 (matching's error rate is measurable in advance — use that); below the precision bar, tighten margins/demotion before adding tiers; below the recall bar, that's the signal to fund 4.2/4.5. Rule synthesis — convergence per the Tier 3a falsification criteria (rules-per-repo stabilises, recall vs Roslyn ≥85%).
- **Phase 3 — the long tail:** LLM slice lineage with slicing infrastructure; optional CodeQL tier; dynamic confirmation hook in test CI (primary for cross-service edges); remaining skills specs hardened from the v1 two; community machinery *only if* the §5a scope-gate (≥3 external teams) is met.

If a phase gate fails, the previous phase is still a complete, shippable product — Phase 0.5 in particular is the explicit floor (§8a).

---

## 8a. Alternatives weighed (and what would change the plan)

- **Contract-only MVP.** Ship Tier 0 + per-PR dry-run diff + web-UI curation, build nothing else until it has users. Given Tier 0 plausibly yields 60–80% of the spine, this is most of the product value at ~10% of the cost. **Adopted — scheduled as Phase 0.5 (§8), the first shipped milestone and the explicit floor if later gates fail.**
- **"LLM drafts the whole graph from a repo map + docs; human curates; skip lineage automation."** Fastest time-to-first-graph; unbeatable for a one-off on a small estate. Rejected as the *default* because it fails requirements 2 and 6 (continuous sync and stability) — but it is the right mode for Tier-3 *enrichment* and for teams who only want the one-off.
- **LSP instead of SCIP.** Now incorporated as a first-class fallback with a mandated bake-off (Tier 1) — Kotlin's indexer gap makes this non-optional.
- **Runtime/observability-first lineage.** Now incorporated: promoted to the primary tier for cross-service edges (§4), where static analysis is structurally impossible rather than merely hard.
- **Buy/adopt.** Sourcegraph's code graph, Moderne/OpenRewrite's LST ecosystem (strong for Java/Kotlin rule-based extraction), and commercial codebase-mapping tools overlap with Tiers 1–2 but none emit design-graph semantics (templates, states, field lineage) or integrate with Corum's reconcile/branch model — adopt their *indexes* where possible (SCIP is Sourcegraph's format; OpenRewrite recipes could back the JVM rule tier) rather than their products. Revisit if any ships an open interchange comparable to Corum's.

## 9. Risks and open questions

- **Monorepos / component boundaries.** Fingerprinting must handle many components per repo and many repos per component; component assignment is the LLM call most likely to need human override — make it sticky (once curated, re-imports respect it via the reconciler's preserved fields).
- **Rule-pack governance.** Synthesised rules entering the repo need the same review bar as code; a bad over-matching rule pollutes the graph deterministically. Mitigation: rule validation harness (must match the exemplar set, must not exceed a match-count budget) before the agent may commit one.
- **`x-aka` lifecycle** (flagged in the code review §2.7): cross-source matching leans on `x-aka`, whose strip/keep semantics are currently inconsistent — worth fixing before multi-extractor imports become routine.
- **Same-adapter multi-source dedup** (code review §6.3): a fleet of services all emitting corum-interchange docs will hit the adapter-ID-keyed dedup limitation immediately; entry-keyed rules become a prerequisite for estate-scale sync.
- **Graph size.** Estate-scale continuous sync (10⁴–10⁵ nodes) will surface the indexing gaps noted in the code review (§3.2) — worth scheduling the `Graph` class/index work before the estate rollout, not after.

## 10. Bottom line

Adopt a **ladder architecture targeting the interchange format** (extended per §1a.1): contracts first — shipped alone as the Phase 0.5 MVP, which is the product moment (per-PR design-vs-implementation drift) at a fraction of the cost — then a symbol-index-plus-rule-pack mechanical spine and schema pass, then a lineage cascade (mapper configs → dataflow → optional CodeQL → optimal-assignment matching → LLM slices, with dynamic trace confirmation as the primary cross-service tier), with the LLM reserved for closed-set judgment on content-hashed slices and — most importantly — for **synthesising deterministic rules** so extraction converges toward zero-token, stable runs on any codebase. Provenance (`determined`/`inferred` + confidence) is the contract between tiers; Corum's reconciler (with the §1a.2 ratchet) is the sync engine. Deliver it as **skills plus contracts plus conformance kits** (§5a): the maintainer owns the methodology and validation gates, the agent builds per-stack tools under those gates, and the pack registry carries community contributions back once the scope gate is met. Keep the Roslyn extractor as the fidelity benchmark — every phase gate is measured against it — rather than the template for other languages.
