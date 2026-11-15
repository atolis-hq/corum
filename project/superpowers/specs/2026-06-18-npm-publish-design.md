# Design: npm Publishing & CLI — `@atolis-hq/corum`

Date: 2026-06-18

## Overview

Publish corum as `@atolis-hq/corum` on npm. This covers three things: wiring the CLI commands (`mcp`, `web`, `init`) into the existing commander setup; adding `.corum/config.yaml` discovery so users don't need env vars; and a GitHub Actions pipeline that patch-bumps and publishes on every merge to main.

## 1. Package

- Remove `"private": true` from `package.json`
- Package name: `@atolis-hq/corum` (public scoped package)
- The existing `bin` entry is already correct: `"corum": "./dist/src/bin/corum.js"`
- No additional runtime dependencies — versioning handled by `paulhatch/semantic-version` GitHub Action

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

All keys map directly to the corresponding `CORUM_*` environment variable. Env vars override config file values; CLI flags override env vars.

```yaml
# Corum project configuration
# Uncomment and set the options relevant to your setup.
# All values can be overridden by environment variables (CORUM_*) or CLI flags.

# Source type: 'file' (default) or 'git'
# Maps to: CORUM_SOURCE
# source: file

# ── File source (default) ────────────────────────────────────────────────────
# Local path to the graph directory.
# Maps to: CORUM_GRAPH_PATH
# graph: .corum/graph

# ── Git source ───────────────────────────────────────────────────────────────
# Uncomment 'source: git' above and configure one of the following:

# Local path to a git repository containing the graph.
# Maps to: CORUM_GIT_LOCAL_PATH
# git_local_path: /path/to/repo

# Remote URL of a git repository containing the graph.
# Maps to: CORUM_GIT_REMOTE_URL
# git_remote_url: https://github.com/org/repo

# Default branch to load (git source only).
# Maps to: CORUM_GIT_BRANCH
# git_branch: main

# How often to poll the remote for changes, in seconds (remote git only).
# Maps to: CORUM_GIT_POLL_SECONDS
# git_poll_seconds: 30

# Auth token for private repositories. Prefer setting CORUM_GIT_TOKEN as an
# environment variable rather than storing a token in this file.
# git_token: ""

# Auth username (default: x-access-token, suits GitHub PATs and Actions tokens).
# Maps to: CORUM_GIT_USERNAME
# git_username: x-access-token
```

## 4. GitHub Actions

### `ci-cd.yml` — single workflow, conditional publish

**Trigger:** `push` (all branches) and `pull_request`.

Two jobs:

**`test` job** — always runs:
1. Checkout
2. Node setup
3. `npm ci`
4. `npm test`

**`publish` job** — runs only on push to `main` (`if: github.ref == 'refs/heads/main' && github.event_name == 'push'`), depends on `test` passing (`needs: test`):

Permissions: `id-token: write` (npm provenance), `contents: write` (git tag push).

Steps:
1. Checkout (`fetch-depth: 0` — semantic-version needs full history)
2. Node setup with `registry-url: https://registry.npmjs.org`
3. `npm ci`
4. `npm run build`
5. `paulhatch/semantic-version@v5.4.0` — reads git tags, outputs next version. Default: patch bump. Add `(MAJOR)` or `(MINOR)` to commit messages for larger bumps.
6. `npm version <output> --no-git-tag-version` — updates `package.json` in CI working copy only (not committed — main is branch-protected)
7. `npm publish --access public --provenance`
8. `git tag v<version> && git push origin v<version>` — tags the release so the next run increments correctly

### One-time bootstrap

1. `npm login && npm publish --access public` (first publish from local — creates the package on npm)
2. Set `NPM_TOKEN` as a repository secret (GitHub → Settings → Secrets → Actions → New repository secret)
3. Push the initial tag: `git tag v0.1.0 && git push origin v0.1.0` — gives semantic-version a base to increment from

## 5. Out of Scope

- `corum export`, `corum lint`, `corum add-pack` — future commands, not included
- Interactive `corum config` wizard — `corum init` covers basic scaffolding; a full interactive config command is a follow-up
- Major/minor bump: use `(MAJOR)` or `(MINOR)` in commit messages — already supported by the workflow
- Usage guide / npm README — separate task
