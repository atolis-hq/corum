# 01 — Architecture Overview

**Status:** Draft v0.1
**Last updated:** 2026-04-16
**Supersedes:** n/a
**Relates to:** [ADR-001](../adr/ADR-001-storage-and-interaction-architecture.md), [ADR-002](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md), [ADR-003](../adr/ADR-003-graph-loading-and-runtime-representation.md), [ADR-003b](../adr/ADR-003b-core-logical-data-model.md), [ADR-004](../adr/ADR-004-template-pack-format.md), [ADR-005](../adr/ADR-005-mcp-interface-design.md), [ADR-006](../adr/ADR-006-linter-and-validator.md)

---

## 1. Purpose

Corum is a graph-based contract intelligence layer for distributed systems. It captures APIs, events, domain models, and the relationships between them as a queryable graph — enriched with lifecycle state, stability, branch-aware provenance, and design rationale that no underlying spec format provides.

This document describes the software architecture: the major components, how they fit together at runtime, and the layering and boundaries that keep the core engine generic and the integrations replaceable.

The logical data model, file format, and every major decision below are settled in the ADRs. This document synthesises them into a coherent picture from which packages, interfaces, and a build sequence can be derived.

---

## 2. Design principles

These are the non-negotiable properties of the implementation. They constrain every decision below.

1. **The graph model is uniform.** Everything is a node or an edge. Fields, enum values, invariants, and operations are first-class nodes at runtime, even though they are grouped into cluster files for readability ([ADR-002](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md), [ADR-003b](../adr/ADR-003b-core-logical-data-model.md)).
2. **The engine knows core semantic roles, not hardcoded node type names.** Every node type, including `Field`, is still declared by template YAML. A small set of core templates declare reserved semantic roles such as `field`, `enum-definition`, and `enum-value`; graph and lint rules may depend on those roles, never on the literal template name. A team can rename or extend the template while preserving the role contract.
3. **Template packs are data, not code.** A pack is a directory of YAML files — a `pack.yaml` manifest plus one template YAML per node type. No TypeScript, no build step, no published npm package required. The engine discovers packs by path (built-ins, workspace, local directory, or fetched archive) and loads them dynamically at startup. Adapters (spec readers/writers) are code; packs are not. See [03 — Extensibility § Template packs](03-extensibility-packs-adapters-plugins.md#2-template-packs).
4. **Git is the canonical store.** YAML cluster files in a Git repo are the source of truth. The runtime cache (SQLite) is a projection; if it is lost, it rebuilds from Git. There is no hosted database in v1 ([ADR-001](../adr/ADR-001-storage-and-interaction-architecture.md)).
5. **One write path for every mutation.** Whether a change originates from an MCP tool, a CLI command, or a spec-adapter import, it flows through the same `file-format` emitter guided by the same template. Adapters never touch YAML, paths, or files directly. See [§5.6 Persistence model](#56-persistence-model).
6. **Two interaction paths are first-class.** Agents may read and write YAML files directly, or call MCP tools. Neither is preferred — both must produce valid graphs. The MCP server is an enhancement, not a requirement.
7. **Responses from MCP are semantically richer than files.** A cluster response includes owned children inline, edges with field mappings, an overlay summary (drift flag, thread count, in-flight branch list), and optionally multi-branch projections. Agents that drop to direct file access must see the same shape ([ADR-005](../adr/ADR-005-mcp-interface-design.md)).
8. **Adapters are format-agnostic from the outside.** A single adapter interface handles read and write for every spec format. OpenAPI, AsyncAPI, GraphQL SDL, and TypeSpec are interchangeable plugins; they declare the pack they bind to rather than shipping templates themselves.
9. **The linter is the integrity layer, not a quality tool.** Without a database enforcing referential integrity, the file-first model holds together only because the linter enforces every ADR's structural rules. The linter runs in two stages — file-local (stage 1) and graph-wide (stage 2, requires the loaded graph) — across two deployment contexts (CI and local CLI). MCP startup loads the graph without running lint; mutation tools are gated on a subsequent clean lint pass. See [05 — Linting](05-linting.md).
10. **Clean architecture — dependencies point inward.** Pure schema has no dependencies; the graph engine depends on schema; adapters, MCP, CLI, and UI depend on the engine; nothing in the core depends on infrastructure or presentation layers.

---

## 3. The runtime in one diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                           Consumers                                │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐      │
│  │ Agents / MCP │   │     CLI      │   │  React Web UI (v2) │      │
│  │   clients    │   │ (lint,       │   │  perspectives +    │      │
│  │              │   │  import,     │   │  search            │      │
│  │              │   │  export)     │   │                    │      │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬─────────┘      │
└─────────┼──────────────────┼──────────────────────┼────────────────┘
          │ stdio (MCP)      │ invoke               │ HTTP / in-proc
          ▼                  ▼                      ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Interface layer                               │
│   @corum/mcp-server     @corum/cli     @corum/web-api (future)     │
│      tool surface         commands           read API              │
└────────────────────┬───────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Application / use cases                         │
│  @corum/graph            @corum/linter          @corum/adapter-*   │
│  load / query / mutate   rule engine            import / export    │
│  branch projection                              spec ⇄ graph       │
└────────────────────┬───────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Domain                                   │
│   @corum/schema                      @corum/template-core          │
│   Node, Edge, Field, Graph           template pack format,         │
│   enums, edge vocabulary,            meta-schema, extends          │
│   port + adapter interfaces          resolution                    │
└────────────────────┬───────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                       Infrastructure                               │
│  @corum/file-format   @corum/repo           @corum/cache           │
│  YAML parse/emit      Git fetch, diff,      SQLite schema,         │
│  cluster + edge       branch refs, commit   incremental apply      │
└────────────────────────────────────────────────────────────────────┘
```

Dependencies flow downward only. The domain layer has no imports from anything above it. Infrastructure implements interfaces declared by the application or domain layers.

---

## 4. Core components and responsibilities

### 4.1 Domain (`@corum/schema`, `@corum/template-core`)

Pure TypeScript types and functions — zero runtime dependencies beyond a JSON Schema validator.

- **Logical data model** - `Node`, `Edge`, `Field`, `Component`, `Graph`, state and stability enums, edge type vocabulary (`maps-to`, `triggers`, `produces`, `reads`, `calls`, `implements`, `derived-from`, `renamed-from`). Core semantic roles such as `field` are declared by template metadata and validated by the pack loader.
- **Template pack model** — `Template`, `TemplatePack`, `PackManifest`. Functions for resolving `extends` chains, merging child + parent `properties` schemas via JSON Schema `allOf`, detecting abstract template instantiation, detecting template-name collisions.
- **Identity** — `NodeId`, `EdgeId` types with validation and parsing helpers (`{component}.{node-type}.{name}[.{path}]`).

Nothing here reads files, opens a database, or makes network calls. The domain layer is the thing that the hosted commercial tier will keep identically when SQLite is swapped for Postgres.

### 4.2 Application (`@corum/graph`, `@corum/linter`, `@corum/adapters-*`)

Use cases that orchestrate the domain against infrastructure.

- **`@corum/graph`** - Builds and queries the runtime graph through ports. Exposes commands (`createNode`, `upsertEdge`, `softRemove`, `rename`) and queries (`getCluster`, `listClusters`, `getLineage`, `getFieldLineage`, `getBranchVersions`, `searchText`). Materialises owned children from cluster files as first-class nodes in the projection, but does not own the SQLite implementation.
- **`@corum/linter`** — Rule engine with the catalogue from [REF-006-rules](../adr/REF-006-rules.md). Two-stage pipeline: stage 1 runs per-file (format, IDs, template resolution, edge vocabulary); stage 2 runs against the loaded graph cache (cross-file reference resolution, `maps-to` structural check, removed/renamed directionality, cycle detection). Both stages run for CLI and CI. Called as a separate post-load pass — not embedded in the graph loader. Full treatment in [05 — Linting](05-linting.md).
- **`@corum/adapter-openapi`, `@corum/adapter-asyncapi`, …** — Format-specific implementations of `SpecAdapter` (declared in `@corum/schema/src/ports/adapters.ts`). Each ships with its spec-aligned pack. Adapters depend only on `@corum/schema`; no application-layer imports.

### 4.3 Interface (`@corum/mcp-server`, `@corum/cli`)

Adapters that translate external protocols to application commands and queries.

- **`@corum/mcp-server`** — MCP tool surface per [ADR-005](../adr/ADR-005-mcp-interface-design.md) and the [tool catalogue](../adr/REF-mcp-tool-catalogue.md). Layered cluster responses with overlay summary; filter-object queries; multi-branch scope; pre-computed analysis flags with on-demand detail. Startup-subset linter run to confirm the graph is loadable before serving.
- **`@corum/cli`** — Commands: `corum lint`, `corum import <format> <path>`, `corum export <format> <namespace>`, `corum sync`, `corum validate`, `corum migrate`, `corum serve` (starts the MCP server).

### 4.4 Infrastructure (`@corum/file-format`, `@corum/repo`, `@corum/cache`)

- **`@corum/file-format`** — YAML 1.2 parser and emitter restricted to the safe subset ([ADR-002 § YAML Safety Constraints](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md)). Cluster file schema, edge file schema, `graph.yaml` schema. Round-trip-stable emitter that preserves comments and key order on write-through. Given a node and its template, produces the canonical YAML layout (property key order, owned-child nesting) — the template is what tells the emitter *how* a node of a given type becomes YAML, so there is no per-type code in the emitter itself. Atomic writes use `write-file-atomic` (temp sibling → rename). This is the single write path used by MCP mutations, CLI edits, and spec-adapter imports alike.
- **`@corum/repo`** — Git integration via `isomorphic-git` (see [04](04-libraries-tooling-and-testing.md)). Resolves refs, fetches incrementally, computes `git diff --name-only` between commit SHAs, commits mutation tool calls, pushes to the remote. Knows nothing about YAML — it deals in file paths and blob contents.
- **`@corum/cache`** — SQLite schema and migrations (`node:sqlite` + `umzug`). A rebuildable projection of YAML files, not a second source of truth. Incremental-apply functions consume parsed documents from `@corum/file-format`; if the cache is missing or suspect, it is discarded and rebuilt from the working tree or Git ref.

---

## 5. Runtime flows

### 5.1 Cold start (MCP server)

Loading the graph and linting it are the same pipeline — stage 1 rules fire during parsing, stage 2 rules fire against the loaded cache. See [05 — Linting § The pipeline](05-linting.md#3-the-pipeline--how-linting-interleaves-with-loading) for the full diagram.

1. Load and validate template packs declared in `graph.yaml` (`@corum/template-core`). Resolves `extends` chains, meta-schema-validates templates, detects collisions. Fatal on pack failure — cannot continue.
2. If no cache exists, open the graph repo, fetch `main`, and walk every cluster and edge file; otherwise open the existing SQLite file and fetch incrementally from remote (`@corum/repo` + `@corum/cache`).
3. Parse each touched YAML file (`@corum/file-format`) — structural schema check only, no lint rules. Upsert rows into the cache, materialising owned children as first-class rows.
4. Branch overlays (`branch_nodes` / `branch_edges`) are **not** populated at startup. They are built lazily on the first call to `list-branches`, `get-branch-versions`, or any other branch-scoped query.
5. Serve query MCP tool calls immediately. Mutation tools (`create-cluster`, `create-edge`, etc.) are gated: the first mutation call triggers a full `corum lint` pass if one has not previously passed for the current working tree. Lint errors block the mutation and are returned as diagnostics.

### 5.2 Warm start

Identical to cold start, but step 3 is a single incremental fetch — typically sub-second. Only files whose paths appear in the SHA diff are re-parsed. The SQLite cache is the same file being updated in place.

### 5.3 Mutation (MCP `create cluster`)

Every mutation writes YAML first and treats SQLite as a projection. See [�5.6 Persistence model](#56-persistence-model).

1. Validate the request against the target template's JSON Schema where possible from the request alone.
2. Resolve the node's template (`@corum/template-core`) to get the canonical YAML layout — property key order and owned-child nesting.
3. Render the YAML document(s) via `@corum/file-format` to in-memory buffers.
4. Parse those rendered buffers through the file-format parser and run **stage 1 lint rules** against the candidate YAML. On hard error: return diagnostics; no files written.
5. Snapshot the current content of any files that will be overwritten (needed for rollback). Write the YAML batch atomically via `write-file-atomic` (temp sibling → rename per file). At this point the working tree is updated and externally visible.
6. Refresh the live SQLite cache from the written files. If cache refresh fails, mark the cache invalid and rebuild from the working tree.
7. Run **stage 2 lint rules** against the updated cache snapshot. On error: roll back written files (delete new files; restore snapshotted content for modified files), invalidate and rebuild the cache, return diagnostics. On success: return the layered cluster response. **No Git commit is made here** — working tree updates are eager, commits are explicit (see �5.6).

### 5.4 Import (`corum import openapi <file>`)

The import is one large transaction — every spec file produces one or more cluster files, written as a single atomic batch — but whether a Git commit follows is a deliberate choice.

1. Load the requested adapter (registered at startup; implements `SpecAdapter` from `@corum/schema/ports`).
2. Parse the spec file (`@corum/adapter-openapi`, using `openapi-types` and a real parser).
3. Produce a `CandidateGraph` — nodes with `state: proposed`, `extractedFrom` populated, candidate edges, idempotent IDs. The adapter produces logical graph data only; it never touches YAML or the filesystem.
4. Reconcile against the live graph in `@corum/graph` — matching existing nodes by ID, diffing properties, proposing `maps-to` edges for field mappings.
5. For each new or changed node, resolve its template and call `@corum/file-format` to emit candidate cluster files. The resulting YAML batch goes through the same stage 1 lint → atomic write → cache refresh → stage 2 lint → rollback-on-error flow as MCP mutations. Emit linter diagnostics for ambiguous cases (e.g. an OpenAPI schema that could be a request shape or a `DomainModel`).
6. **Default:** leave the working tree dirty so the user can review the diff, make tweaks, and commit when ready. **With `--commit "message"`:** commit the entire import as one atomic Git commit for CI / scripted flows.

### 5.5 Direct file-access path

An agent with a cloned repo edits a YAML file directly, commits, pushes. The MCP server picks it up on the next fetch cycle. Everything still works because the file format is the canonical contract — the MCP server's cache is a projection of it.
Corum's write semantics mirror Git itself: a working tree that updates eagerly, and commits that are explicit. SQLite is a read/query acceleration layer rebuilt from YAML, not a second write model.

### 5.6 Persistence model


**1. Transaction = one command or tool call.** Each MCP tool invocation or CLI mutation is an atomic YAML write unit. Within it: validate request → render YAML → run stage 1 lint → atomically write YAML batch → refresh the live cache → run stage 2 lint (rollback on error). Before the write, failure leaves all file paths untouched. After the write, YAML is authoritative; if stage 2 lint fails, written files are rolled back and the cache is rebuilt from the restored working tree.

**2. Working tree = eager and authoritative.** As soon as a mutation's YAML batch is renamed into place, external tools - editors, `git status`, direct-file-access agents - see it immediately. There is no `save()` step and no durable cache-only state. This avoids a two-way sync problem: writes flow YAML -> cache, never cache -> YAML except through the same file-format emitter before the YAML write.

**3. SQLite cache = disposable projection.** The cache may be updated incrementally for speed, but its correctness is judged against the files. If the process crashes, a checksum mismatches, or cache refresh fails, startup discards or repairs the SQLite file by reparsing the working tree or target Git ref. No user data exists only in SQLite.

**4. Git commit = explicit and batched.** Writing to the working tree is not the same as committing. A caller (human, agent, or CI) can fire ten `create-cluster` / `create-edge` tool calls, watch the working tree update after each, then commit once via the `sync` / `commit` CLI command or the corresponding MCP tool. Commits are the point where intent is captured in history and where branches get pushed. Deferring to an explicit commit step keeps history readable - a rename operation that touches N edge files lands as a single commit rather than N noisy ones.

**Why not write-through to Git on every mutation?** Tempting for auditability, but every micro-edit would produce a commit, history becomes noise, and multi-file logical operations should land as one commit, not N.

**Why not mutate SQLite first?** That creates a two-way sync problem: the system must decide whether files or SQLite win after every crash or partial failure. Corum avoids that class of bugs by making YAML the only durable mutation target.

**Rollback semantics.** Stage 1 failures are code-only — no files written; discard buffers and return diagnostics. Stage 2 failures occur after the YAML write: roll back by restoring pre-write file snapshots (for modified files) or deleting written files (for new files), then rebuild the cache from the restored working tree. If rollback itself fails (e.g. disk full during restore), the cache is marked invalid and the YAML working tree is left in a partial state — recoverable via `git checkout` or `corum sync --from-git`. Undoing a committed YAML change is a normal Git or editor operation.

---

## 6. Key design properties

### 6.1 Clean architecture layering

- **Dependency rule:** arrows point inward. `@corum/schema` and `@corum/template-core` are the innermost domain packages. Port interfaces (`GraphRepository`, `GraphCache`, `SpecAdapter`, etc.) live in `@corum/schema/src/ports/` — co-located with the domain so every package can depend on them without an extra package hop. Application packages consume ports; infrastructure packages implement them; interface packages wire implementations in composition roots. Enforced via [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser).
- **Ports and adapters where it matters:** `@corum/schema/ports` declares interfaces for `GraphRepository`, `GraphCache`, `SpecAdapter`, `OutputPlugin`, and the `GraphQueryFacade` used by adapters during reconciliation. `@corum/graph` consumes the graph ports; `@corum/repo` and `@corum/cache` implement them; adapter packages implement `SpecAdapter`. Swapping SQLite for Postgres in the hosted tier is a second implementation of `GraphCache`, not a rewrite.
- **No leakage in the core:** the domain and application layers never import `fs`, `node:child_process`, or a database driver. They receive repositories and caches as dependencies.

### 6.2 Extensibility points

See [03 — Extensibility](03-extensibility-packs-adapters-plugins.md) for the full treatment. Summary of what is pluggable:

| Extension | Contract | Example |
|---|---|---|
| Template pack | `pack.yaml` + template YAML files | `domain` pack, a team's `my-extensions` pack |
| Spec adapter (reader + writer) | `SpecAdapter` in `@corum/schema/ports` | OpenAPI, AsyncAPI, TypeSpec, GraphQL SDL |
| View plugin (web) | Perspective registration (future ADR) | Purpose-built `APIEndpoint` editor |
| Output plugin | `OutputPlugin` in `@corum/schema/ports` | Export namespace as OpenAPI, as Markdown docs |
| Linter rule | Deferred (PDR-003 — Option C) | Pack-defined validators |

### 6.3 Why adapters, not converters

A core question was whether spec formats should be handled by adapters (pluggable readers/writers registered with the engine) or by standalone converters (CLIs that transform spec files to and from YAML independently).

Adapters win decisively. Standalone converters:

- Lose awareness of the existing graph — cannot match, deduplicate, or reconcile with already-extracted nodes; the `extractedFrom` trail and `renamed-from` semantics fall apart without it.
- Cannot produce `maps-to` edges across the schema boundary between an API request field and its domain-model counterpart — that requires reading both sides.
- Duplicate the YAML writer and file-format logic that `@corum/file-format` already provides — two code paths to maintain, inevitable divergence.
- Force users to orchestrate two tools per format, then glue them together with shell scripts.
- Break the MCP write path — an agent calling `import openapi` would need to shell out, wait, then re-fetch, rather than produce proposed nodes in a single round trip.

The adapter pattern gets the ergonomics anyway — `corum import openapi <file>` and `corum export openapi <namespace>` are CLI shortcuts that call the same registered adapter the MCP server uses. Nothing is lost; everything is gained.

The full adapter interface is defined in [03 — Extensibility § Adapters](03-extensibility-packs-adapters-plugins.md#spec-adapters).

### 6.4 Invariants the implementation must hold

Drawn from [ADR-003b § Invariants](../adr/ADR-003b-core-logical-data-model.md#invariants-the-model-enforces) and elsewhere:

- Node IDs are globally unique across the repo; owned-node IDs are prefixed with their owner.
- Nodes are never hard-deleted — removal is a state transition to `removed`. Edges *are* hard-deleted.
- Edge endpoints must resolve to declared node IDs (linter at CI; runtime tolerates unresolved cross-repo references).
- `maps-to` edges connect nodes whose template declares the core semantic role `field` - this is an error-level linter rule.
- Abstract templates cannot be instantiated.
- Every node carries `state`, `stability`, `lastModifiedAt`, and `schemaVersion`.

These are implemented once in `@corum/graph` and `@corum/linter`; they are not duplicated in MCP, CLI, or adapters.

---

## 7. What lives outside the core engine

- **React web UI.** Deferred. When built, it is a consumer of the same interface surface as agents — `@corum/mcp-server` (over HTTP-transport MCP or a small REST wrapper) plus `@corum/schema` types shared with the frontend. The perspective-per-node-type model from [PDR-006](../pdr/PDR-006-human-review-and-editing-experience.md) is the framing we design for.
- **Pack registry.** Deferred. V1 resolves packs from built-ins, local paths, and npm. A community registry is a future ADR.
- **Hosted commercial tier.** Separate deployable (`@corum/hosted-*`) that reuses the domain and application layers, replaces `@corum/cache` with a Postgres implementation of the same `GraphCache` port, and introduces multi-tenant concerns. Out of scope for v1.
- **Extraction CI pipeline (agent-side).** Thin wrappers in service repos that invoke language-specific extractors (e.g. `typescript-openapi-extractor`) and push to the graph repo. The graph repo side is just an adapter call — no special-casing.

---

## 8. What the core engine never does

- Case-match on template names. The engine treats a template named `APIEndpoint` and a team-defined `MyCustomEndpoint` identically unless a template explicitly declares a reserved core semantic role. Core roles are stable contracts; template names are not.
- Embed spec-format knowledge. OpenAPI lives in `@corum/adapter-openapi`, not in `@corum/graph`.
- Reach for `fs` or `git` from the domain layer. Those live in `@corum/repo` and `@corum/file-format`, behind interfaces.
- Mutate Git directly from the MCP tool implementations. Tool implementations call `@corum/graph` commands, which go through the repository port.

---

## 9. Non-goals for v1

- Multi-tenant hosted deployment.
- A custom query language beyond the filter object from [ADR-005](../adr/ADR-005-mcp-interface-design.md).
- Pack-defined linter rules ([ADR-006](../adr/ADR-006-linter-and-validator.md) — deferred).
- Purpose-built UI components ([ADR-004 § Deferred](../adr/ADR-004-template-pack-format.md#deferred-ui-component-bundling) — generic renderer from `ui:` hints only).
- A GraphQL SDL adapter ([REF-specification-format-support](../adr/REF-specification-format-support.md) — planned).

---

## 10. Build sequence

Recommended order. Each step is independently valuable — you can stop at any point and still have a working piece. See [02 — Packages](02-packages-and-folder-structure.md) for what each package contains.

1. **`@corum/schema`** — the logical data model. Write it, test it, nothing else. This is the reference every other package agrees on.
2. **`@corum/template-core`** — pack loader, meta-schema, `extends` merge. Test with a handful of representative templates from ADR-004.
3. **`@corum/file-format`** — cluster and edge YAML parse/emit, round-trip tests over the ADR-002 examples.
4. **Built-in `.corum/packs/*`** - ship the default template pack set (`core`, `domain`, `rest`, `messaging`) as real pack directories loaded by the engine. No special-casing for defaults.
5. **`@corum/repo`** — Git integration via `isomorphic-git`. Fetch, diff, commit, push. Test with a fixture repo.
6. **`@corum/cache`** — SQLite schema, incremental apply, branch-overlay projection queries. Test with generated graphs of varying size.
7. **`@corum/graph`** — command/query surface, branch projection, materialisation of owned nodes. The first point at which all five lower layers compose.
8. **`@corum/linter`** — rule catalogue from [REF-006-rules](../adr/REF-006-rules.md) split into stage 1 (per-file, post-parse) and stage 2 (graph-wide, post-materialisation). Two deployment profiles: CLI and CI. Called by the composition root after `loadGraph`, not embedded in the loader. Without this, every downstream component is free to produce an invalid graph — build it alongside step 7, not after. See [05 — Linting](05-linting.md).
9. **`@corum/adapter-openapi`** — first end-to-end adapter; implements `SpecAdapter` from `@corum/schema/ports`; proves the interface without a separate adapters-api package.
10. **`@corum/cli`** — `lint`, `import openapi`, `export openapi`, `serve`.
11. **`@corum/mcp-server`** — tool surface per ADR-005 and the tool catalogue.
12. **`@corum/adapter-asyncapi`** — second adapter; validates the interface generalises.

Steps 1–3 and 7 are the critical path for anything else to be testable.

---

## Related

- [02 — Packages and Folder Structure](02-packages-and-folder-structure.md)
- [03 — Extensibility: Packs, Adapters, Plugins](03-extensibility-packs-adapters-plugins.md)
- [04 — Libraries, Tooling and Testing](04-libraries-tooling-and-testing.md)
- [Vision](../vision/VISION.md)
- [ADR-001](../adr/ADR-001-storage-and-interaction-architecture.md)
