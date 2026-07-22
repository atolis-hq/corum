# Corum — Comprehensive Code Review

**Date:** 2026-07-12 · **Scope:** full codebase at `main` (19c109d) · **Reviewer:** Claude Code

This review covers correctness, simplification opportunities, schema/behaviour gaps, the node/edge structure, load/save, the import pipeline (including partial and multi-source imports), suitability beyond API/domain/event modelling, and "if starting again" guidance. File references are `path:line` against the current tree.

---

## 1. Overall assessment

The codebase is in unusually good shape for a young project. Strengths worth calling out explicitly, because they should be preserved through future changes:

- **Validate-before-apply discipline.** Every mutation primitive (`rename.ts`, `apply-cluster.ts`, `session.planEdge`) plans with pure reads and throws before the first write. This is consistently done and consistently documented.
- **Diagnostics-first loading.** Errors are collected, not thrown per-item; `strict` is a policy decision at the boundary. This is the right shape for a linter-backed design tool.
- **Role-based capability contract** (`src/graph/roles.ts`). Keying engine behaviour off `info.role` resolved through `extends` rather than template names is the single most important extensibility decision in the codebase, and it is applied consistently in the engine core.
- **Design-doc cross-referencing.** Comments citing "design §X" / ADR numbers make intent auditable. The ADR set is genuinely useful.
- **The git source** (`git-source.ts`) handles the hard cases: CAS retry on ref races, push-failure rollback of local refs, pinned-parent squash commits, in-process commit locks. This is careful work.

The main structural criticisms are: (a) **path-as-identity** creates a large compensating machinery (§8.1), (b) **edge index plumbing is duplicated four times** with no encapsulation (§3.1), and (c) the **import layer is hardwired to `Schema`/`fields`** in ways the engine core deliberately avoided (§6.4). (An earlier draft flagged comment loss on save as a fourth issue; the maintainer has confirmed graph YAML is machine-owned, so that is by design — see §5.2.)

---

## 2. Potential bugs

Ordered roughly by severity.

### 2.1 Round-trip data loss when one root ID prefixes another
*(Scope note: >3-segment root IDs are intended, and owned-child materialization from cluster YAML is the designed collapse/expand mechanism — this finding is only about the interaction between two independent **roots**.)*

`validateRootId` (`id-grammar.ts:39`) allows root IDs with more than 3 segments (e.g. `orders.Schema.foo.bar` is a legal root, and `clusterPath` in `graph-writer.ts:44` maps it to `components/orders/Schemas/foo/bar.yaml`). But `getRootNodes` (`graph-writer.ts:284-289`) classifies a node as a root only if no other node's ID is a dot-prefix of it. If both `orders.Schema.foo` and `orders.Schema.foo.bar` exist as independent cluster files, they load fine (no duplicate ID), but on save `foo.bar` is treated as a descendant of `foo` — and since it isn't reachable through `foo`'s owned sections, **it is silently dropped from the serialized output**. `getCluster` (`graph/index.ts:167`) has the same conflation: prefix scan pulls in the unrelated root as a "child".

*Fix:* since >3-segment roots are intended, detect roots via `parentId === undefined` (owned children always carry a materialized `parentId`; roots never do) rather than ID-prefix heuristics — in `getRootNodes` and anywhere else roots are inferred by prefix.

### 2.2 Duplicate edge IDs are not detected at load
`loadEdges` (`edge-loader.ts:96`) and the cluster/explicit merge in `loader/index.ts:44-45` never check whether an edge ID already exists. The same edge declared in two `edges/**/*.yaml` files — or an explicit `uses-type` edge duplicating a generated one — yields two distinct `Edge` objects with the same ID in both indexes. Downstream, `findEdgeById` returns whichever comes first, `delete_edge` removes only one instance, and summary counts double. The loader is strict about duplicate node IDs (`cluster-loader.ts:264`) but silent on edges. Add a seen-ID set and an error diagnostic.

### 2.3 File source silently ignores the requested branch
`FileGraphSource.loadGraphContent(_ref)` ignores the ref, and `startSession` (`session.ts:194-244`) only validates branch names for git sources (`create` and default-branch checks). Opening a session on a file source with `branch: 'feature-x'` succeeds, reads the default content, then **fails at commit** with `FileGraphSource only supports its local branch` (`file-source.ts:117`) — after the user has done the work. `startSession` should reject a non-default branch on file sources up front, mirroring the `create` check.

### 2.4 Import runner loads strict
`runImport` (`import/runner.ts:59`) calls `loadGraph({ source, ref })` without `strict: false`. A target graph with any error-severity diagnostic (e.g. one bad YAML file) makes the import **throw** instead of returning diagnostics like every other failure path in the runner. Either pass `strict: false` and surface the load diagnostics, or catch `LoadError` and convert it.

### 2.5 `extractedFrom` keyed on absolute spec path
`runImport` resolves `entry.spec` with `path.resolve` (`runner.ts:79`) and removal detection matches `node.extractedFrom === specPath` (`reconcile/index.ts:59`). Run the same import from a different working directory, a different machine, or after moving the spec file, and previously-imported nodes are never marked `removed` — they just go stale, and re-imported nodes may duplicate provenance strings. Store a stable, config-declared source ID (or the spec path as written in the config, normalized) instead of the resolved absolute path.

### 2.6 Soft delete leaves live semantic edges
`deleteNode` soft tier (`delete.ts:53-59`) sets `state: 'removed'` on the subtree but touches no edges. The removed nodes still participate in lineage, summaries (state filter aside), `get_cluster` expansion, and `buildExistingSchemaIndex` correctly excludes them — but edges *from other clusters into* the removed subtree keep `state: proposed` and are traversed by default. Consider cascading `state: removed` to touching explicit edges (mirroring how hard delete removes them), or at minimum filtering `removed`-state endpoints out of default lineage traversal.

### 2.7 Minor items
- **`get_template` ignores `branch`** while every sibling read tool supports it (`mcp/index.ts:332`). Harmless today (packs load from default), but the asymmetry will surprise someone.
- **`mutationTimestamp` is date-only** (`mutate/util.ts:4-6`). Two mutations on the same day are indistinguishable by `lastModifiedAt`; overlay/diff equality is unaffected (it excludes timestamps), but audit value is low. Consider full ISO timestamps — the "matches adapter mappers" convention can change in both places.
- **`getClusterView` inbound filtering hardcodes `reads`/`uses-type`** (`graph/index.ts:207`), duplicated in `getLineage` (`graph/index.ts:499`). See §7.2 — this belongs on `EdgeTypeDef`.
- **`deduplicateResults` strips `x-aka` from every result unconditionally** (`dedup.ts:101-105`) — but only when dedup rules exist. With no rules configured, `x-aka` lands in the graph as an undeclared property (lint warning noise) yet is also what `search_nodes --search_properties` matches on. The lifecycle of `x-aka` should be decided once: either always strip after import, or declare it.
- **`commitLocked` CAS is not atomic** (`git-source.ts:296-306`): a writer can move the ref between `resolveBranchOid` and `writeRef({force: true})`. isomorphic-git offers no compare-and-swap ref update, so this window is probably unavoidable; worth a comment noting the residual race, since the code reads as if the CAS closes it.

---

## 3. Simplification opportunities

### 3.1 Four copies of edge-index insertion, three of removal-by-id
`addEdge` in `cluster-loader.ts:272`, `edge-loader.ts:96`, `insertEdgeIntoIndexes` in `mutate/util.ts:44`, and `addEdge`/`removeEdge` in `schema-promotion.ts:109-119` all hand-maintain the `edgesByFrom`/`edgesByTo` pair. `import/runner.ts:138-145` inlines a fifth variant. Every future index (see §3.2) multiplies this. **Recommendation:** make `Graph` a class (or give it a companion module) with `addEdge`, `removeEdge`, `edgeById`, `allEdges` — then delete the duplicates. `isRecord` (3 copies), `clusterRootOf` (2 copies: `session.ts:706`, `apply-cluster.ts:331`), and `clusterPath`/`approxFilePath` (writer vs. linter) deserve the same treatment.

### 3.2 Missing indexes force O(N)/O(E) scans everywhere
- `findEdgeById` is a full scan (`mutate/util.ts:54`), called per edge inside create loops → O(N·E) for batch creates. An `edgesById: Map` fixes this and §2.2 simultaneously.
- Children are found by scanning all node IDs for a prefix: `getCluster`, `expandExternalNodes`, `sectionChildren`, `getDirectOwnedChildren`, `buildExistingSchemaIndex` all do it. A `childrenByParent: Map<string, string[]>` (already materialised as `parentId` on nodes!) removes five scan sites.
- `getRootNodes` (`graph-writer.ts:284`) is O(N²). With `parentId`, roots are just `parentId === undefined`.

None of this matters at hundreds of nodes; all of it matters at tens of thousands, which "model your whole estate's service architecture" implies.

### 3.3 MCP handler boilerplate
Every read handler in `mcp/index.ts` repeats the same 12-line pattern: `run(targetGraph)` closure, `hasBranch` → `withBranchGraph`, try/catch → `errorResult`. A single `withGraph(args, run)` wrapper collapses ~150 lines. The 26-case `switch` at `mcp/index.ts:1456-1509` can be `handlers[request.params.name]?.(args)` — the handlers object already has exactly those keys.

### 3.4 Structural edges are derivable — consider dropping them
`has-field`/`has-value` edges are generated from ownership (`cluster-loader.ts:192-201`), never serialized, filtered out of every user-facing view, endpoint-rewritten on rename "equivalent to regeneration", and containment is *also* encoded twice more (ID prefix + `parentId`). Meanwhile type-container/enum-container children get **no** structural edge at all (`STRUCTURAL_EDGE_BY_ROLE` covers only `field`/`value`), so consumers can't rely on structural edges for containment anyway. Either complete the set (a generic `owns` edge for every owned child) or — simpler — drop generated containment edges entirely and derive containment from `parentId` where needed. Three representations of the same fact is two too many.

### 3.5 `pendingChanges` diff cost
`snapshotNodes`/`snapshotEdges` JSON-stringify the entire graph at session start **and again on every `pending_changes` call** (`session.ts:517-529`). Fine today; a dirty-ID set maintained by the mutation primitives would be both cheaper and able to report *which* nodes changed, which is what a caller of `pending_changes` actually wants (counts alone are thin — see §4.5).

---

## 4. Schema & behaviour gaps

### 4.1 Property validation is shallow
The linter validates only top-level property types (`linter/index.ts:129-141`): no nested objects, no array item types, no `enum`, `pattern`, `minimum`, or `format` checks — even though templates *declare* `format: node-ref` and the loader acts on it. Notably, **`node-ref` properties are not validated to point at existing nodes**: a typo'd `x-request-schema` silently produces a dangling generated `uses-type` edge whose only symptom is the unresolved-node warning path never firing (generated edges skip edge lint via `edge.generated`). Given templates already use JSON-Schema-ish syntax, adopting a real (small) JSON-Schema validator plus a graph-aware `node-ref` rule would materially improve the "linter as design gate" story.

### 4.2 No state machine over `state`
`draft → proposed → agreed → implemented` reads like a lifecycle, but any transition is allowed anywhere, and nothing constrains edges between states (an `agreed` endpoint can `triggers` a `removed` event without complaint). If lifecycle is meant to carry governance weight, add lint rules: transition validity (warning), and cross-state edge sanity (e.g. `implemented` node referencing `draft` schema).

### 4.3 Search cannot find fields
`searchNodes` skips any node with a parent (`graph/index.ts:455`). "Where is the `customerId` field?" — a natural agent query — is unanswerable via `search_nodes`; the workaround is `get_linked_fields` or full cluster dumps. Consider an opt-in `include_children` flag, keeping roots-only as the default for token economy.

### 4.4 Diagnostics have no codes
Every diagnostic is free-text (`schema/index.ts:99-104`). There is no way to suppress a known-acceptable warning, gate CI on a rule subset, or track rule provenance (the ADRs define rule IDs like T-003/E-005 — they just never made it into the emitted objects). Add `code?: string` and thread the existing rule IDs through; it's cheap now and painful later.

### 4.5 Session journal has no per-entry inspection or undo
The journal records op summaries but `pending_changes` returns only counts plus summaries; there's no node-level diff and no way to revert a single journal entry short of `discard_changes` and replaying everything. For agent workflows (the primary consumer) a `pending_changes --detail` returning changed node IDs would prevent a lot of "discard and start over".

### 4.6 Edge multiplicity
Edge identity is `{from}__{type}__{to}`, so two same-typed edges between the same endpoints cannot coexist (e.g. an endpoint that `calls` another twice with different properties/notes). Probably an acceptable modelling constraint — but it's undocumented; state it in ADR-004b so it's a decision rather than an accident.

### 4.7 Template pack ergonomics
- Duplicate template names across packs silently last-write-win (`pack-loader.ts:73`); emit a diagnostic.
- `edge-types` constraints are nearest-declaration-wins with **no additive merge** (`roles.ts:53-66`): a child template adding one edge type must re-declare its parent's whole list. An `extends`-merging semantics (or an explicit `edge-types-extend:` key) would remove a real authoring trap.
- `getOwnedSections` (`pack-loader.ts:25`) treats *any* unreserved key containing `item-template` as an owned section — a typo'd section key is silently not-owned and its YAML content becomes an undeclared property. A template-schema check (the `template.schema.yaml` exists!) enforced at pack load would catch this.

---

## 5. Node/edge structure, load & save

### 5.1 Load pipeline — good, one wart
The pipeline (packs → clusters → edges → lint) is clean and well-layered. The wart: `loadClusters` computes `extractCorum(record.corum, record.properties)` **twice** per root (`cluster-loader.ts:79`) — trivial, but it's the kind of thing the spread-conditional idiom encourages; a local variable reads better. Legacy `previousNames` handling is spread across `extractCorum`, `stripLegacyBookkeeping`, and `stripOwnedSections`'s metadata set — worth consolidating behind one "legacy bookkeeping migration" function with a removal date.

### 5.2 Save: machine-owned YAML — accepted, and a simplification it unlocks
*(Confirmed with the maintainer: graph YAML is not hand-authored. Comment loss and the single consolidated edges file (`edges/corum.edges.yaml`) are acceptable by design — simplifying YAML management is preferred over supporting non-standard structure.)*

Given that, the remaining observations invert into simplification opportunities:

- **The `sourceContent` ordering plumbing can go.** `loadSourceClusterDocument`, `getOrderedOwnedSectionNames`, and the source-order preservation in `getDirectOwnedChildren` (`graph-writer.ts:130-215`) exist to keep diffs stable against externally-shaped files. With machine-owned YAML, canonical ordering (template-declared properties, then alphabetical; alphabetical children) alone produces stable diffs, and this plumbing — plus the `Graph.sourceContent` dependency in the writer — can be removed.
- **Every commit rewrites every cluster file** (`replaceGraphContent: true`). Canonical ordering keeps diffs small, but serializing only clusters whose nodes are in the session's dirty set would make graph commits reviewable and cheaper. Still worth doing; independent of the comment question.

### 5.3 The rename/alias machinery is correct but heavy
`rename.ts` + `alias.ts` + `resolveIncomingAliases` + overlay canonicalization is careful, well-tested-looking code — and all of it exists because IDs encode location (see §8.1). Within the current design, two observations:

- `resolveAlias`'s longest-prefix rewrite runs to fixpoint with a cycle guard — good — but `buildAliasMap` is rebuilt per resolver, per query call. Fine now; cache it on the Graph and invalidate on mutation once graphs grow.
- The `renamed-from` hidden-edge representation forces special cases in the loader (dangling `to` allowed), linter (live-`from` error rule), overlay (literal edge IDs), and serializer. A dedicated `aliases:` block in cluster metadata (the `corum.identity.previousIds` list *already exists* and carries the same information) could replace the trail edges entirely — the alias map can be built from `previousIds` alone. One representation instead of two.

### 5.4 Sources
`FileGraphSource.replaceGraphContent`'s temp-dir/double-rename swap with the git-root fallback is thoughtful crash-safety work. `GitGraphSource.buildUpdatedTree` has a known O(blobs × depth) TODO — fine. One gap: `head()` for file sources hashes the full content on every call, and the session calls it once per autosave checkpoint; acceptable, but note that file-source autosave + an external editor touching files mid-session will *not* be caught (the write-through path skips the moved-head check entirely, `session.ts:575-584`) — the external edit is silently clobbered by the next checkpoint. A pre-write head comparison in `record()` would close it.

---

## 6. Import pipeline

### 6.1 What's good
The runner's ordering is right and documented: adapt → dedup → alias-resolve → diff/merge nodes → merge edges → promotion rewrite → serialize → commit. Idempotent re-import against the target branch, rename-trail awareness (§6a), and the reuse-before-inline shared index threaded through `AdapterContext` are all genuinely sophisticated for an importer.

### 6.2 Partial imports: mostly sound, one semantic trap
Removal detection is scoped per `extractedFrom` spec (`reconcile/index.ts:57-64`), so importing spec A never removes spec B's nodes — correct partial-import semantics. The trap: **an entry that errors is skipped, but the run still commits the surviving entries** (`runner.ts:90-93` + unconditional commit at 155). If spec B's nodes referenced spec A's (edges), the committed graph carries dangling-edge warnings with no indication the run was partial. Recommend: summarize skipped entries in the commit message, and add a `--strict` mode that aborts the commit when any entry fails. A **`--dry-run` flag that prints the diff + diagnostics without committing** is the single highest-value missing import feature.

### 6.3 Multi-source imports: dedup is keyed too coarsely
`DeduplicationRule.primary/secondary` match **adapter IDs** (`dedup.ts:25-27`), not entries. Consequences: (a) two OpenAPI specs in one run cannot be deduplicated against each other; (b) with three adapters there's no rule chaining semantics (A>B, B>C). Since `EntryResult` already carries `specPath`, keying rules on entry identifiers (spec path or a config-assigned `name:`) is a small change that unlocks same-adapter multi-source estates — the common real-world case (many services, all OpenAPI).

Also: `x-aka` matching only tries `{component}.{template}.{alias}` (`dedup.ts:44-52`) — aliases can't cross components, which is exactly where naming drift between teams happens. Consider allowing fully-qualified aliases.

### 6.4 Schema-hardcoding undermines the role system
The engine core keys off roles; the import layer keys off literals: `parts[1] === 'Schema'` (`runner.ts:116`), `parts[1] !== 'Schema'` (`schema-promotion.ts:22`), `.endsWith('.schemas.' + name)` (`schema-promotion.ts:52`), the linter's inline-collision rule (`linter/index.ts:88-91`), and `create_fields`' hardcoded `schemas`/`fields` sections (`mcp/index.ts:730-740`). A pack introducing `AvroSchema extends Schema` gets correct *engine* behaviour (roles resolve) but is invisible to promotion, dedup indexing, and the collision lint. Parametrize these on `type-container` role + the owning template's declared section names.

### 6.5 Import bypasses the session/lint gate
`runImport` writes and commits directly, without `lintGraph` gating and without respecting an open working session — an import can move the branch head under a session with pending changes, whose commit then fails with "head moved" (the guard works, but the user experience is a surprise error). Running the import *through* a `WorkingSession` (start → apply → commit) would give imports the lint gate, journal, and moved-head semantics for free, and eliminate the second writer path. This is the "one writer" refactor I'd prioritize.

---

## 7. Suitability beyond API/domain/event modelling

Could Corum model infra topology, data-warehouse lineage, ML pipelines, org/capability maps? The core says yes; the edges of the system say not yet.

**What already generalizes:** pack-extensible templates and edge types with category-driven behaviour; roles instead of template names; the ID grammar (any containment hierarchy); state/stability as domain-neutral lifecycle; MCP tools that are template-agnostic.

**What blocks it:**

1. **The role vocabulary is closed** (`roles.ts:18`). A new domain gets exactly five roles; anything else has no engine behaviour hook. That's acceptable if roles are meant to be "engine capabilities" — but then document that packs *cannot* invent roles, and validate unknown `info.role` values (today a typo'd role silently means "no role").
2. **`reads`/`uses-type` directional traversal is hardcoded** in `getLineage` and `getClusterView` (§2.7). A warehouse pack's `feeds` edge can't opt into the same consumer-directionality. Move it to `EdgeTypeDef` (e.g. `traversal: outbound-only`) — the mechanism (`edge-types.yaml` with categories) already exists; this is one more field.
3. **The 3-segment root requirement forces a "component" concept** on every domain. For an org-chart pack, `component` is meaningless. Minor, but worth acknowledging in docs: the first segment is really "namespace".
4. **The import layer is REST/messaging-specific** (§6.4) — expected, since adapters are per-format, but the *shared* machinery (promotion, dedup index, collision lint) should not be.
5. **`create_fields` is a domain-specific convenience** hardcoding `schemas.fields`. Either generalize it via roles ("create children of role `field` under any type-container") or move it into pack-provided tool extensions if MCP tool surface ever becomes pack-driven.

Verdict: with items 2 and 4 fixed and 1 documented, a third-party pack for a genuinely different domain is realistic. Today it would work read/write but lose lineage ergonomics and all import intelligence.

---

## 8. If starting again

### 8.1 Separate identity from location
The single biggest structural decision to revisit. Node IDs are ownership paths, so **renames change identity**, and roughly 1,200 lines exist to compensate: rename cascade (`rename.ts`), alias maps and fixpoint resolution (`alias.ts`), trail edges with special loader/linter/overlay/serializer rules, `previousIds` bookkeeping and its legacy migration, import alias resolution (`resolveIncomingAliases`), rename-aware branch diffing, in-flight-drift warnings, and the trail-threshold soft/hard tier logic. A design with a stable node identity (short slug or content-addressed ID) plus a *separate* human path would delete most of that: renames become metadata edits, cross-branch diffing becomes trivial, and imports match on identity rather than path+alias heuristics. The cost — less-readable raw YAML and git diffs — is real, and ADR-001's Git-native readability goal is legitimate; a middle path is *keeping* path-shaped IDs but treating `corum.identity` (which already exists!) as the primary key, with the path as a mutable property. If Corum ever supports concurrent design branches at scale, this decision will be forced anyway; cheaper to take it early.

### 8.2 Make Graph an object, not a struct
Nearly every simplification in §3 follows from `Graph` being a bag of Maps that ten modules hand-manipulate. A `Graph` class owning its indexes (nodes, edgesById, edgesByFrom/To, childrenByParent, aliasMap with invalidation) with a small mutation API would shrink the mutation engine, eliminate the duplicated index code, fix the O(E) lookups, and make invariants (edge IDs unique, indexes consistent) enforceable in one place.

### 8.3 One write path
Three writers exist: the session, the import runner, and `saveGraph`. Fold imports into sessions (§6.5) and `saveGraph` into the source layer. Every atomicity/lint/head-moved guarantee then lives in exactly one place.

### 8.4 Schema-first parsing
Hand-rolled type guards (`isRecord`, `toStringArray`, `requireString`, per-field checks in `create_fields`) appear at every boundary. A single schema layer (Zod or similar) for cluster documents, templates, import configs, and MCP args would delete a few hundred lines, produce better error messages, and — for MCP — could *generate* the tool `inputSchema`s that are currently maintained by hand in parallel with the parsing code (a drift risk today: the schema says `create_fields` items require `type`, the parser enforces it, but nothing keeps them aligned).

### 8.5 Keep
The pack/role architecture, diagnostics-first loading, validate-before-apply, the session model with trail thresholds, and the ADR discipline. These are the right bones.

---

## 9. Prioritized recommendations

| # | Item | Kind | Effort |
|---|------|------|--------|
| 1 | Root detection via `parentId`, not ID prefix (§2.1) | Bug | S |
| 2 | Duplicate edge ID diagnostic + `edgesById` index (§2.2, §3.2) | Bug/perf | S |
| 3 | Import `--dry-run`; non-strict load; partial-run visibility (§6.2, §2.4) | Feature/bug | M |
| 4 | Reject non-default branch on file-source sessions (§2.3) | Bug | S |
| 5 | Entry-keyed dedup rules for same-adapter multi-source (§6.3) | Feature | M |
| 6 | `Graph` class consolidating indexes + edge helpers (§3.1, §8.2) | Refactor | M |
| 7 | Move `reads`/`uses-type` directionality onto `EdgeTypeDef` (§7) | Extensibility | S |
| 8 | De-hardcode `Schema`/`schemas`/`fields` in import + lint via roles (§6.4) | Extensibility | M |
| 9 | Run imports through the working session (§6.5) | Refactor | M |
| 10 | Diagnostic codes (§4.4) | Hygiene | S |
| 11 | Stable `extractedFrom` source IDs (§2.5) | Bug | S |
| 12 | Soft-delete edge handling (§2.6) | Behaviour | S |
| 13 | Deeper property validation incl. `node-ref` resolution (§4.1) | Feature | M |
| 14 | Drop writer `sourceContent` ordering plumbing; canonical ordering only (§5.2) | Simplification | S |
| 15 | Consider dropping generated structural edges (§3.4) | Design | M |

*(S ≈ under a day, M ≈ days.)*
