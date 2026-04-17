# 02 — Packages and Folder Structure

**Status:** Draft v0.1
**Last updated:** 2026-04-16
**Relates to:** [01 — Architecture Overview](01-architecture-overview.md), [03 — Extensibility](03-extensibility-packs-adapters-plugins.md)

---

## 1. Monorepo layout

Single pnpm workspace + TypeScript project-references monorepo, scoped under `@corum/`. The repo is the implementation repo — separate from a user's graph repo.

```
corum/
  package.json                   # workspace root
  pnpm-workspace.yaml
  tsconfig.base.json
  tsconfig.json                  # project-references root
  .dependency-cruiser.cjs        # layer boundary rules
  vitest.config.ts               # shared test config
  packages/
    schema/                      # @corum/schema            — domain: logical model
    template-core/               # @corum/template-core     — domain: pack format + extends
    file-format/                 # @corum/file-format       — infra: YAML cluster/edge files
    repo/                        # @corum/repo              — infra: Git integration
    cache/                       # @corum/cache             — infra: SQLite schema + apply
    graph/                       # @corum/graph             — application: commands/queries
    linter/                      # @corum/linter            — application: rule engine
    adapters-api/                # @corum/adapters-api      — application: SpecAdapter port
    adapter-openapi/             # @corum/adapter-openapi   — adapter: OpenAPI 3
    adapter-asyncapi/            # @corum/adapter-asyncapi  — adapter: AsyncAPI 3
    pack-core/                   # @corum/pack-core         — built-in pack
    pack-rest/                   # @corum/pack-rest         — built-in pack + re-exports adapter
    pack-messaging/              # @corum/pack-messaging    — built-in pack + re-exports adapter
    pack-domain/                 # @corum/pack-domain       — built-in pack
    pack-design/                 # @corum/pack-design       — built-in pack (optional)
    pack-event-storming/         # @corum/pack-event-storming (optional)
    pack-event-modelling/        # @corum/pack-event-modelling (optional)
    mcp-server/                  # @corum/mcp-server        — interface: MCP tools
    cli/                         # @corum/cli               — interface: commands
    ui-core/                     # @corum/ui-core           — (future) shared UI primitives
    web/                         # @corum/web               — (future) React app
  apps/
    (reserved for deployable bundles — e.g. a single-binary pkg of the CLI+MCP)
  fixtures/
    graph-repos/                 # realistic sample graph repos for integration tests
    specs/                       # sample OpenAPI, AsyncAPI files for adapter tests
  docs/
    adr/ pdr/ vision/ architecture/
```

No `src/` at the top of each package — each package has its own `src/`, `test/`, `package.json`, and `tsconfig.json`. Project references keep incremental builds fast and enforce the dependency graph at compile time.

---

## 2. Clean-architecture layering

Each package belongs to exactly one layer. Dependencies point inward only.

| Layer | Packages | May depend on |
|---|---|---|
| **Domain** | `schema`, `template-core` | (nothing in the repo) |
| **Application** | `graph`, `linter`, `adapters-api` | Domain |
| **Adapters / Packs** | `adapter-openapi`, `adapter-asyncapi`, `pack-*` | Domain, `adapters-api`, `file-format` (for pack YAML only) |
| **Infrastructure** | `file-format`, `repo`, `cache` | Domain (for the types they serialise / persist) |
| **Interface** | `mcp-server`, `cli`, `web` | Application, Infrastructure (via composition root only) |
| **Composition** | `cli`, app bundles | Everything |

Enforced via `dependency-cruiser` rules (see [04 § Tooling](04-libraries-tooling-and-testing.md#tooling)). A pull request that introduces a back-edge fails CI.

---

## 3. Per-package responsibilities

### 3.1 Domain

#### `@corum/schema`

**Purpose:** The logical data model ([ADR-003b](../adr/ADR-003b-core-logical-data-model.md)) as pure TypeScript. Zero runtime dependencies.

**Exports:**

```
/src
  node.ts              # Node<TProps>, owned-node variants, universal properties
  edge.ts              # Edge, EdgeType vocabulary, core edge types as const
  field.ts             # Field-specific properties (fieldType, nullable, cardinality)
  component.ts         # Component, Graph
  identity.ts          # NodeId / EdgeId parsing, validation, formatting
  state.ts             # State + Stability enums and transitions
  errors.ts            # DomainError hierarchy
  index.ts
```

**Tests:** pure unit tests. Property-based tests for identity parsing via `fast-check`.

---

#### `@corum/template-core`

**Purpose:** Template pack model and operations ([ADR-004](../adr/ADR-004-template-pack-format.md)).

**Exports:**

```
/src
  template.ts          # Template, AbstractTemplate, TemplateMetadata
  pack.ts              # PackManifest, LoadedPack
  meta-schema.ts       # the template meta-schema JSON Schema
  extends.ts           # resolveExtendsChain(), mergeAllOf()
  loader.ts            # loadPack(path|url), loadPacks(config)
  errors.ts            # pack errors: CollisionError, AbstractInstantiationError, …
  index.ts
```

**Dependencies:** `@corum/schema`, `ajv` + `ajv-formats` for JSON Schema, `yaml` for parsing pack files.

**Tests:** unit tests for every extends scenario in ADR-004; meta-schema validation against every built-in pack.

---

### 3.2 Application

#### `@corum/graph`

**Purpose:** The command and query surface over the graph. Owns the runtime model and branch projection. Talks to infrastructure through ports.

**Ports (interfaces declared here, implemented by infra packages):**

```ts
export interface GraphRepository {
  fetchRef(ref: string): Promise<{ sha: string }>;
  diffPaths(fromSha: string, toSha: string): Promise<string[]>;
  readBlob(path: string, ref: string): Promise<Buffer>;
  writeCommitPush(changes: FileChange[], message: string, ref: string): Promise<{ sha: string }>;
  listOpenBranches(): Promise<BranchRef[]>;
}

export interface GraphCache {
  apply(plan: CacheApplyPlan): Promise<void>;
  getCluster(id: NodeId, opts: GetClusterOptions): Promise<ClusterResponse>;
  listClusters(filter: ClusterFilter, opts: ListOptions): Promise<ClusterSummary[]>;
  getLineage(from: NodeId, opts: LineageOptions): Promise<Subgraph>;
  // …see ADR-005 / REF-mcp-tool-catalogue
}
```

**Commands** (mutations) and **queries** are exposed as a `GraphService` that composes a `GraphRepository`, a `GraphCache`, and a loaded pack set.

**Tests:** integration tests with an in-memory `GraphCache` fake and the real `@corum/cache` for representative flows.

---

#### `@corum/linter`

**Purpose:** Rule engine + rule catalogue ([ADR-006](../adr/ADR-006-linter-and-validator.md), [REF-006-rules](../adr/REF-006-rules.md)).

**Exports:**

```
/src
  rule.ts              # Rule, Severity, Diagnostic types
  runner.ts            # LinterRunner with deployment profiles (cli, ci, startup)
  rules/
    file-format/       # rules derived from ADR-002
    template/          # rules derived from ADR-004
    edges/             # rules derived from ADR-004b
    data-model/        # rules derived from ADR-003b
  config.ts            # parses `linter` block of graph.yaml
  formatters/
    text.ts            # human-readable
    json.ts            # CI-consumable
    sarif.ts           # for GitHub PR annotations
  index.ts
```

Rules receive a read-only view of the loaded graph + pack set and emit `Diagnostic`s. No rule writes to the graph.

---

#### `@corum/adapters-api`

**Purpose:** Declares the `SpecAdapter` interface and adapter registration/lookup.

See [03 — Extensibility § Adapters](03-extensibility-packs-adapters-plugins.md#spec-adapters) for the full interface. The package itself is tiny — types plus a registry.

---

### 3.3 Infrastructure

#### `@corum/file-format`

**Purpose:** Canonical YAML cluster and edge file I/O ([ADR-002](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md)).

**Exports:**

```
/src
  parser.ts            # parseCluster(yaml), parseEdgeFile(yaml), parseGraphYaml(yaml)
  emitter.ts           # emitCluster(node, owned), emitEdgeFile(edges)
  safe-yaml.ts         # YAML 1.2 wrapper — rejects anchors across files, forbids !!
  schemas/             # JSON Schema per file type for IDE validation
  paths.ts             # expected file paths from node IDs and vice versa
  round-trip.ts        # stable re-emit preserving key order and comments
  index.ts
```

Uses the `yaml` package (not `js-yaml`) — it supports YAML 1.2 and preserves comments/anchors for round-trip.

---

#### `@corum/repo`

**Purpose:** Git integration via `isomorphic-git`. No shelling out. Works on Windows, macOS, Linux identically.

**Exports:**

```
/src
  git-repo.ts          # class GitGraphRepository implements GraphRepository
  refs.ts              # resolveBranch, listOpenBranches
  diff.ts              # diffPaths implementation using isomorphic-git
  write.ts             # commit + push using LFS-safe blob writes
  auth.ts              # SSH / HTTPS credential resolution
  index.ts
```

Tests: spin up a fixture repo under `fixtures/graph-repos/` with a known commit graph; assert diff outputs.

---

#### `@corum/cache`

**Purpose:** SQLite schema, migrations, and incremental apply ([ADR-003](../adr/ADR-003-graph-loading-and-runtime-representation.md)).

**Exports:**

```
/src
  schema.sql           # tables: nodes, edges, fields, field_mappings, branch_nodes, branch_edges, components
  migrations/          # versioned schema migrations
  apply.ts             # class SqliteGraphCache implements GraphCache
  queries/             # parameterised SQL for each graph query
    cluster.ts
    lineage.ts
    branch-projection.ts
  index.ts
```

Uses `better-sqlite3` (synchronous, fast, embedded). The SQLite file is the same artefact as the local cache from ADR-001.

---

### 3.4 Packs and adapters

Every built-in pack ships as a separate package under `pack-*`. The pack package contains:

```
/src
  pack.yaml            # declared inputs to the loader
  templates/*.yaml     # the templates themselves
  index.ts             # exports a `resolve()` function returning the pack path
```

Spec-aligned packs (`pack-rest`, `pack-messaging`) depend on and re-export their adapter package so that installing one pack pulls its adapter in:

```json
// pack-rest/package.json
{
  "dependencies": {
    "@corum/adapter-openapi": "workspace:*"
  }
}
```

See [03 — Extensibility](03-extensibility-packs-adapters-plugins.md) for the full extensibility treatment.

---

### 3.5 Interface

#### `@corum/mcp-server`

**Purpose:** MCP tool surface per [ADR-005](../adr/ADR-005-mcp-interface-design.md) and the [tool catalogue](../adr/REF-mcp-tool-catalogue.md).

**Exports:**

```
/src
  server.ts            # MCP server setup using @modelcontextprotocol/sdk
  tools/
    get-cluster.ts
    list-clusters.ts
    get-lineage.ts
    get-field-lineage.ts
    search.ts
    get-threads.ts
    get-drift-detail.ts
    get-branch-versions.ts
    get-branch-conflicts.ts
    create-cluster.ts
    update-cluster.ts
    remove-cluster.ts
    create-edge.ts
    remove-edge.ts
    create-field-mapping.ts
    rename-node.ts
    create-thread.ts
    resolve-thread.ts
    sync.ts
    list-branches.ts
    create-branch.ts
    get-template.ts
    validate-cluster.ts
    get-graph-summary.ts
  responses.ts         # layered cluster response assembler
  index.ts
```

Each tool is a thin adapter: parse MCP arguments → call a `GraphService` method → shape the response.

---

#### `@corum/cli`

**Purpose:** Commands for humans and CI. Uses `commander` or `clipanion`.

```
/src
  index.ts             # entry
  commands/
    init.ts            # scaffold a new graph repo
    lint.ts            # @corum/linter with formatters
    import.ts          # import <format> <path>
    export.ts          # export <format> <namespace>
    sync.ts            # refresh cache
    migrate.ts         # template major-version migration
    serve.ts           # start the MCP server (stdio or HTTP transport)
    validate.ts        # validate without writing
    rename.ts          # wraps the rename graph command
  composition.ts       # wires up all packages — the only place with wide imports
```

`composition.ts` is the **composition root** — it is the single place allowed to import across layer boundaries (per dependency-cruiser rules).

---

### 3.6 UI (deferred)

#### `@corum/ui-core` (future)

Headless hooks and types shared between the MCP/CLI tooling and the web app: template renderer contract, cluster response types (already exported from `@corum/schema` — UI-core adds React-specific helpers only), filter-object form builders. No runtime DOM.

#### `@corum/web` (future)

React app. Consumes `@corum/mcp-server` via HTTP transport or a small REST wrapper.  Perspective-per-node-type registry. Pulls template UI hints from loaded packs.

Both are scaffolded but empty in v1.

---

## 4. Dependency rules

Enforced in `.dependency-cruiser.cjs`:

```js
module.exports = {
  forbidden: [
    // Domain may not import anything
    { from: { path: '^packages/schema' }, to: { pathNot: '^packages/schema' } },
    { from: { path: '^packages/template-core' }, to: { pathNot: '^packages/(schema|template-core)' } },

    // Application may not import infrastructure
    { from: { path: '^packages/graph' }, to: { path: '^packages/(repo|cache|file-format|mcp-server|cli|web)' } },
    { from: { path: '^packages/linter' }, to: { path: '^packages/(repo|cache|mcp-server|cli|web)' } },

    // Infrastructure may not import application
    { from: { path: '^packages/(repo|cache|file-format)' }, to: { path: '^packages/(graph|linter|mcp-server|cli|web)' } },

    // Interface may not import infrastructure directly (only via composition.ts in cli)
    { from: { path: '^packages/mcp-server' }, to: { path: '^packages/(repo|cache)' } },

    // No upward dependencies on composition roots
    { from: {}, to: { path: '^packages/cli$|^packages/web$' } },
  ],
};
```

The `composition.ts` file in `@corum/cli` is excluded — it is the only entry point allowed to know the full graph.

---

## 5. Versioning and releases

- **Independent versioning** per package. Changesets (`@changesets/cli`) tracks which packages changed and computes semver bumps.
- **Template packs follow ADR-004 versioning** — patch/minor/major map to template schema compatibility, not code. `pack.yaml`'s `version` and the package's `package.json` version are kept in sync by a release step.
- **Schema file format version** (`schema-version` in cluster files, [ADR-002 § Schema Versioning](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md#schema-versioning)) lives in `@corum/schema` and is published as `SCHEMA_VERSION`. Breaking changes require a migration command in `@corum/cli`.

---

## 6. Cross-package conventions

- **No default exports.** Always named.
- **Errors are typed** — every package exports a discriminated `XxxError` union. No `throw new Error('...')` with stringly-typed messages at package boundaries.
- **All I/O returns `Promise`.** No sync APIs at package boundaries (except `@corum/cache`, which exposes both because `better-sqlite3` is sync — the sync variants are internal-only).
- **No `any`.** `unknown` at boundaries, validated.
- **Every package has a `test/` alongside `src/`.** Unit tests co-located; integration tests in a top-level `test/integration/`.

---

## 7. Folder conventions inside a package

```
packages/<name>/
  package.json
  tsconfig.json
  vitest.config.ts           # only if overriding root config
  README.md                  # 1-page: what this package does, 1 code example
  src/
    index.ts                 # the public API — everything else is internal
    <domain-files>.ts
    <domain>/                # subdirectories only when a concept has > 3 files
      index.ts
      ...
  test/
    <domain-files>.test.ts
    fixtures/
```

`src/index.ts` is the only surface other packages may import. No deep imports (enforced via `package.json` `"exports"` field).

---

## Related

- [01 — Architecture Overview](01-architecture-overview.md)
- [03 — Extensibility: Packs, Adapters, Plugins](03-extensibility-packs-adapters-plugins.md)
- [04 — Libraries, Tooling and Testing](04-libraries-tooling-and-testing.md)
