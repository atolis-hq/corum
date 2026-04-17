# 04 — Libraries, Tooling and Testing

**Status:** Draft v0.1
**Last updated:** 2026-04-16
**Relates to:** [01 — Architecture Overview](01-architecture-overview.md), [02 — Packages and Folder Structure](02-packages-and-folder-structure.md)

---

## 1. Library selections

Each selection below names a library, the layer it belongs to, and the **only** reason we depend on it. If the reason dissolves, the dependency goes with it. Selections are recommendations for the first implementation pass — they are revisable.

### 1.1 Foundation

| Concern | Library | License | Why |
|---|---|---|---|
| Runtime | Node.js 22 LTS | — | Ecosystem alignment with MCP, IDE tooling, agent frameworks |
| Language | TypeScript 5.x | Apache-2.0 | Type safety across packages; shared with the React UI |
| Workspace | pnpm | MIT | Fast, strict, monorepo-native; hoisting semantics we can reason about |
| Build | `tsc` via project references | Apache-2.0 | Simplest correct tool for typed libraries; no bundler until we ship binaries |
| Bundler (CLI/MCP dist) | `tsup` | MIT | ESM/CJS/DTS single-invocation; fast dev iteration |
| Release | `@changesets/cli` | MIT | Per-package semver; clear changelogs; industry-standard |

### 1.2 Schema, YAML, JSON Schema

| Concern | Library | License | Why |
|---|---|---|---|
| YAML 1.2 parser/emitter | `yaml` (eemeli/yaml) | ISC | YAML 1.2 conformance (no Norway problem), comment preservation, round-trip stable emission. Required by [ADR-002](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md#yaml-safety-constraints) |
| JSON Schema validator | `ajv` + `ajv-formats` + `ajv-draft-04` | MIT | Fastest mainstream validator; supports Draft 7 / 2019-09 / 2020-12 per [ADR-004](../adr/ADR-004-template-pack-format.md) |
| JSON Schema from TS types (dev helper) | `ts-json-schema-generator` | MIT | Generate fixture JSON Schemas from TypeScript interfaces — dev-time only |
| Property-based testing | `fast-check` | MIT | Identity parsing, template merge invariants, round-trip stability |

### 1.3 Git and filesystem

| Concern | Library | License | Why |
|---|---|---|---|
| Git | `isomorphic-git` | MIT | Pure JS reimplementation of Git — closest equivalent to C#'s LibGit2Sharp in spirit. No native bindings, no shell-out, no system `git` required. Works identically on Windows/macOS/Linux/CI containers. Fits the zero-infra mandate of [ADR-001](../adr/ADR-001-storage-and-interaction-architecture.md) |
| Diff between refs | `isomorphic-git` `walk()` + own diff | MIT | We only need name-only diff per ADR-001 §Cache Model |
| Atomic file writes | `write-file-atomic` | ISC | Temp-sibling + atomic rename for mutation write path; handles cross-platform edge cases and replaces the bespoke recovery-journal contract |
| Glob | `fast-glob` | MIT | For linter `ignore` patterns in `graph.yaml` |
| Path handling | Node stdlib | — | No dep |

*Alternatives considered and rejected:*

- **`nodegit`** (N-API wrapper over libgit2) — the natural pick by analogy to LibGit2Sharp. Rejected because it requires a C++ toolchain to build on install (node-gyp, Python, a platform compiler); historically painful on Windows across MSVC versions; lags behind new Node majors waiting for native rebuild. This violates the zero-infra, zero-native-toolchain adoption bar. If we ever outgrow `isomorphic-git`'s performance on very large graph repos (not a v1 concern), revisit — but only behind a port so it remains replaceable.
- **`simple-git`** (wrapper shelling to the system `git` binary). Rejected because it assumes a Git install on the host, breaks on constrained CI and container images, and introduces shell-escape and cross-platform path/ACL concerns we have committed to avoiding.

### 1.4 SQLite

| Concern | Library | License | Why |
|---|---|---|---|
| Embedded SQLite | `node:sqlite` | — | Node 22.5+ built-in; no native compilation required; synchronous API. Eliminates the native-toolchain dependency that `better-sqlite3` would introduce — consistent with the zero-native-build constraint applied to `isomorphic-git` |
| Migrations | `umzug` | MIT | Migration-only library (no ORM); versioned, file-based, minimal. Addresses the migration concern without the query-shaping overhead of a full ORM |

### 1.5 MCP

| Concern | Library | License | Why |
|---|---|---|---|
| MCP server | `@modelcontextprotocol/sdk` | MIT | Official SDK; ships stdio and HTTP transports; required to interoperate with Claude Desktop, Cursor, IDE clients |
| MCP client (tests) | `@modelcontextprotocol/sdk` | MIT | Same SDK drives integration tests |

### 1.6 CLI

| Concern | Library | License | Why |
|---|---|---|---|
| CLI framework | `clipanion` | MIT | Typed commands, decorator-free, excellent error messages, used by Yarn |
| Colours / formatting | `picocolors` | ISC | Small, dependency-free replacement for `chalk` |
| Prompts (interactive) | `@clack/prompts` | MIT | Modern, minimal, good a11y |
| Progress/logging | `pino` | MIT | Structured JSON logs in CI mode, pretty in TTY |

*Alternative:* `commander`, `oclif`. `commander` is fine; `oclif` is overbuilt. Clipanion is a good fit for the command tree we need.

### 1.7 Spec adapters

| Format | Library | License | Why |
|---|---|---|---|
| OpenAPI | `openapi-types` + `@redocly/openapi-core` | MIT + Apache-2.0 | Types + a validated, resolved spec parser that handles $ref correctly |
| AsyncAPI | `@asyncapi/parser` | Apache-2.0 | Official parser; handles v2 → v3 |
| GraphQL SDL (planned) | `graphql` (reference impl) | MIT | Canonical parser |
| TypeSpec (future) | `@typespec/compiler` | MIT | Official; exposes its AST |

### 1.8 UI (future — scaffold only in v1)

| Concern | Library | License | Why |
|---|---|---|---|
| Framework | React 19 | MIT | Ecosystem fit; matches the stated React app requirement |
| Build | Vite 5 | MIT | Fast dev server, esbuild, native TS |
| State | Zustand or TanStack Query | MIT | Small, composable; Query pairs naturally with the MCP/REST layer |
| Types sharing | `@corum/schema` + `@corum/ui-core` | — | Same types server- and client-side |

Deferred — these are placeholder commitments, revisable when the UI ADR lands.

### 1.9 Libraries we deliberately don't use

- **ORMs (`drizzle`, `prisma`, `typeorm`)** — SQLite CTEs for recursive graph queries work better when written directly. ORMs get in the way of the projection queries. (`umzug` is migration-only and not an ORM.)
- **`better-sqlite3`** — requires native bindings (node-gyp, platform compiler), violating the zero-native-toolchain constraint. `node:sqlite` (Node 22.5+, stable) covers the same synchronous SQLite API without native compilation.
- **`js-yaml`** — YAML 1.1; suffers the Norway problem (`NO` parsed as `false`). Prohibited by [ADR-002](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md#yaml-safety-constraints).
- **`chalk`** — big dependency tree for what `picocolors` does in 100 lines.
- **`lodash`** — modern TypeScript has what we need in the stdlib and in small focused packages.
- **A graph database (Neo4j, Memgraph, TinkerGraph, Oxigraph)** — evaluated and rejected in [ADR-003](../adr/ADR-003-graph-loading-and-runtime-representation.md). Revisit for the hosted commercial tier.
- **A full CQRS framework** — commands and queries in `@corum/graph` are just typed functions.

---

## 2. Tooling

### 2.1 Layer boundaries — `dependency-cruiser`

`.dependency-cruiser.cjs` enforces the [clean-architecture rules](02-packages-and-folder-structure.md#4-dependency-rules). Runs in CI; a back-edge is a failing check.

### 2.2 Type and style

| Tool | Purpose |
|---|---|
| `typescript` `--strict` + `noUncheckedIndexedAccess` | Stricter than default strict mode |
| `biome` | One tool for formatting and linting; faster than ESLint+Prettier; sensible defaults |
| `vitest` | Test runner — ESM-native, Vite-powered, fast |
| `dependency-cruiser` | Layer boundary enforcement |
| `@changesets/cli` | Release coordination |

*Alternative for linting:* ESLint + Prettier. Biome covers the 95% case with a tenth of the config. Fall back to ESLint if a specific plugin we need doesn't have a Biome equivalent (no such case known yet).

### 2.3 CI

- **Per-PR:** `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm depcruise` → `corum lint` against a fixture graph.
- **Release:** changesets, publish to npm, bump built-in pack versions.

### 2.4 Local dev

- `pnpm dev` — watches all packages via tsc `--build --watch`.
- `pnpm test --watch` — vitest watch.
- `pnpm corum` — runs the CLI from the workspace without publishing.

---

## 3. Testing strategy

Testing mirrors the architecture layering. Each layer has a test style that matches its concerns; cross-layer tests live in `test/integration/`.

### 3.1 Domain — unit tests, property-based where useful

Packages: `@corum/schema`, `@corum/template-core`.

- Plain vitest unit tests for every public function.
- `fast-check` property tests for: `NodeId` parse/format round-trips, template `extends` merge idempotence (`merge(a, merge(a, b)) === merge(a, b)`), abstract-template detection.
- Zero dependencies in these tests other than vitest and fast-check.

Target coverage: 95%+ line and branch. The domain is small and worth exhausting.

### 3.2 Application — unit tests with in-memory fakes

Packages: `@corum/graph`, `@corum/linter`.

- Tests run against in-memory `GraphRepository` and `GraphCache` fakes that implement the port contracts from `@corum/schema`.
- Linter rules tested per-rule, each with representative fixture files exercising both pass and fail cases. The fixtures live under `packages/linter/test/fixtures/` as minimal YAML files.
- Contract tests for the `GraphCache` port run against both the fake and the real `@corum/cache` implementation - any behaviour divergence is a bug.

### 3.3 Infrastructure — isolated integration tests

Packages: `@corum/file-format`, `@corum/repo`, `@corum/cache`.

- `file-format` — round-trip tests: parse every sample cluster file from ADR-002, re-emit, assert byte-equal (modulo line endings).
- `repo` — spins up a fixture Git repo in a `tmpdir` per test via `isomorphic-git`, exercises `fetchRef`, `diffPaths`, `writeCommitPush`. No network.
- `cache` — creates an in-memory SQLite database per test, applies known fixture changes, asserts on query output.

### 3.4 Interface — MCP and CLI

- `@corum/mcp-server` — in-process MCP client talks to the server over a mock transport; every tool in the catalogue has a test for happy path, invalid args, and one representative failure mode.
- `@corum/cli` — runs the CLI as a subprocess in integration tests; captures stdout/stderr and exit code; asserts against golden output.

### 3.5 End-to-end — `test/integration/`

The most valuable tests. Each scenario is a complete flow against a real fixture graph repo under `fixtures/graph-repos/`:

- **Cold start** — load a non-trivial graph, assert SQLite state matches expected.
- **Warm start with incremental diff** — snapshot the cache, mutate the fixture repo, reload, assert only changed files were re-parsed.
- **Multi-branch projection** — three open branches with overlapping node edits, assert the merged view and conflict detection are correct.
- **Import OpenAPI → propose → agree → export OpenAPI** — full loop; assert the exported spec is byte-equivalent to the input for the agreed subset.
- **Linter rule catalogue** — a single fixture repo designed to trigger every rule at least once, asserted against a golden diagnostic set.
- **Direct file access + MCP interoperability** — edit a YAML file on disk, restart MCP, assert the change is visible.

All integration tests are deterministic — no wall-clock sleeps, fixed `lastModifiedAt` values, stable UUIDs.

### 3.6 Contract tests for extensions

The contract test suite is co-located with `@corum/adapter-openapi` and exported as a shared test helper. Any adapter or output plugin imports and runs it against its own implementation. This is the primary safety net for third-party extensions.

### 3.7 Performance

A tiny benchmark harness under `bench/` using `vitest bench`. Targets:

- Cold start on a 1k-node graph — under 2 s.
- Warm start with no diff — under 200 ms.
- `get cluster` tool latency — under 20 ms p95.
- `get lineage` depth 5 — under 50 ms p95.

These are goals, not gates. If they regress >30% in a PR, the PR is flagged.

---

## 4. Security and supply chain

- `pnpm audit` in CI with a failure threshold on high and critical.
- `osv-scanner` or equivalent in CI for Git-based dependency audit.
- Renovate / Dependabot keeping dependencies current — weekly PRs, manual review for majors.
- `publint` run before npm publish to catch misconfigured `exports`.

---

## 5. Documentation

- Every package has a `README.md` with: one-paragraph purpose, one install line, one code example.
- Every public function has a JSDoc line — consumed by API docs (Typedoc) at release time.
- ADR and PDR documents remain the normative source — this architecture directory *synthesises*; it does not override.

---

## Related

- [01 — Architecture Overview](01-architecture-overview.md)
- [02 — Packages and Folder Structure](02-packages-and-folder-structure.md)
- [03 — Extensibility: Packs, Adapters, Plugins](03-extensibility-packs-adapters-plugins.md)
