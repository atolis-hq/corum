# Design: npm Publishing & CLI — `@atolis-hq/corum`

Date: 2026-06-18

## Overview

Publish corum as `@atolis-hq/corum` on npm. This covers three things: wiring the CLI commands (`mcp`, `web`, `init`) into the existing commander setup; adding `.corum/config.yaml` discovery so users don't need env vars; and a GitHub Actions pipeline that patch-bumps and publishes on every merge to main.

## 1. Package

- Remove `"private": true` from `package.json`
- Package name: `@atolis-hq/corum` (public scoped package)
- The existing `bin` entry is already correct: `"corum": "./dist/src/bin/corum.js"`
- Add `semver` as a dependency (used by the publish workflow)

## 2. CLI Commands

All commands live under `src/bin/corum.ts` using `commander`. This is the single entrypoint — Option A from the design discussion.

> Note: A future library-first refactor (`src/runtime/`) would be the right path if external consumers of the startup API emerge. For now, the CLI is the only consumer.

```
corum mcp            Start the MCP stdio server + web UI (default)
  --no-web           Suppress the web UI
  --watch            Enable file watcher
  --graph <path>     Override graph path (overrides env var and config file)

corum web            Start the web UI only
  --port <n>         Port (default: resolved from config/env/3000)
  --graph <path>     Override graph path

corum import         Import specifications into the graph (already exists)
  openapi <spec>     Import an OpenAPI spec

corum init           Scaffold .corum/config.yaml with commented defaults
                     Exits with an error message if the file already exists — does not overwrite
```

### `src/mcp/index.ts` refactor

The `if (isEntrypoint())` block is extracted into an exported `startMcpServer(opts)` function. `corum mcp` calls it with options from commander. The `process.argv.includes('--watch')` / `process.argv.includes('--no-web')` ad-hoc parsing is removed in favour of commander options passed through.

## 3. Config File

**Location:** `.corum/config.yaml`, resolved by walking up from `cwd` until found (same pattern as `.git`).

**Precedence (lowest → highest):** config file → environment variable → CLI flag

**Extension point:** `createGraphRuntimeConfig()` in `src/source/config.ts` gains a config file resolution step inserted before the env var fallback.

### Generated file (`corum init`)

`corum init` creates `.corum/config.yaml` if it does not already exist. If the file exists, it prints a message and exits without changes.

```yaml
# Corum project configuration

# source: git          # 'git' (default) or 'file'
# graph: .corum/graph  # path to graph directory

# Git source options (when source: git)
# branch: main         # default branch to load
```

## 4. GitHub Actions

### `ci.yml` — runs on all pushes and PRs

- Trigger: `push` (all branches) and `pull_request`
- Steps: checkout → Node setup → `npm ci` → `npm test`
- Does **not** publish

### `publish.yml` — runs on push to `main` only

- Trigger: `push` to `main`
- Permissions: `id-token: write` (OIDC for npm Trusted Publisher), `contents: write` (version bump commit)
- Steps:
  1. Checkout (with full history for the version bump commit)
  2. Node setup
  3. `npm ci`
  4. `npm test` — publish workflow re-runs tests itself; it does not depend on `ci.yml`
  5. Read latest published version: `npm view @atolis-hq/corum version` (handles 404 gracefully for first publish)
  6. Compute next patch version using `semver` package: `semver.inc(latest, 'patch')`
  7. Write new version: `npm version <next> --no-git-tag-version`
  8. Commit version bump back to main: `git commit -am "chore: bump version to <next> [skip ci]"`
  9. `npm publish --access public --provenance`

### One-time bootstrap (Trusted Publishers)

npm Trusted Publishers requires the package to exist on npm before it can be configured. First publish is manual:

1. Log in to npm: `npm login`
2. Publish once: `npm publish --access public` (from local, on `main`)
3. On npmjs.com → `@atolis-hq/corum` → Settings → Configure GitHub Actions as Trusted Publisher:
   - Repository: `atolis-hq/corum`
   - Workflow: `publish.yml`
4. After this, no npm token is needed in GitHub secrets — OIDC handles auth

## 5. Out of Scope

- `corum export`, `corum lint`, `corum add-pack` — future commands, not included
- Interactive `corum config` wizard — `corum init` covers basic scaffolding; a full interactive config command is a follow-up
- Major/minor version bump strategy — patch-only for now; strategy TBD
- Usage guide / npm README — separate task
