# Corum — Principal Engineer Review

**Date:** 2026-07-02
**Scope:** Full `src/` tree (loader, graph engine, source layer, MCP, web, adapters, import, reconcile, writer, pack manager), the `.corum/packs/*` template packs, `docs/tasks/*` roadmap, ADRs skimmed for intent. No changes made.
**Baseline:** branch `refactor/fable-review` @ 290d302; `npm test` → 546/546 pass.

> **Structure:** Part 1 is the code-level review. Part 2 evaluates the data model, template packs, and extensibility against the roadmap, and **revises three Part 1 findings** (C1 reframed → P2.2, C5 revised → P2.4, S1 clarified → P2.5) following clarification that graph files are machine-owned and humans interact via interfaces.

---

## Executive summary

Corum is a small (~8k LoC), well-layered, well-tested codebase with a clear separation between source acquisition (`src/source`), loading (`src/loader`), querying (`src/graph`), and presentation (MCP/web). The load pipeline, diagnostics-not-exceptions error model, and lean-by-default MCP output are all good decisions.

The critical problems are not in code quality — they are in **contract enforcement and the write path**:

1. The core engine is *not* template-agnostic in practice; template and section names from the domain pack are hardcoded throughout the query layer.
2. The node ID grammar (dots as hierarchy separators) is an unvalidated convention that several subsystems silently depend on and that imports can silently violate.
3. The git write path has data-integrity hazards: working-tree divergence on local commits, import being structurally broken for git sources, destructive full-graph rewrites on import, and no concurrency control.
4. `compact_keys` corrupts user data in MCP output.
5. Pack installation has a path-traversal vulnerability and no integrity verification.

None of these are hard to fix now; all of them get much harder once external packs and multi-writer usage exist.

---

## Critical issues

### C1. Template-agnosticism is violated in the core engine

The stated design is "core system is template agnostic; template packs define type schemas". In practice the graph/query layer hardcodes the domain pack's vocabulary:

- `src/graph/index.ts:16` — `STRUCTURAL_NODE_TEMPLATES = new Set(['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping'])`
- `src/graph/index.ts:149` — `DATA_NODE_TEMPLATES = new Set(['Schema', 'EnumDefinition'])`
- `src/graph/index.ts:261` — `getLinkedFields` matches `node.template === 'Field'` literally
- `src/graph/schema-collapse.ts` — regexes hardcode section names `schemas`, `enums`, `fields`, `values`, `mappings` and the five template names
- `src/web/server.ts:145-163` — `resolveNodeRef` hardcodes `#/schemas/`, `#/enums/`, `#/mappings/` prefixes
- `src/web/server.ts:441` — `GRAPH_EXCLUDED_TEMPLATES` duplicates the same list

**Consequence:** a third-party pack that defines its own owned sections (the core extension story) gets none of the engine's behaviour — no schema collapse, no structural/semantic classification, no linked-fields, wrong orphan counts. The extensibility promise only holds for packs that reuse the domain pack's exact names.

**Recommendation:** the information already exists in templates — `ownedSections` (via `item-template`) tells the loader exactly which templates are structural children and which sections own them. Add explicit template metadata (e.g. `info.role: structural | data | operational`, or `collapse: true` on owned sections) and derive every one of these sets from loaded templates at load time.

> **Refined in P2.2:** engine special-handling of core concepts (schemas, fields) is *acceptable and necessary* — the defect is the encoding, not the privilege. The acceptable/unacceptable split: knowledge must be (1) declared once, (2) matched inheritance-aware (`is-a Field` via extends chain, not name equality), (3) keyed by declared capability (template metadata), never by section-name string literals.

### C2. Node ID grammar is an unvalidated, load-bearing convention

IDs like `orders.DomainModel.order.schemas.order.fields.id` encode the parent chain, but nothing validates this grammar:

- The loader accepts any string as a cluster root `id` (`src/loader/cluster-loader.ts:41`) — a 2-segment or dot-free root loads fine.
- `findParent` (`src/graph/index.ts:286`) walks up in strict 2-segment strides; a local name containing a dot breaks parent resolution, lineage `parent` hops, navigation ownership, and orphan detection.
- `graph-writer.ts:45` **throws** (not a diagnostic) on any root ID with fewer than 3 segments, and derives file paths by naive pluralisation (`${template}s`).
- `dedup.ts:44-46` assumes `parts[0]` = component, `parts[1]` = template.
- OpenAPI import derives IDs from `operationId` (`adapters/openapi/mapper.ts:143,156`) with no sanitisation — dotted operationIds (`orders.getOrder` is a common style) silently produce IDs that corrupt the hierarchy.
- Cluster membership is prefix-scan based (`getCluster`, `expandExternalNodes`, `getDirectOwnedChildren`), so any independently-authored root whose ID happens to extend another root's ID + `.` is silently absorbed as a child.
- Edge IDs use `__` as a separator with no reserved-character rule for node IDs either.

**Recommendation:** define the ID grammar once (allowed characters per segment, reserved separators, minimum shape for roots), validate it in the loader (diagnostic) and in adapters (sanitise + diagnostic), and add a fixture test. Longer term, consider materialising `parentId` on `Node` at load time so consumers stop re-deriving structure from strings — half the string-walking code (findParent, getNavigationOwnership, getDirectOwnedChildren) disappears.

### C3. `compact_keys` corrupts user property data

`compactKeys` (`src/mcp/serializers.ts:79`) recurses into **all** nested objects, including `node.properties`, which are user-authored. Any property key that collides with the compact map is renamed in output: `type→ty`, `id→i`, `notes→nt`, `version→v`, `from→fr`, `state→s`… Field definitions almost always contain `type`, so practically every compact response mangles schema data, and an agent reading it will learn wrong property names.

**Recommendation:** stop recursion at the `properties` boundary (compact envelope keys only), or key-map schema-aware. Add a regression test with a property literally named `type`.

### C4. Git write path integrity hazards

Several distinct problems in `src/source/git-source.ts` and the import pipeline:

1. **Working-tree divergence (local repos).** `commit()` writes blobs/trees/commit and force-moves `refs/heads/<branch>` (`git-source.ts:234`) without touching the index or working tree. If the user has that branch checked out — the normal case for `CORUM_GIT_LOCAL_PATH` — their checkout silently diverges: `git status` shows phantom reversals of Corum's changes, and a naive `git add -A && git commit` undoes them. Either refuse to move a currently-checked-out ref, update the worktree/index too, or document loudly and write via a temp branch.
2. **Import is structurally broken for git sources.** `runImport` commits to the default branch (`src/import/runner.ts:79-84`), but `GitGraphSource.commit` throws `cannot commit to default branch` (`git-source.ts:195-197`). So `corum import` can only ever work against `FileGraphSource`. Either imports need a target-branch concept or the default-branch policy needs an explicit carve-out.
3. **No concurrency control.** Parent SHA is read, then the ref is force-written later; two concurrent writers (two MCP sessions, or MCP + poller) lose one write silently. Use a compare-and-swap on the ref (check `oldValue` before `writeRef`) and retry.
4. **Push-failure divergence.** For remote sources, the local ref is advanced before `push`; a failed push throws but leaves the cached clone's ref diverged from `refs/remotes/origin/*`, and `resolveBranchOid` prefers the remote ref — the committed data becomes invisible on next read.
5. **Shared clone cache without locking.** `GitCacheManager` keys by URL hash under `~/.config/corum/cache`; concurrent processes fetch/clone the same dir with no lock, and the recovery path is `rmSync` the whole cache mid-use (`git-cache.ts:39`). Also `fetch` never prunes, so deleted remote branches keep appearing in `listBranches` forever.
6. **`FileGraphSource.commit` never commits.** The TODO at `file-source.ts:104` is honest, but it means the flagship "the Git repo *is* the database" property doesn't hold for the default filesystem workflow — writes have no history, no atomicity, and `replaceGraphContent` does an `rmSync -rf` of the graph dir (`file-source.ts:96`) before rewriting, deleting any non-YAML files a user kept there. A crash between delete and rewrite loses the graph.

### C5. Import rewrites the entire graph and destroys human file organisation

> **Revised in P2.4:** graph files are machine-owned by design (humans use interfaces), so the formatting/organisation concern below is withdrawn and whole-graph rewrite is an acceptable strategy. What survives of this finding: non-deterministic property key ordering (spurious diffs), the file-source `rmSync` crash window, non-YAML file deletion, and the node-identity problem when promoting a local schema to a shared file. See P2.4 for the revised recommendations.

`runImport` serialises the whole in-memory graph and commits with `replaceGraphContent: true` (`runner.ts:78-84`). The writer:

- regenerates every cluster file at a computed path (`components/{component}/{Template}s/{name}.yaml`), discarding wherever the human actually put it;
- collapses **all** explicit edges into a single `edges/corum.edges.yaml` (`graph-writer.ts:37`), destroying any per-domain edge file organisation the docs advertise (`edges/**/*.yaml`);
- loses all YAML comments and formatting graph-wide, not just for imported nodes.

For a design tool whose repo is meant to be co-owned by humans and agents, one import turning every hand-crafted file into machine output is a serious adoption blocker, and it makes import diffs unreviewable (everything changes).

**Recommendation:** write only clusters actually touched by the import; preserve source file paths for loaded nodes (the loader already knows the file each cluster came from — carry it on the node/cluster); keep explicit edges in their source files; consider the `yaml` package's Document API for comment/format-preserving round-trips.

### C6. Pack installer: path traversal and no integrity verification

`installPackFiles` (`src/pack/installer.ts:31-38`) iterates `meta.files` from the **remotely fetched** `pack.yaml` and writes to `path.join(destDir, filePath)` with no sanitisation — a malicious or compromised pack can use `../../` entries to write anywhere the user can (e.g. drop a `.git/hooks/post-checkout` or overwrite `~/.bashrc`). The same gap exists for `meta.templates` names.

There is also no integrity story: no checksums, no signature, no pinned content hash in `packs.yaml` (only a ref), and `resolveRef` trusts `tags[0]` from the GitHub tags API as "latest" (unordered guarantee).

**Recommendation:** reuse the key-validation logic that already exists in `file-source.ts:resolveContentPath` for every written path; record a content hash at install time and verify on reinstall; treat this as a blocker before promoting the pack ecosystem.

---

## Significant improvements

### S1. Templates are always loaded from the default branch

> **Clarified in P2.5:** branch loading itself works as intended — default branch always loads, additional branches load as full graphs on top, overlay composes. This finding is only about the *template/pack* layer.

`loadGraph` loads packs from `defaultRef` regardless of the requested `ref` (`src/loader/index.ts:32`), and `GitGraphSource.loadPackContent` ignores its `ref` parameter entirely (`git-source.ts:134`). A design branch that adds or evolves a template cannot be loaded, overlaid, or diffed — which undercuts the branch-based design workflow, since template evolution is exactly the kind of change you'd trial on a branch. If this is intentional (template stability across overlay), document it in an ADR and validate that branch clusters don't reference templates missing from the default branch; otherwise load packs per-ref. Options weighed in P2.5.

### S2. MCP runtime: staleness, per-call multi-graph loads, and coupled web server

- `startMcpServer` loads the graph once; without `--watch`, every subsequent edit is invisible until restart. Worse, a load failure at startup poisons the server permanently (`loadError` checked on every call, never retried — `mcp/index.ts:930`). Fix the YAML file and the server still refuses; retry the load on next call instead.
- `createMcpHandlers` is constructed **without** a `MultiGraphCache` (`mcp/index.ts:887`), so every branch-scoped tool call (`branch:` arg, `list_branches`, `diff_branch`, overlays) runs `loadMultiGraph` — loading *all* branches — from scratch. The cache type exists and the web server builds one (`web/server.ts:728`); wire the same cache into the MCP handlers and invalidate it from the watcher/poller.
- MCP starts the web server by default; if port 3000 is taken (a second agent session), `startWebServer`'s promise rejects and the **MCP server fails to start**. Default to `port: 0` or degrade gracefully when the port is busy.
- `replaceGraph` (`web/server.ts:247`) doesn't carry `sourceContent` across reloads; the writer's `buildGraphYaml` depends on it, so a post-reload save can regress `graph.yaml` to `templatePacks: []` — which would orphan the pack registration.

### S3. Edge handling: duplicates and dangling references

- `edge-loader.ts` never deduplicates: the same edge declared twice (or in two files) is stored twice. Duplicate IDs then double-count in `get_graph_summary`, appear twice in outputs, and undermine the overlay/diff code that assumes edge IDs are unique per graph. Dedup by edge ID with a warning diagnostic.
- Generated `reads` edges from `node-ref` properties (`cluster-loader.ts:69-79,182-196`) are never validated against the node map — typo'd refs produce permanently dangling edges that are silently pruned by lineage and skew orphan/edge counts. Emit a warning for unresolved node-refs (the edge loader already does this for explicit edges).
- The "structural" edge-type set is defined three times with **different membership**: `graph/index.ts:15` includes `renamed-from`; `graph-writer.ts:21` and `import/runner.ts:57` don't. Centralise in `loader/constants.ts`.
- Explicit-edge `state`/`stability` are cast unchecked (`edge-loader.ts:60-61`), unlike nodes; and node-side invalid values are silently defaulted with no diagnostic (`asState`) — a typo like `state: aggreed` vanishes. Warn on both.

### S4. Import provenance uses machine-local absolute paths

`runImport` resolves specs to absolute paths (`runner.ts:36`) and bakes them into `extractedFrom`, which is committed into the shared graph. Removal detection compares `node.extractedFrom === specPath` (`reconcile/index.ts:45`), so the same spec imported from a different machine/checkout path matches nothing: previously imported nodes are all treated as stale candidates and the incoming ones as fresh. Store a repo-relative or logical source identifier instead.

Related reconcile issues:
- `nodesEqual` uses `JSON.stringify` (`reconcile/index.ts:68`) — key-order-sensitive, causing spurious updates.
- Removed-from-spec nodes are kept forever as `state: removed` with no purge path; over time the graph accretes tombstones. Define a lifecycle (e.g. purge tombstones older than N imports, or a `corum gc`).

### S5. Overlay computation is O(E²) per branch

`computeOverlay` calls `findEdge` (linear scan of every edge list) for every edge ID across branches (`graph/overlay.ts:41,156`). Fine at 45 fixture edges; painful at 10k. Build a `Map<edgeId, Edge>` per branch once. Similarly, `getCluster`/`expandExternalNodes`/`getLinkedFields`/`getDirectOwnedChildren` all do full `nodesById` prefix scans per call — a parent→children index built at load time makes these O(children) and removes the string-prefix collision risk noted in C2.

### S6. No property validation against template schemas

Templates define JSON-Schema-like `properties`, and the loader uses them for `node-ref` edge inference — but node properties are never validated against them. A design/documentation tool should tell you when a cluster sets `descripton:` or gives a number where the template expects a string. ADR-006 (linter) covers this; it's the highest-leverage unbuilt feature for both human and agent authors, and the diagnostics channel to surface it already exists. Similarly, MCP tool arguments are hand-parsed with permissive casts (`String(args.node_id)` turns a missing arg into the literal id `"undefined"`); a schema validator (zod/ajv) on both would harden the agent interface cheaply.

### S7. Template pack loading edge cases

`src/loader/pack-loader.ts`:
- **Name collisions across packs silently overwrite** (`templates.set`, line 73) — last pack wins with no diagnostic. Fatal for an ecosystem of third-party packs; at minimum warn, better namespace by pack.
- A template with `extends: base` gets an `extends references unknown template` error, because `base` is pulled out of the map (line 71) — inconsistent with the implicit base inheritance every template receives.
- `topoSortTemplates` has no cycle detection; a cycle silently yields a partial order rather than a diagnostic.
- Property inheritance nests `allOf` one level per generation but `getPropertySchemasFromTemplate` in `cluster-loader.ts:86` and its **duplicate** in `web/server.ts:165` handle recursion — dedupe these into one shared helper.

### S8. Web/API hardening and duplication

- Express listens on all interfaces with no auth; `POST /api/reload` is unauthenticated, and several handlers return `String(err)` bodies. For a local tool this is acceptable *if* it binds `127.0.0.1` — make that the default.
- `resolvePackDirs` is implemented twice (`file-source.ts:75`, `web/server.ts:261`); route handlers repeat the same query-param parsing ~8 times — extract helpers.
- The UI ships JSX transpiled in-browser via Babel standalone (`text/babel`), fine for now but worth an ADR note on the production path.

### S9. `src/mcp/index.ts` structure

At 981 lines it mixes tool JSON-schema definitions, arg parsing, response shaping, handler logic, and server bootstrap. Each of the 12 handlers repeats the same `hasBranch → withBranchGraph / try-catch → formatResult` scaffold (with small inconsistencies — `list_nodes` and `get_linked_fields` don't guard `source` the way the others do). Extract: a `defineTool({schema, handler})` registry that centralises branch resolution, error handling, and formatting; move schemas to a sibling file. This also removes the hand-maintained switch at line 936.

---

## Minor observations

- **Repo hygiene:** a malformed directory named `C:gitatolis-hqcorumdocssuperpowersplans` (a Windows path with separators stripped) sits at the repo root — created by some tooling bug; delete it. `output/` and `tmp/` at root are untracked working residue.
- `GitGraphSource.defaultBranch` swallows all errors and silently falls back to `'main'` (`git-source.ts:74`) — a broken repo config manifests as an empty graph rather than an error.
- `FileGraphSource.loadGraphContent` ignores its `ref` parameter — the `GraphSource` contract implies ref-addressability the implementation doesn't provide; document or split the interface.
- `buildMappingField` (`schema-collapse.ts:216`) recurses on nested mappings with an explicit "no recursion guard" comment — a cyclic `$ref` is a stack overflow; a `seen` set is two lines.
- Overlay `nodesEqual` ignores `schemaVersion` — a branch that only bumps schema version reads as `shared`. If intentional, comment it.
- CLAUDE.md documents the test suite as expecting exact fixture counts ("45 nodes, 38 edges") — magic-number coupling that makes fixture evolution noisy; prefer targeted assertions.
- `resolveRef` treats GitHub `/tags[0]` as latest — ordering isn't semver-guaranteed; sort tags or use the releases API.

---

## What is working well

Worth preserving as the codebase grows:

- **Layering is genuinely clean**: source → loader → graph → presentation, with `GraphSource` as a proper seam (tests exploit it well).
- **Diagnostics-instead-of-exceptions** load model with `strict` escalation is the right shape for a lint-heavy future.
- **Test discipline**: 546 tests across every layer, adapters and reconcile included, running on the plain Node test runner with no framework weight.
- **Token-economy focus in MCP** (lean defaults, `include_*` opt-ins, TOON) is well judged for the agent-first goal — once C3 is fixed.
- ADRs exist and are current enough to review against; keep requiring them for core-abstraction changes.

## Suggested priority order

*(Revised after Part 2 — C5 downgraded, edge extensibility added as the roadmap unlock.)*

| # | Item | Why |
|---|------|-----|
| 1 | C6 pack installer traversal | Security; cheap fix; blocks the pack ecosystem and becomes RCE once `customui.md` ships |
| 2 | C3 compact_keys corruption | Silent data corruption in the primary agent interface; cheap fix |
| 3 | C4 write path (import-vs-git contradiction, worktree divergence, CAS, file-source commits) | Prerequisite for `mcpwritetools.md`; every hazard becomes agent-triggered once MCP can write |
| 4 | C2 ID grammar validation (+ containment edges / `parentId`, P2.3) | Every month of un-enforced convention adds more string-walking code; prerequisite for multi-repo |
| 5 | **Edge extensibility: pack-declared edge types + edge properties (P2.1)** | The single unlock for BDD, user journeys, delivery view, collaboration, thread primitives |
| 6 | C1 capability-driven core types (per P2.2) | Must land before third-party packs exist; pairs naturally with #5 |
| 7 | S6 linter (ADR-006) + edge-type enforcement | Highest-leverage new capability; foundation for write tools |
| 8 | S2 MCP cache/staleness | Direct agent-experience win |
| 9 | P2.4 save determinism (canonical key order + idempotence test) | Makes git diffs the audit log; cheap insurance |

---
---

# Part 2 — Data model evaluation and follow-up (same date)

Follow-up covering the template packs themselves, the extensibility question, loading/edge-inference, and revisions to C5/S1 in light of clarified intent (graph files are machine-owned; humans use interfaces). Grounded against `.corum/packs/*` and the roadmap in `docs/tasks/`.

## P2.1 Is the data model sound and genuinely extensible?

**Verdict: the node-side model is sound and genuinely extensible. The edge-side model is not — it is the single biggest constraint on the roadmap.**

What's good, and worth stating explicitly because it should be protected:

- The **template + owned-sections composition** is the right kernel. `_base.yaml` giving every node `schemas`/`enums`, packs adding their own sections (`invariants`, `operations`), and `item-template` driving materialisation means a new node type costs one YAML file and zero engine code. The domain pack already proves this: `Invariant` and `DomainOperation` exist with no engine knowledge of them.
- The **Field grammar** (`type` XOR `$ref`, `node-ref` format, local `#/section/name` vs global ID resolution order) is well-designed and documented *in the templates themselves* — the templates double as agent-readable documentation, which is exactly right for an agent-first tool.
- ID-encoded ownership + typed edges + git branching is a defensible substrate. Field-level lineage with branch overlay is the differentiator vs Structurizr/C4 (architecture level only), Backstage (catalog, not design), and EventCatalog (docs, not graph).

**Extensibility test against the stated ambitions** (BDD, user journeys, process managers, internal services, event modelling, UI layers — cross-checked with `docs/tasks/bdd.md`, `userjourneys.md`, `deliveryview.md`, `collaboration.md`):

| Ambition | Expressible today? | What's missing |
|---|---|---|
| Internal services, process managers, use cases | **Yes** — plain new templates + existing edge types (`triggers`, `calls`, `produces`) | Nothing structural |
| BDD (Feature → Scenario → Given/When/Then) | Node shapes yes (owned sections nest fine) | `references`/`covers` edge types; node-refs *inside* text; data-table↔schema linting |
| User journeys / event modelling swimlanes | Nodes yes | Ordering semantics; edge properties; a `precedes`-style edge type |
| Delivery overlay (epics/stories on nodes, field-level) | **No** | Cross-cutting annotation mechanism (see gap 4) |
| Collaboration threads, review workflow, thread primitives | **No** | Same annotation mechanism |
| UI layer (screens, components, `calls` endpoints) | Yes for modelling | `customui.md` (pack-shipped JSX) turns C6 into remote code execution — needs a trust model before packs ship executable UI |

**The five gaps that block the table above:**

1. **Closed edge-type vocabulary.** `EdgeType` is a TS union (`schema/index.ts:5`), mirrored in `VALID_EDGE_TYPES` (`loader/constants.ts:18`) and again in `mcp/index.ts:52`. Packs cannot add edge types, yet every roadmap item above needs at least one new type. This is the #1 unlock: make edge types pack-declarable, with each type declaring a core **semantic category** (`structural | semantic | lineage`) so engine behaviour (lineage defaults, summary counting, collapse filtering) keys off category rather than a hardcoded name list. Note the template `edge-types:` blocks are currently *unenforced documentation* — nothing validates an edge against its endpoints' declared types — and two templates (`Command.yaml`, `Event.yaml`) use the key `edges:` instead of `edge-types:`, which is silently dead either way. Enforcement belongs in the linter (`docs/tasks/linter.md`).
2. **Edges carry no properties.** Only `notes`/`state`/`stability`. Journey step ordering, BDD table bindings, delivery annotations, and cardinality all want attributed edges. Add `properties: Record<string, unknown>` to `Edge`, validated against the pack-declared edge type's schema.
3. **No ordering primitive.** Owned sections are YAML maps; insertion order survives load in practice (JS object key order), but nothing *declares* a section as ordered, and nothing preserves it as a contract. Journeys and scenarios are sequences. Either allow array-shaped owned sections or an `ordered: true` marker on the section declaration.
4. **No cross-cutting annotation/decoration.** Templates use `additionalProperties: false` (correctly — it keeps authored data honest), which means a delivery pack cannot add `story:` to a `DomainModel` node, and cluster files are single-owner so two packs can't co-write one file. Delivery view, collaboration, review workflow, and PDR thread primitives all need to attach data to nodes they don't own. The clean mechanism already almost exists: **annotation nodes in their own clusters, edge-linked to targets** (works at field granularity because fields are addressable nodes) — it's only blocked by gap 1 (needs an `annotates`/`delivers` edge type). Prefer that over property-namespace escape hatches.
5. **No node-refs inside text.** `bdd.md`'s `Given a {domainModel} exists` needs interpolated references within strings. Today `format: node-ref` applies to whole values only. A `node-ref-template` string format (`{...}` placeholders, each producing an inferred edge) answers the open question in `bdd.md` directly — and no, the current vocabulary has no suitable edge type for it (gap 1 again).

Fix 1+2 (edge vocabulary + edge properties) and 4 falls out nearly for free; 3 and 5 are additive. That is the short path from "REST/messaging/DDD modeller" to "general design graph".

## P2.2 Hardcoded template names — what's acceptable and what isn't

The engine genuinely does need privileged behaviour for a kernel vocabulary — schema collapse, field-level lineage, and lean MCP output are *features*, and they can't be expressed without the engine knowing "this node is a field-like thing". Having a core pack the engine understands is normal and acceptable. The problem is *how* that knowledge is encoded. Three criteria separate acceptable from not:

1. **Declared once, not scattered.** Today the knowledge lives in ≥6 places with three *divergent* structural-edge-type definitions (`graph/index.ts:15` includes `renamed-from`; `graph-writer.ts:21` and `import/runner.ts:57` don't).
2. **Inheritance-aware matching.** Every check is name-equality (`node.template === 'Field'`). A pack that does `AvroSchema extends Schema` — the *intended* extension mechanism — gets none of the engine behaviour. Matching should be "is-a Field via the extends chain".
3. **Behaviour keyed by declared capability, not by name.** The worst instances aren't template names at all, they're **section-name literals**: `schema-collapse.ts` regexes (`^schemas\.`, `\.fields\.`, `\.values\.`) and `web/server.ts` ref prefixes (`#/schemas/`, `#/enums/`, `#/mappings/`) re-derive structure from strings when the template's `ownedSections` already states it authoritatively. A pack that owns fields under a differently-named section silently breaks collapse.

So the concrete answer to "is knowing about schemas and fields acceptable?" — **yes**, keep special handling; move the trigger from name-matching to template metadata. E.g.:

```yaml
# Field.yaml
info:
  role: field          # engine: lineage-atomic, collapsible
# Schema.yaml
info:
  role: type-container # engine: collapse owned fields, expand as data node
```

plus, on owned-section declarations, the structural edge to generate (replacing the hardcoded `STRUCTURAL_EDGE_BY_ITEM_TEMPLATE` map in `constants.ts:35`, which today only covers `Field`/`EnumValue`).

**Is the intention to enable additional structural types?** The template format already implies yes — any template may declare owned sections with any item-template — but the engine only half-honours it: unknown owned children get ID-containment but **no structural edge and no collapse**. If BDD steps, journey stages, or UI widgets are to be structural children (they should be), the role-metadata approach above is precisely what makes "add a structural type" a pack-only change. Recommendation: yes, commit to it; it converts C1 from "remove hardcoding" into "define the capability contract", which is the more valuable framing.

## P2.3 Data loading and edge inference — assessment

Reviewed in full (round 1 covered it; consolidated here). The pipeline (packs → topo-sorted inheritance → cluster materialisation → explicit edges) is clean and the diagnostics model is right. Specific findings on the *inference* layer:

- **Inference today is narrow:** (a) `node-ref` properties → `reads` edge attached to the *cluster root* (coarse but defensible — documented rationale would help), and (b) containment edges for `Field`/`EnumValue` only. Owned children of every other template (`Invariant`, `DomainOperation`, inline `Schema`s) get **no containment edge at all** — ownership is only recoverable by string-walking IDs, which is what couples half the codebase to the ID grammar (C2). Materialising a containment edge (or a `parentId` on `Node`) for *all* owned children removes that coupling and makes lineage's special-cased `parent` hop (`graph/index.ts:543`) ordinary edge traversal.
- **Local refs produce no edges.** `#/schemas/x` field refs are resolved for display in the web layer (`resolveNodeRef`) but the loader emits nothing — intra-cluster field→type relationships are invisible to lineage and to `get_linked_fields`. Worth generating as scoped edges at load.
- **Generated `reads` targets are never validated** → silent dangling edges (round 1, S3).
- **`edge-types` constraints unenforced** → linter scope (`docs/tasks/linter.md`, priority 3 — correct priority).
- Dedup of explicit edges and the O(N) per-cluster prefix scans stand from round 1 (S3, S5).

## P2.4 C5 revised — machine-owned files and save-out determinism

Given the clarified stance (humans interact via interfaces, never the files), C5's "destroys human formatting" concern is withdrawn; whole-graph rewrite is an acceptable strategy. The remaining question — *"is it safe to assume the graph saves out consistently for minor changes?"* — is **almost yes**, with four caveats to close:

1. **Property key order is not canonicalised.** The writer sorts files, root nodes, children, and edges by ID (good), but `properties` serialise in in-memory insertion order. Load→save round trips are stable, but the import merge paths (`reconcile/index.ts:59-64`, spread-merges) can permute keys → spurious whole-file diffs for semantically identical data. Fix: canonical property ordering at serialisation (template-declared order, then alphabetical). Cheap, and it makes git diffs the audit log they're meant to be.
2. **Git-source saves are naturally minimal** — identical content produces identical blob OIDs, so unchanged files don't appear in commits even under `replaceGraphContent`. The **file-source** path is the weak one: `rmSync` + rewrite churns everything, has a crash window with no history to recover from, and deletes non-YAML files in the graph dir. Completing the `git add`+`commit` TODO (`file-source.ts:104`) fixes recoverability; writing via temp-dir-and-rename fixes the crash window.
3. **One-time normalisation**: the first save after loading legacy or hand-authored files rewrites them into canonical form (comments dropped, quoting normalised, defaults elided). Acceptable given machine ownership, but do it as a deliberate one-off "migrate" commit, not silently inside an unrelated import.
4. **Local-schema promotion changes node identity.** Sharing a local schema out to its own file moves it from `{node}.schemas.x` to `{component}.Schema.x` — a rename of the node and every field under it, with all inbound `maps-to`/`reads` edges needing rewrite. `renaminganddeletion.md` should explicitly cover promotion (emit `renamed-from` edges for the whole subtree and rewrite referring edges atomically in one commit).

Recommended guard: a **round-trip idempotence test** — load fixtures → save → load → save, assert the second save is byte-identical to the first. That single test pins determinism against regression permanently.

## P2.5 S1 clarified — branch loading semantics

Confirming the intended behaviour **is** what happens for graph content: `loadMultiGraph` always loads the default branch first (failure there is fatal), then loads each additional branch as a complete graph (failures isolated per-branch), and `overlay()` composes the viewing ref over the rest. Branches are full snapshots, not deltas — correct for git-backed storage.

The S1 finding was narrower than the summary implied: **template packs are pinned to the default branch** (`loader/index.ts:32`, and `GitGraphSource.loadPackContent` ignores its `ref` argument). Consequence: a design branch that introduces a *new template* plus clusters using it fails to load with `unknown template` until the template merges to main — i.e. the one layer packs are meant to make extensible is the one layer you can't iterate on a branch. Decide explicitly:

- **Option A (recommended):** load packs per-ref. Overlay/diff must then handle template drift, but template evolution is a first-class design activity for this tool.
- **Option B:** keep the pin as policy (template stability across overlays is a defensible position), but document it in an ADR and replace the generic `unknown template` diagnostic with one that says the template exists on the branch but templates are loaded from `<default>`.

## P2.6 Roadmap grounding (`docs/tasks/`)

Reviewed all 25 task docs plus the suggested-features table. The ambition (write tools → linter → BDD/journeys → delivery/collaboration → drift detection/impact analysis/multi-repo) is coherent and the priority order in `index.md` is broadly right. Dependency corrections this review adds:

- **`mcpwritetools.md` is blocked on C4.** Every write-path hazard (worktree divergence, no CAS, default-branch contradiction, file-source non-commits) becomes agent-triggered once MCP can write. Fix the write path *before* exposing write tools, and build the write tools on the linter (validate-before-persist), not before it.
- **BDD, user journeys, and delivery view are all blocked on the same two primitives** — pack-extensible edge types and edge properties (P2.1 gaps 1–2). Building any of them first without those primitives will hardcode more vocabulary into the engine and deepen C1.
- **`customui.md` upgrades C6 from file-write to code-execution.** Pack-shipped JSX served to every viewer's browser requires an integrity/trust story (hash-pinned installs at minimum) before the feature is viable.
- **Multi-repo composition raises the stakes on C2** — cross-repo ID collisions make the unvalidated ID grammar untenable; grammar + component namespacing should land first.
- **Drift detection and impact analysis** are where the current engine is already strongest (lineage + diff + overlay); they are cheaper than their table placement suggests and are the features that make the graph *self-honest*. Consider pulling them forward.
