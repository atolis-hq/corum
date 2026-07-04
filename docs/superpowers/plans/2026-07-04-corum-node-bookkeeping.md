# Corum Node Bookkeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move rename-history bookkeeping out of template properties into `corum.identity.previousIds`, update the core node schema, and keep loader compatibility during migration.

**Architecture:** Add a canonical `corum` bookkeeping block to the runtime node model, teach the loader to normalize old and new YAML shapes into that model, then switch writers, mutators, linter rules, MCP surfaces, and tests to the new structure. Finish by wiring the MCP write smoke runner into CI for filesystem and local-git coverage.

**Tech Stack:** TypeScript, YAML cluster loader/writer, Node test runner, GitHub Actions

---

### Task 1: Schema And Red Tests

**Files:**
- Modify: `.corum/packs/core/node.schema.yaml`
- Modify: `test/loader.test.ts`
- Modify: `test/round-trip.test.ts`
- Modify: `test/mutate.test.ts`
- Modify: `test/linter.test.ts`

- [ ] Add failing tests that expect `corum.identity.previousIds` to load, survive round-trip, and validate as rename history.
- [ ] Add a failing test that old `properties.previousNames` still loads during migration.
- [ ] Update `node.schema.yaml` so root documents explicitly allow the reserved `corum` section and define `corum.identity.previousIds`.

### Task 2: Runtime Canonical Model

**Files:**
- Modify: `src/schema/index.ts`
- Modify: `src/loader/cluster-loader.ts`
- Modify: `src/writer/graph-writer.ts`

- [ ] Add a typed `corum` bookkeeping block to `Node`.
- [ ] Normalize loaded YAML so the runtime uses one canonical field for previous IDs.
- [ ] Write only the new `corum.identity.previousIds` shape back to YAML.

### Task 3: Mutation, Reconcile, And Linter Migration

**Files:**
- Modify: `src/mutate/rename.ts`
- Modify: `src/mutate/apply-cluster.ts`
- Modify: `src/reconcile/index.ts`
- Modify: `src/linter/index.ts`

- [ ] Move rename/update/reconcile logic from `properties.previousNames` to the canonical runtime field.
- [ ] Replace the special-case property rule with `corum.identity.previousIds` validation.
- [ ] Keep linter behavior compatible for old files only through loader normalization, not as a second canonical write path.

### Task 4: MCP, Fixtures, And Smoke Coverage

**Files:**
- Modify: `src/mcp/index.ts`
- Modify: `src/mcp/write-smoke.ts`
- Modify: `test/mcp.test.ts`
- Modify: `test/mcp-write-smoke.test.ts`
- Modify: fixture YAMLs/assertions as needed

- [ ] Expose the new bookkeeping shape consistently through read and write flows.
- [ ] Update smoke tests and MCP assertions to check `corum.identity.previousIds`.

### Task 5: CI And Verification

**Files:**
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `package.json` only if the CI invocation needs a stable script shape

- [ ] Add `npm run mcp:write-smoke` to CI after `npm test`.
- [ ] Run focused tests first, then `npm run mcp:write-smoke`, then full `npm test`.
- [ ] Commit after verification.
