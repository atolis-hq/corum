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
2. **The core engine knows nothing about node types.** All node types — including `Field` — are loaded from template packs. The engine validates templates against a meta-schema and validates nodes against their template's JSON Schema. It never case-matches on a template name ([ADR-004](../adr/ADR-004-template-pack-format.md)).
3. **Git is the canonical store.** YAML cluster files in a Git repo are the source of truth. The runtime cache (SQLite) is a projection; if it is lost, it rebuilds from Git. There is no hosted database in v1 ([ADR-001](../adr/ADR-001-storage-and-interaction-architecture.md)).
4. **Two interaction paths are first-class.** Agents may read and write YAML files directly, or call MCP tools. Neither is preferred — both must produce valid graphs. The MCP server is an enhancement, not a requirement.
5. **Responses from MCP are semantically richer than files.** A cluster response includes owned children inline, edges with field mappings, an overlay summary (drift flag, thread count, in-flight branch list), and optionally multi-branch projections. Agents that drop to direct file access must see the same shape ([ADR-005](../adr/ADR-005-mcp-interface-design.md)).
6. **Adapters are format-agnostic from the outside.** A single adapter interface handles read and write for every spec format. OpenAPI, AsyncAPI, GraphQL SDL, and TypeSpec are interchangeable plugins that ship with their spec-aligned packs.
7. **Clean architecture — dependencies point inward.** Pure schema has no dependencies; the graph engine depends on schema; adapters, MCP, CLI, and UI depend on the engine; nothing in the core depends on infrastructure or presentation layers.

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
│  @corum/graph            @corum/linter          @corum/adapters-*  │
│  load / query / mutate   rule engine            import / export    │
│  branch projection       multi-context          spec ⇄ graph       │
└────────────────────┬───────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Domain                                   │
│   @corum/schema                @corum/template-core                │
│   Node, Edge, Field, Graph     template pack format,               │
│   enums, edge vocabulary       meta-schema, extends resolution     │
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

- **Logical data model** — `Node`, `Edge`, `Field`, `Component`, `Graph`, state and stability enums, edge type vocabulary (`maps-to`, `triggers`, `produces`, `reads`, `calls`, `implements`, `derived-from`, `renamed-from`).
- **Template pack model** — `Template`, `TemplatePack`, `PackManifest`. Functions for resolving `extends` chains, merging child + parent `properties` schemas via JSON Schema `allOf`, detecting abstract template instantiation, detecting template-name collisions.
- **Identity** — `NodeId`, `EdgeId` types with validation and parsing helpers (`{component}.{node-type}.{name}[.{path}]`).

Nothing here reads files, opens a database, or makes network calls. The domain layer is the thing that the hosted commercial tier will keep identically when SQLite is swapped for Postgres.

### 4.2 Application (`@corum/graph`, `@corum/linter`, `@corum/adapters-*`)

Use cases that orchestrate the domain against infrastructure.

- **`@corum/graph`** — Builds and holds the runtime graph. Owns the SQLite schema and CTEs that implement multi-branch overlay projection. Exposes commands (`createNode`, `upsertEdge`, `softRemove`, `rename`) and queries (`getCluster`, `listClusters`, `getLineage`, `getFieldLineage`, `getBranchVersions`, `searchText`). Materialises owned children from cluster files as first-class nodes.
- **`@corum/linter`** — Rule engine with the catalogue from [ADR-006-rules](../adr/REF-006-rules.md). Runs in three deployment contexts (CLI, CI, MCP startup subset) against the same rule set. Emits structured diagnostics with rule ID, severity, file, line, and suggested fix.
- **`@corum/adapters-api`** — The `SpecAdapter` interface (§6.3). Adapter host that loads registered adapters at startup.
- **`@corum/adapter-openapi`, `@corum/adapter-asyncapi`, …** — Format-specific implementations. Each ships with its spec-aligned pack.

### 4.3 Interface (`@corum/mcp-server`, `@corum/cli`)

Adapters that translate external protocols to application commands and queries.

- **`@corum/mcp-server`** — MCP tool surface per [ADR-005](../adr/ADR-005-mcp-interface-design.md) and the [tool catalogue](../adr/REF-mcp-tool-catalogue.md). Layered cluster responses with overlay summary; filter-object queries; multi-branch scope; pre-computed analysis flags with on-demand detail. Startup-subset linter run to confirm the graph is loadable before serving.
- **`@corum/cli`** — Commands: `corum lint`, `corum import <format> <path>`, `corum export <format> <namespace>`, `corum sync`, `corum validate`, `corum migrate`, `corum serve` (starts the MCP server).

### 4.4 Infrastructure (`@corum/file-format`, `@corum/repo`, `@corum/cache`)

- **`@corum/file-format`** — YAML 1.2 parser and emitter restricted to the safe subset ([ADR-002 § YAML Safety Constraints](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md)). Cluster file schema, edge file schema, `graph.yaml` schema. Round-trip-stable emitter that preserves comments and key order on write-through.
- **`@corum/repo`** — Git integration via `isomorphic-git` (see [04](04-libraries-tooling-and-testing.md)). Resolves refs, fetches incrementally, computes `git diff --name-only` between commit SHAs, commits mutation tool calls, pushes to the remote. Knows nothing about YAML — it deals in file paths and blob contents.
- **`@corum/cache`** — SQLite schema and migration runner. Incremental-apply functions driven by the diff from `@corum/repo` and the parsed documents from `@corum/file-format`. The tables and CTEs for branch-overlay projection live here.

---

## 5. Runtime flows

### 5.1 Cold start (MCP server)

1. Load and validate template packs declared in `graph.yaml` (`@corum/template-core`).
2. Resolve `extends` chains and meta-schema-validate each pack (`@corum/template-core`).
3. If no cache exists, open the graph repo, fetch `main`, and walk every cluster and edge file; otherwise open the existing SQLite file and fetch incrementally from remote (`@corum/repo` + `@corum/cache`).
4. Parse each touched YAML file (`@corum/file-format`), validate each node's `properties` block against its template's JSON Schema (`@corum/graph`), and upsert the rows — including materialising every owned field/enum/invariant/operation as a first-class row.
5. Walk all open remote branches; for each, run `git diff --name-only main <branch-sha>` and populate `branch_nodes` / `branch_edges` overlays.
6. Run the linter startup subset. If a hard error fires, surface it through MCP and refuse to serve mutation tools.
7. Serve MCP tool calls.

### 5.2 Warm start

Identical to cold start, but step 3 is a single incremental fetch — typically sub-second. Only files whose paths appear in the SHA diff are re-parsed. The SQLite cache is the same file being updated in place.

### 5.3 Mutation (MCP `create cluster`)

1. Validate the request against the target template's JSON Schema (pre-flight).
2. Assemble a YAML document and write it at the expected path (`@corum/file-format` + `@corum/repo`).
3. Run the startup-subset linter against the new file; reject on hard error.
4. Commit and push.
5. Apply the change to the SQLite cache directly — no full reload.
6. Return the layered cluster response.

### 5.4 Import (`corum import openapi <file>`)

1. Load adapters for the requested format (`@corum/adapters-api`).
2. Parse the spec file (`@corum/adapter-openapi`, using `openapi-types` and a real parser).
3. Produce a `CandidateGraph` — nodes with `state: proposed`, `extractedFrom` populated, candidate edges, idempotent IDs.
4. Reconcile against the live graph in `@corum/graph` — matching existing nodes by ID, diffing properties, proposing `maps-to` edges for field mappings.
5. Emit cluster files for any new or changed nodes. Emit linter diagnostics for ambiguous cases (e.g. an OpenAPI schema that could be a request shape or a `DomainModel`).

### 5.5 Direct file-access path

An agent with a cloned repo edits a YAML file directly, commits, pushes. The MCP server picks it up on the next fetch cycle. Everything still works because the file format is the canonical contract — the MCP server's cache is a projection of it.

---

## 6. Key design properties

### 6.1 Clean architecture layering

- **Dependency rule:** arrows point inward. `@corum/schema` has no dependencies on anything in this repo. `@corum/graph` imports `@corum/schema` and `@corum/template-core` only. `@corum/mcp-server` imports the application layer; it does not reach into `@corum/cache` directly. Enforced via [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser).
- **Ports and adapters where it matters:** `@corum/graph` declares interfaces for `GraphRepository`, `GraphCache`, and `SpecAdapter`. The SQLite cache, isomorphic-git repo, and OpenAPI adapter implement those interfaces. Swapping SQLite for Postgres in the hosted tier is a second implementation, not a rewrite.
- **No leakage in the core:** the domain and application layers never import `fs`, `node:child_process`, or a database driver. They receive repositories and caches as dependencies.

### 6.2 Extensibility points

See [03 — Extensibility](03-extensibility-packs-adapters-plugins.md) for the full treatment. Summary of what is pluggable:

| Extension | Contract | Example |
|---|---|---|
| Template pack | `pack.yaml` + template YAML files | `domain` pack, a team's `my-extensions` pack |
| Spec adapter (reader + writer) | `SpecAdapter` interface | OpenAPI, AsyncAPI, TypeSpec, GraphQL SDL |
| View plugin (web) | Perspective registration (future ADR) | Purpose-built `APIEndpoint` editor |
| Output plugin | `OutputPlugin` interface | Export namespace as OpenAPI, as Markdown docs |
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
- `maps-to` edges connect `Field` nodes only — this is an error-level linter rule.
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

- Case-match on template names. The engine treats `APIEndpoint` and a team-defined `MyCustomEndpoint` identically.
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
4. **`@corum/pack-core` + `@corum/pack-domain` + `@corum/pack-rest` + `@corum/pack-messaging`** — ship the default template pack set as real packs loaded by the engine. No special-casing for defaults.
5. **`@corum/repo`** — Git integration via `isomorphic-git`. Fetch, diff, commit, push. Test with a fixture repo.
6. **`@corum/cache`** — SQLite schema, incremental apply, branch-overlay projection queries. Test with generated graphs of varying size.
7. **`@corum/graph`** — command/query surface, branch projection, materialisation of owned nodes. The first point at which all five lower layers compose.
8. **`@corum/linter`** — rule catalogue from [REF-006-rules](../adr/REF-006-rules.md). CLI and CI runners.
9. **`@corum/adapters-api`** plus **`@corum/adapter-openapi`** — first end-to-end adapter; proves the interface.
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
