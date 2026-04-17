# 05 — Linting

**Status:** Draft v0.1
**Last updated:** 2026-04-17
**Relates to:** [ADR-006](../adr/ADR-006-linter-and-validator.md), [REF-006-rules](../adr/REF-006-rules.md), [01 — Architecture Overview](01-architecture-overview.md), [02 — Packages and Folder Structure](02-packages-and-folder-structure.md)

---

## 1. Why linting is foundational

Corum has no database enforcing referential integrity at write time. The graph's invariants — unique IDs, resolvable edge endpoints, valid template conformance, `maps-to` restricted to `Field` nodes — exist only because the linter enforces them. Every ADR that introduces a structural rule (ADR-002 file format, ADR-003b data model, ADR-004 templates, ADR-004b edges) contributes rules catalogued in [REF-006-rules](../adr/REF-006-rules.md).

The linter is therefore not an optional quality tool — it is the **integrity layer** of the system. If the linter is weak or slow, the graph drifts; if it is strong and fast, the file-first storage model holds together.

This document describes the two-stage pipeline that makes that possible, how the stages compose with the graph-loading pipeline, and how the linter is structured in code to support three deployment contexts (CI, local CLI, MCP startup) over the same rule catalogue.

---

## 2. Two orthogonal axes

The linter is described along two independent axes. Understanding both is essential — they control different things.

### 2.1 Axis 1: Stage — what information does the rule need?

| Stage | Input the rule needs | Example rules |
|---|---|---|
| **Stage 1 - file-local / pack-local** | One file being parsed, or the loaded template pack set. No cross-file graph state. | F-001 ID format, F-005 YAML 1.2, F-007 schema-version present, F-009 valid state, T-001 template resolves, T-002 abstract instantiation, T-003 required property presence, T-004 property schema conformance, T-005 unknown properties, T-006-T-012 pack/template rules, E-001 core edge type, E-003/E-004 template edge declaration |
| **Stage 2 - graph-wide** | The fully loaded in-memory / cached graph including cross-file node and edge resolution. | R-001 node ID uniqueness across repo, R-002 edge endpoint resolution, E-002 `maps-to` structural check, E-005/E-006 source/target edge constraint, E-007 renamed-from cycle, R-004/R-005 removed/renamed directionality, F-011 fieldMappings endpoint resolution, S-series local reference reachability/cycles where they cross materialised owned nodes |

**Key property:** stage 2 rules cannot run until the graph has been loaded — parsed, template-resolved, and materialised into the query layer. Stage 1 rules can run on a single file in isolation.

### 2.2 Axis 2: Deployment context — where does the rule run?

Same rule catalogue, three contexts ([ADR-006](../adr/ADR-006-linter-and-validator.md)):

| Context | Runs | Purpose |
|---|---|---|
| **MCP server startup** | Startup subset only (declared in REF-006-rules) | Confirm the graph is loadable before serving mutation tools. Failures refuse the server start. |
| **Local CLI (`corum lint`)** | Full rule set | Agents and engineers verify before committing. Identical output format and exit code to CI. |
| **CI (PR check)** | Full rule set | Gate merges. Produces inline PR annotations via SARIF. |

CLI and CI are the same runner invoked differently. Startup is a different runner profile that runs only the startup subset and short-circuits on the first startup-blocking error.

### 2.3 How the axes compose

Every rule has a fixed stage. Most rules run in every deployment context. A rule in the startup subset is just a rule flagged as cheap and critical enough to run on MCP start — it still fires on CLI and CI.

The startup subset contains rules from **both stages**. It includes pack-level and file-local structural rules (T-001, T-002, T-006-T-008, T-011, E-001) and core graph-wide integrity rules (R-001 ID uniqueness, E-002 `maps-to` field-role validation). This is why the MCP server must do a real graph load at startup, not just a file scan: to confirm a graph can be served at all, you need to load enough of it to check the invariants.

---

## 3. The pipeline — how linting interleaves with loading

The two-stage linter is tightly coupled to the graph-loading pipeline in `@corum/graph`. Running linting as a post-hoc pass over already-loaded data would double the work; instead, stage 1 rules fire *during* parsing, and stage 2 rules fire once the cache is fully populated.

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Load template packs                                          │
│    @corum/template-core                                         │
│    ├─ Meta-schema validate every pack.yaml and template file    │
│    ├─ Resolve `extends` chains, merge via JSON Schema `allOf`   │
│    └─ Detect name collisions                                    │
│                                                                 │
│    STAGE 1 pack rules fire here:                                │
│    T-006 Field core present · T-007 name uniqueness             │
│    T-008 extends resolves · T-009 no circular extends           │
│    T-010 child does not narrow · T-011 requires satisfied       │
│    E-003/E-004 template edge declarations                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ loaded pack set (read-only)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Walk files, parse YAML, per-file validate                    │
│    @corum/file-format + @corum/graph (orchestrator)             │
│    For each cluster and edge file:                              │
│    ├─ YAML 1.2 safe parse                                       │
│    ├─ File-format schema check                                  │
│    └─ Resolve node's template, validate properties JSON Schema  │
│                                                                 │
│    STAGE 1 file rules fire here (per file):                     │
│    F-001 ID format · F-002 owned ID prefix · F-003 edge naming  │
│    F-004 node-type dir · F-005 YAML 1.2 · F-006 prohibited      │
│    F-007 schema-version · F-008 compat · F-009/F-010 enums      │
│    F-012 no inline edges · F-013 component registry             │
│    T-001 template resolves · T-002 abstract instantiation       │
│    T-003/T-004/T-005 property conformance · T-012 schema drift  │
│    E-001 core edge type                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ parsed documents
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Materialise into SQLite cache                                │
│    @corum/cache                                                 │
│    ├─ Upsert nodes, edges, fields, field_mappings               │
│    ├─ Materialise owned children as first-class rows            │
│    └─ Build branch overlays for open branches                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ loaded graph (read-only snapshot)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Graph-wide validation                                        │
│    @corum/linter stage 2 runner over the cache                  │
│                                                                 │
│    STAGE 2 rules fire here (cross-file, whole-graph):           │
│    R-001 ID uniqueness · R-002 edge endpoint resolution         │
│    R-003 cross-repo references · R-004 removed node isolation   │
│    R-005 renamed-from directionality                            │
│    F-011 fieldMappings endpoint resolution                      │
|    E-002 maps-to field-role nodes; E-005/E-006 source/target     |
│    edge constraints · E-007 renamed-from cycle                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Why stage 2 *must* load the data

Stage 2 rules depend on cross-file resolution that cannot be computed from a single file:

- **R-001 uniqueness** requires the set of every declared ID across the repo.
- **R-002 edge endpoint resolution** requires knowing whether the ID referenced in an edge's `from`/`to` exists anywhere in the repo.
- **E-002 `maps-to` structural check** requires resolving both endpoints to nodes and checking their templates declare the core semantic role `field`.
- **E-005/E-006 source/target constraint checks** require both endpoint nodes *and* their templates loaded, to see whether the edge type is declared on either side.
- **E-007 renamed-from cycle detection** requires walking the graph of `renamed-from` edges.

Running these rules against a partially-loaded or streaming pipeline would produce false positives (missing nodes look unresolved when they're just not read yet). The architecture therefore enforces a clean boundary: **stage 1 completes across all files before stage 2 runs**. The cache is the snapshot that stage 2 reads.

### 3.2 Fast path for incremental linting

In CI on a PR, only a subset of files change. The naive approach — reload the whole graph, re-run stage 2 — is still tractable at v1 scale (ADR-003 §scale discussion) but wasteful for large repos.

The incremental fast path:

1. `@corum/repo` produces `git diff --name-only base..head` — the list of changed files.
2. Stage 1 runs against those files only. Fast, per-file.
3. Stage 2 runs on the full loaded cache (which was incrementally updated to reflect the PR head ref). Rules are designed so most are index lookups or SQL queries — not whole-graph scans.
4. Diagnostics are filtered to those touching changed files or related nodes for PR annotation; the full diagnostic set is still reported to the CI job log.

Stage 2 queries are the hot path — they inform every rule's implementation (see §5.3).

---

## 4. Deployment context details

### 4.1 MCP server startup (`@corum/mcp-server`)

- Runs the startup subset only (declared rule IDs in [REF-006-rules](../adr/REF-006-rules.md#startup-subset)).
- Invoked after packs load and the cache is populated; in practice both stage 1 and stage 2 rules from the subset fire, interleaved with the loading pipeline above.
- A single `error` severity finding refuses server startup and returns a structured failure to the MCP client with rule ID, file, line, and a suggested fix. Mutation tools are not served.
- Query tools may be served even on startup failure if configured — degraded-read mode for inspection — but this is off by default.

### 4.2 Local CLI (`corum lint`)

- Full rule set, both stages.
- Same runner as CI; identical output format.
- Exit code 0 on zero errors (warnings allowed); non-zero on any error.
- Human-readable default; `--format json` / `--format sarif` for machine consumption.
- Flags:
  - `--only <stage1|stage2>` — run only one stage (debugging and dev-loop speed).
  - `--rule <id>` — run one specific rule across the full graph.
  - `--changed-since <ref>` — incremental lint using the fast path (§3.2).
  - `--severity <warning|error>` — promote all findings of the given severity to the exit gate.

### 4.3 CI

- `corum lint --format sarif` → GitHub PR annotations at file and line.
- Runs against the PR head commit. The linter fetches via `@corum/repo` and does not assume a working tree.
- `linter.ignore` glob patterns from `graph.yaml` apply; honour `--no-ignore` for full audits.

---

## 5. Package and module structure

Structure of `@corum/linter` expanded from [02 — Packages](02-packages-and-folder-structure.md#linter):

```
packages/linter/
  src/
    index.ts                   # public API
    diagnostic.ts              # Diagnostic, Severity, RuleMetadata types
    rule.ts                    # Rule<Stage1Ctx>, Rule<Stage2Ctx> interfaces
    runner/
      index.ts                 # LinterRunner orchestrator
      profile.ts               # DeploymentProfile: cli | ci | startup
      stage1.ts                # walks files, invokes Stage1 rules
      stage2.ts                # walks loaded graph, invokes Stage2 rules
      incremental.ts           # --changed-since fast path
    config.ts                  # parses `linter` block of graph.yaml
    rules/
      stage1/
        file-format/           # F-001..F-013
          id-format.ts
          owned-id-prefix.ts
          edge-file-naming.ts
          node-type-directory.ts
          yaml-safe.ts
          schema-version.ts
          ...
        template/              # T-001..T-005, T-012
        template-pack/         # T-006..T-011 — run once per pack load
        edge-declaration/      # E-001, E-003, E-004
      stage2/
        reference-integrity/   # R-001..R-005, F-011
          id-uniqueness.ts
          edge-endpoint-resolution.ts
          removed-node-isolation.ts
          renamed-from-directionality.ts
          ...
        edge-constraints/      # E-002, E-005, E-006, E-007
          maps-to-fields.ts
          source-edge-constraint.ts
          target-edge-constraint.ts
          renamed-from-cycle.ts
    formatters/
      text.ts
      json.ts
      sarif.ts
  test/
    rules/
      stage1/<rule-id>.test.ts # one fixture file per rule, happy + sad path
      stage2/<rule-id>.test.ts # fixture mini-graph per rule
    runner.test.ts
    incremental.test.ts
    fixtures/
      graphs/                  # small complete graphs for stage 2 tests
```

### 5.1 `Rule` contract

Two rule interfaces — one per stage — with a shared `RuleMetadata`:

```ts
export interface RuleMetadata {
  readonly id: string;             // e.g. "R-001"
  readonly description: string;
  readonly source: string;         // e.g. "ADR-003b"
  readonly defaultSeverity: Severity;
  readonly promotable: boolean;
  readonly inStartupSubset: boolean;
  readonly stage: 1 | 2;
}

export interface Stage1Rule {
  readonly meta: RuleMetadata & { stage: 1 };
  /** Invoked for every parsed file and/or pack context. */
  run(ctx: Stage1Context): Iterable<Diagnostic>;
}

export interface Stage2Rule {
  readonly meta: RuleMetadata & { stage: 2 };
  /** Invoked once against the loaded graph snapshot. */
  run(ctx: Stage2Context): AsyncIterable<Diagnostic>;
}

export interface Stage1Context {
  readonly packs: LoadedPack[];
  readonly file: ParsedFile;           // cluster | edge | graph.yaml
}

export interface Stage2Context {
  readonly packs: LoadedPack[];
  readonly graph: GraphReadSnapshot;   // query-only view of @corum/cache
}
```

Both rule kinds return lazy iterators so large result sets stream to the formatter without buffering.

### 5.2 Why two interfaces rather than one

The rule interfaces differ in what they receive. A unified `ctx` with both `file` and `graph` would tempt stage 1 rules to reach into the graph — defeating the streaming-per-file model and slowing CI. Two interfaces make the dependency explicit and let the runner schedule them differently: stage 1 runs concurrently across files; stage 2 runs once, serially, after the graph is ready.

### 5.3 Graph query surface for stage 2

Stage 2 rules consume `GraphReadSnapshot` — a read-only projection over `@corum/cache`. The snapshot exposes:

- `getNode(id)`, `getNodesByTemplate(template)`, `getNodesByState(state)`
- `getEdge(id)`, `getEdgesFrom(nodeId)`, `getEdgesTo(nodeId)`, `getEdgesByType(type)`
- `hasNode(id)` — cheap existence check for endpoint resolution
- `getTemplate(name)` — resolved, merged template
- `iterateDuplicates()` — pre-computed by the cache on load for R-001
- `iterateCycles(type)` — on-demand SCC over a given edge type for E-007

The cache pre-computes indexes that turn most stage 2 rules into indexed lookups rather than scans. For example, R-001 (ID uniqueness) is free — the cache already rejects duplicate inserts and surfaces the conflicts. E-007 (renamed-from cycle) uses a precomputed SCC result. This is why we route stage 2 through the cache rather than raw files.

---

## 6. Interaction with the graph-loading pipeline

`@corum/graph` is the orchestrator. It composes the packs, the file-format parser, the cache, and the linter runner:

```ts
// Simplified pseudocode in @corum/graph/src/load.ts
export async function loadGraph(opts: LoadOptions): Promise<LoadedGraph> {
  const diagnostics = new DiagnosticSink();

  // Step 1 — packs (stage 1 pack rules)
  const packs = await templateCore.loadPacks(opts.graphConfig, { diagnostics });
  linter.runStage1Pack(packs, diagnostics);

  if (diagnostics.hasStartupBlockingError(opts.profile)) return abort(diagnostics);

  // Step 2 — parse files (stage 1 file rules, per file)
  const parsedFiles: ParsedFile[] = [];
  for await (const file of repo.walkGraphFiles(opts.ref)) {
    const parsed = fileFormat.parse(file);
    linter.runStage1File(parsed, packs, diagnostics);
    parsedFiles.push(parsed);
  }

  if (diagnostics.hasStartupBlockingError(opts.profile)) return abort(diagnostics);

  // Step 3 — materialise
  const cache = await cacheImpl.apply(buildApplyPlan(parsedFiles));

  // Step 4 — stage 2
  const snapshot = cache.snapshot();
  for await (const diag of linter.runStage2(snapshot, packs, opts.profile)) {
    diagnostics.add(diag);
  }

  if (diagnostics.hasStartupBlockingError(opts.profile)) return abort(diagnostics);

  return { cache, packs, diagnostics };
}
```

Three properties worth calling out:

1. **Early exit on startup-blocking errors.** The MCP startup profile aborts as soon as a subset-error fires, without materialising the rest of the graph. CLI and CI profiles always complete all stages so the full diagnostic set is available.
2. **Diagnostics are a first-class output of loading.** Every loader call returns a `LoadedGraph` with a `diagnostics` field. Non-startup consumers (CLI, CI) iterate this to produce reports; MCP consumers check it to decide whether to serve mutation tools.
3. **The linter never writes.** It is a read-only consumer of packs, parsed files, and the cache snapshot. Mutation tools in the MCP server run the linter's startup subset after their own write but still never allow the linter to mutate.

---

## 7. Configuration

From [ADR-006](../adr/ADR-006-linter-and-validator.md) and [REF-006-rules](../adr/REF-006-rules.md), the `linter` block of `graph.yaml`:

```yaml
linter:
  rules:
    T-003: error      # Promote: required properties must always be present
    E-005: error      # Promote: outgoing edge constraints enforced strictly
  ignore:
    - "components/legacy/**"
```

Rules:
- Only `warning`-default rules marked `promotable` may be promoted to `error`. Attempting to demote an error is a config error.
- `ignore` patterns are matched against file paths relative to the graph repo root for stage 1 rules, and against each node's `extractedFrom` or declared source file for stage 2 rules that map cleanly to files. Pure graph-wide rules (e.g. E-007 cycle detection) are not suppressed by `ignore` — a cycle is a cycle regardless of which file it passes through.

---

## 8. Testing

Covered in [04 — Testing](04-libraries-tooling-and-testing.md#3-testing-strategy), but linter-specific notes:

- **Per-rule fixtures.** Each rule has a minimal fixture that triggers it exactly once, and a sibling fixture that passes. These are the regression net — a rule change that breaks either is caught immediately.
- **Whole-graph fixtures.** A single handcrafted fixture graph (`fixtures/linter-golden/`) exercises every rule at least once. Expected diagnostics are asserted against a golden JSON. PRs that change rule output surface as a golden-file diff.
- **Staged runs.** Tests cover each deployment profile (cli, ci, startup) — startup must produce the declared subset exactly and exit early on the first blocking error.
- **Incremental.** Tests for the `--changed-since` fast path assert that a change touching one file produces the same diagnostics as a full run, for affected files only.

---

## 9. Future extensions

- **Pack-defined custom rules** ([ADR-006 Option C](../adr/ADR-006-linter-and-validator.md#option-c-custom-rules-via-pack-defined-validators-future)) — deferred. When introduced, custom rules ship inside packs and slot into the stage 1 or stage 2 pipeline based on their declared input needs (file vs. graph). The existing two-stage boundary is what makes custom rules safe to host — a custom rule declares its stage and the runner enforces it.
- **Lint-on-write in the MCP server** beyond the startup subset — rejected for v1 (ADR-006 decision 1). Revisit when benchmarks show the subset is missing writes it could cheaply catch.
- **Auto-fix hints.** Stage 1 rules often know the exact text to fix (e.g. F-003 edge file naming). An optional `fix` field on `Diagnostic` can surface a suggested replacement — deferred until the CLI has an interactive mode.

---

## Related

- [01 — Architecture Overview](01-architecture-overview.md)
- [02 — Packages and Folder Structure](02-packages-and-folder-structure.md)
- [03 — Extensibility: Packs, Adapters, Plugins](03-extensibility-packs-adapters-plugins.md)
- [04 — Libraries, Tooling and Testing](04-libraries-tooling-and-testing.md)
- [ADR-006 Linter and Validator](../adr/ADR-006-linter-and-validator.md)
- [REF-006-rules Rule Catalogue](../adr/REF-006-rules.md)
