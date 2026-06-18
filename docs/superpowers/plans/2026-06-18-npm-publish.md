# npm Publishing & CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `@atolis-hq/corum` to npm with a full CLI (`mcp`, `web`, `init`), `.corum/config.yaml` discovery, and a GitHub Actions CI/CD pipeline that patch-bumps and publishes on every push to main.

**Architecture:** A single CLI entrypoint (`src/bin/corum.ts`) handles all commands. The MCP server startup logic is extracted from `src/mcp/index.ts` into an exported `startMcpServer()` function called by both the CLI and the legacy `npm run mcp` entrypoint. Config file discovery is added to `src/source/config-file.ts` and wired into `createGraphRuntimeConfig()` as the lowest-precedence source.

**Tech Stack:** Node 20, TypeScript 5, commander 14, yaml, GitHub Actions (`paulhatch/semantic-version`).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/ci-cd.yml` | Create | CI/CD pipeline |
| `src/source/config-file.ts` | Create | `.corum/config.yaml` discovery and parsing |
| `test/config-file.test.ts` | Create | Unit tests for config file module |
| `package.json` | Modify | Rename, remove private, add files field |
| `src/source/config.ts` | Modify | Merge config file values into runtime config |
| `src/mcp/index.ts` | Modify | Extract `startMcpServer()` export |
| `src/bin/corum.ts` | Modify | Add `mcp`, `web`, `init` commands |

---

## Task 1: Stub ci-cd.yml on main

A minimal workflow must exist in `main` before the full PR is opened, so GitHub Actions will pick it up for PR runs. Since main is branch-protected, this goes in via its own small PR.

**Files:**
- Create: `.github/workflows/ci-cd.yml`

- [ ] **Step 1: Create a short-lived branch from main**

```bash
git checkout main
git checkout -b stub-cicd
mkdir -p .github/workflows
```

- [ ] **Step 2: Write the stub workflow**

Create `.github/workflows/ci-cd.yml`:

```yaml
name: CI/CD

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
```

- [ ] **Step 3: Commit, push, and open a PR to main**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: add stub ci-cd workflow (test only)"
git push -u origin stub-cicd
gh pr create --title "ci: add stub ci-cd workflow" --body "Adds a minimal CI workflow (test only) to main so the full NpmPublish PR can trigger CI runs. No publish logic yet."
```

- [ ] **Step 4: Wait for approval and merge**

Have the PR approved and merged via GitHub. Do not continue until it is merged.

- [ ] **Step 5: Switch back to NpmPublish and rebase onto updated main**

```bash
git checkout NpmPublish
git fetch origin
git rebase origin/main
```

---

## Task 2: Update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json**

Apply these changes to `package.json`:

```json
{
  "name": "@atolis-hq/corum",
  "version": "0.1.0",
  "type": "module",
  "files": [
    "dist/src/",
    "web/"
  ],
  "bin": {
    "corum": "./dist/src/bin/corum.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "tsc && node --test dist/test",
    "wireframes": "node design/wireframes/server.mjs",
    "mcp": "node dist/src/mcp/index.js",
    "mcp:smoke": "npm run build && node scripts/mcp-smoke.mjs",
    "web": "node dist/src/web/server.js"
  },
  "dependencies": {
    "@apidevtools/swagger-parser": "^12.1.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@toon-format/toon": "^2.1.0",
    "commander": "^14.0.3",
    "express": "^4.22.1",
    "isomorphic-git": "^1.37.6",
    "openapi-types": "^12.1.3",
    "yaml": "^2.3.4"
  },
  "devDependencies": {
    "@types/express": "^4.17.25",
    "@types/node": "^20.0.0",
    "@types/swagger-parser": "^4.0.3",
    "typescript": "^5.0.0"
  }
}
```

Key changes: removed `"private": true`, renamed to `@atolis-hq/corum`, added `"files"` field.

- [ ] **Step 2: Build and test to confirm nothing broke**

```bash
npm test
```

Expected: build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: rename to @atolis-hq/corum, add files field"
```

---

## Task 3: Config file module

**Files:**
- Create: `src/source/config-file.ts`
- Create: `test/config-file.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/config-file.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadProjectConfig } from '../src/source/config-file.js'

describe('loadProjectConfig', () => {
  it('returns empty object when no config file exists', () => {
    const result = loadProjectConfig(os.tmpdir())
    assert.deepEqual(result, {})
  })

  it('loads config from .corum/config.yaml in cwd', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'source: git\ngit_branch: develop\n')
    try {
      const result = loadProjectConfig(dir)
      assert.equal(result.source, 'git')
      assert.equal(result.git_branch, 'develop')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('finds config file in a parent directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(root, '.corum'))
    fs.writeFileSync(path.join(root, '.corum', 'config.yaml'), 'graph: /custom/graph\n')
    const nested = path.join(root, 'subdir', 'deep')
    fs.mkdirSync(nested, { recursive: true })
    try {
      const result = loadProjectConfig(nested)
      assert.equal(result.graph, '/custom/graph')
    } finally {
      fs.rmSync(root, { recursive: true })
    }
  })

  it('returns empty object when config file is all comments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), '# all commented out\n')
    try {
      const result = loadProjectConfig(dir)
      assert.deepEqual(result, {})
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('parses git_poll_seconds as a number', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'git_poll_seconds: 60\n')
    try {
      const result = loadProjectConfig(dir)
      assert.equal(result.git_poll_seconds, 60)
      assert.equal(typeof result.git_poll_seconds, 'number')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: compilation error — `Cannot find module '../src/source/config-file.js'`.

- [ ] **Step 3: Implement `src/source/config-file.ts`**

```typescript
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export type CorumConfig = {
  source?: string
  graph?: string
  git_local_path?: string
  git_remote_url?: string
  git_branch?: string
  git_poll_seconds?: number
  git_token?: string
  git_username?: string
}

export function loadProjectConfig(cwd: string): CorumConfig {
  const configPath = findConfigFile(cwd)
  if (!configPath) return {}
  const content = readFileSync(configPath, 'utf8')
  return (parseYaml(content) as CorumConfig | null) ?? {}
}

function findConfigFile(cwd: string): string | undefined {
  let dir = cwd
  while (true) {
    const candidate = path.join(dir, '.corum', 'config.yaml')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all `loadProjectConfig` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/source/config-file.ts test/config-file.test.ts
git commit -m "feat: add .corum/config.yaml discovery module"
```

---

## Task 4: Wire config file into createGraphRuntimeConfig

**Files:**
- Modify: `src/source/config.ts`
- Modify: `test/source.test.ts`

- [ ] **Step 1: Write failing tests**

Add these test cases to the `createGraphRuntimeConfig` describe block in `test/source.test.ts`. Find the end of the existing `describe('createGraphRuntimeConfig', ...)` block and add:

```typescript
  it('uses config file value when env var not set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'graph: /from/config\n')
    try {
      const config = createGraphRuntimeConfig({}, dir)
      assert.equal(config.graphPath, '/from/config')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('env var takes precedence over config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'graph: /from/config\n')
    try {
      const config = createGraphRuntimeConfig({ CORUM_GRAPH_PATH: '/from/env' }, dir)
      assert.equal(config.graphPath, '/from/env')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
```

You'll also need to add these imports to `test/source.test.ts` if not already present:

```typescript
import fs from 'node:fs'
import os from 'node:os'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: the two new tests fail — config file is not yet consulted.

- [ ] **Step 3: Update `src/source/config.ts`**

Replace the entire file with:

```typescript
import path from 'node:path'
import { FileGraphSource } from './file-source.js'
import { GitGraphSource } from './git-source.js'
import type { GraphSource } from './index.js'
import { SourceError } from './index.js'
import { loadProjectConfig } from './config-file.js'

export type GraphRuntimeConfig = {
  kind: 'filesystem' | 'git'
  source: GraphSource
  graphPath: string
  fileWatcherGraphPath?: string
  gitPollSeconds?: number
}

type Env = Record<string, string | undefined>

export function createGraphRuntimeConfig(
  env: Env = process.env,
  cwd = process.cwd(),
): GraphRuntimeConfig {
  const fileConfig = loadProjectConfig(cwd)
  const e: Env = {
    ...env,
    CORUM_SOURCE: env.CORUM_SOURCE ?? fileConfig.source,
    CORUM_GRAPH_PATH: env.CORUM_GRAPH_PATH ?? fileConfig.graph,
    CORUM_GIT_LOCAL_PATH: env.CORUM_GIT_LOCAL_PATH ?? fileConfig.git_local_path,
    CORUM_GIT_REMOTE_URL: env.CORUM_GIT_REMOTE_URL ?? fileConfig.git_remote_url,
    CORUM_GIT_BRANCH: env.CORUM_GIT_BRANCH ?? fileConfig.git_branch,
    CORUM_GIT_POLL_SECONDS: env.CORUM_GIT_POLL_SECONDS ?? (fileConfig.git_poll_seconds !== undefined ? String(fileConfig.git_poll_seconds) : undefined),
    CORUM_GIT_TOKEN: env.CORUM_GIT_TOKEN ?? fileConfig.git_token,
    CORUM_GIT_USERNAME: env.CORUM_GIT_USERNAME ?? fileConfig.git_username,
  }

  const sourceKind = (e.CORUM_SOURCE ?? 'filesystem').toLowerCase()
  if (sourceKind === 'filesystem' || sourceKind === 'file' || sourceKind === 'fs') {
    const graphPath = e.CORUM_GRAPH_PATH ?? path.join(cwd, '.corum/graph')
    return {
      kind: 'filesystem',
      source: new FileGraphSource({ graphDir: graphPath }),
      graphPath,
      fileWatcherGraphPath: graphPath,
    }
  }

  if (sourceKind !== 'git') {
    throw new SourceError(`unsupported CORUM_SOURCE: ${e.CORUM_SOURCE}`)
  }

  const localPath = emptyToUndefined(e.CORUM_GIT_LOCAL_PATH)
  const remoteUrl = emptyToUndefined(e.CORUM_GIT_REMOTE_URL)
  if (!localPath && !remoteUrl) {
    throw new SourceError('CORUM_SOURCE=git requires CORUM_GIT_LOCAL_PATH or CORUM_GIT_REMOTE_URL')
  }
  if (localPath && remoteUrl) {
    throw new SourceError('CORUM_SOURCE=git requires only one of CORUM_GIT_LOCAL_PATH or CORUM_GIT_REMOTE_URL')
  }

  const graphDir = '.corum/graph'
  const token = emptyToUndefined(e.CORUM_GIT_TOKEN)
  const auth = token
    ? { username: e.CORUM_GIT_USERNAME ?? 'x-access-token', token }
    : undefined
  const repoLabel = localPath ?? remoteUrl!
  const gitPollSeconds = parseOptionalSeconds(e.CORUM_GIT_POLL_SECONDS)

  return {
    kind: 'git',
    source: new GitGraphSource({
      localPath,
      remoteUrl,
      graphDir,
      defaultBranch: emptyToUndefined(e.CORUM_GIT_BRANCH),
      auth,
    }),
    graphPath: `git:${repoLabel}/${graphDir.replace(/\\/g, '/')}`,
    gitPollSeconds,
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() !== '' ? value : undefined
}

function parseOptionalSeconds(value: string | undefined): number | undefined {
  if (!value || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new SourceError('CORUM_GIT_POLL_SECONDS must be a positive number of seconds')
  }
  return parsed
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass including the two new config file precedence tests.

- [ ] **Step 5: Commit**

```bash
git add src/source/config.ts src/source/config-file.ts test/source.test.ts
git commit -m "feat: wire .corum/config.yaml into createGraphRuntimeConfig"
```

---

## Task 5: Extract startMcpServer from mcp/index.ts

**Files:**
- Modify: `src/mcp/index.ts`

- [ ] **Step 1: Replace the `if (isEntrypoint())` block with an exported function**

In `src/mcp/index.ts`, replace everything from `function isEntrypoint()` to the end of the file with the code below. **Important:** the `tools` array in `ListToolsRequestSchema` handler below has condensed inputSchemas for readability — copy the exact `inputSchema` objects from the current `if (isEntrypoint())` block rather than using these abbreviated versions. The function body and server wiring are complete as written.

```typescript
// TODO: A future library-first refactor (src/runtime/) would be the right path
// if external consumers of this startup API emerge. For now, the CLI is the only consumer.
export type McpServerOptions = {
  noWeb?: boolean
  watch?: boolean
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const { noWeb = false, watch = false } = options
  const config = createGraphRuntimeConfig()

  let graph: Graph
  let loadError: string | undefined

  try {
    graph = await loadGraph({ source: config.source, strict: true })
  } catch (err) {
    loadError = String(err)
    graph = {
      nodesById: new Map(),
      edgesByFrom: new Map(),
      edgesByTo: new Map(),
      templates: new Map(),
      diagnostics: [],
    }
  }

  const handlers = createMcpHandlers(graph, config.source)

  if (!noWeb) {
    await startWebServer(graph, {
      graphPath: config.graphPath,
      fileWatcher: config.fileWatcherGraphPath && watch ? true : undefined,
      source: config.source,
    })
  } else if (watch && config.fileWatcherGraphPath) {
    startGraphFileWatcher(graph, { graphPath: config.fileWatcherGraphPath })
  }

  const server = new Server(
    { name: 'corum', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_nodes',
        description: 'List nodes in the graph. Returns id, template, component, state, stability for each matched node.',
        inputSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', description: 'Filter by template name' },
            component: { type: 'string', description: 'Filter by component name' },
            state: { type: 'string', description: 'Filter by lifecycle state' },
            stability: { type: 'string', description: 'Filter by stability' },
            branch: { type: 'string', description: 'Branch ref to load nodes from' },
            format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
            compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
          },
        },
      },
      {
        name: 'list_templates',
        description: 'List all available node templates.',
        inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['yaml', 'json', 'toon'] } } },
      },
      {
        name: 'get_template',
        description: 'Get the full definition of a template by name.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Template name' },
            format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
          },
        },
      },
      {
        name: 'get_cluster',
        description: 'Get a cluster node with all its owned children and internal edges.',
        inputSchema: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Node ID' },
            branch: { type: 'string', description: 'Branch ref' },
            format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
            compact_keys: { type: 'boolean' },
          },
        },
      },
      {
        name: 'get_linked_fields',
        description: 'Get fields linked via maps-to edges for a node.',
        inputSchema: {
          type: 'object',
          required: ['node_id'],
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            branch: { type: 'string', description: 'Branch ref' },
            format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
            compact_keys: { type: 'boolean' },
          },
        },
      },
      {
        name: 'list_branches',
        description: 'List branches available from the configured graph source and their load status.',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
            compact_keys: { type: 'boolean' },
          },
        },
      },
      {
        name: 'diff_branch',
        description: 'Diff a branch against the default branch.',
        inputSchema: {
          type: 'object',
          required: ['branch'],
          properties: {
            branch: { type: 'string', description: 'Branch ref to diff' },
            format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
            compact_keys: { type: 'boolean' },
          },
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (loadError) {
      return { content: [{ type: 'text', text: `Graph load error: ${loadError}` }], isError: true }
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    switch (request.params.name) {
      case 'list_nodes': return await handlers.list_nodes(args)
      case 'list_templates': return await handlers.list_templates(args)
      case 'get_template': return await handlers.get_template(args)
      case 'get_cluster': return await handlers.get_cluster(args)
      case 'get_linked_fields': return await handlers.get_linked_fields(args)
      case 'list_branches': return await handlers.list_branches(args)
      case 'diff_branch': return await handlers.diff_branch(args)
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true }
    }
  })

  await server.connect(new StdioServerTransport())
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isEntrypoint()) {
  await startMcpServer()
}
```

- [ ] **Step 2: Build and run tests**

```bash
npm test
```

Expected: all tests pass. `npm run mcp` still works (backward compat preserved).

- [ ] **Step 3: Commit**

```bash
git add src/mcp/index.ts
git commit -m "refactor: extract startMcpServer() export from mcp/index.ts"
```

---

## Task 6: Add corum mcp and corum web commands

**Files:**
- Modify: `src/bin/corum.ts`

- [ ] **Step 1: Replace `src/bin/corum.ts` with the updated version**

```typescript
import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadImportConfig, buildOpenAPIConfig } from '../import/config.js'
import { runImport } from '../import/runner.js'
import { loadGraph } from '../loader/index.js'
import { startMcpServer } from '../mcp/index.js'
import { createGraphRuntimeConfig } from '../source/config.js'
import { startWebServer } from '../web/server.js'

const program = new Command()

program
  .name('corum')
  .description('Corum graph CLI')
  .version('0.1.0')

// ── mcp ──────────────────────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP stdio server (+ web UI by default)')
  .option('--no-web', 'Suppress the web UI')
  .option('--watch', 'Enable file watcher')
  .option('--graph <path>', 'Override graph path')
  .action(async (opts) => {
    if (opts.graph) process.env.CORUM_GRAPH_PATH = path.resolve(opts.graph)
    await startMcpServer({ noWeb: !opts.web, watch: opts.watch ?? false })
  })

// ── web ──────────────────────────────────────────────────────────────────────

program
  .command('web')
  .description('Start the web UI')
  .option('--port <n>', 'Port to listen on', parseInt)
  .option('--graph <path>', 'Override graph path')
  .action(async (opts) => {
    if (opts.graph) process.env.CORUM_GRAPH_PATH = path.resolve(opts.graph)
    const config = createGraphRuntimeConfig()
    let graph
    try {
      graph = await loadGraph({ source: config.source, strict: true })
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
    await startWebServer(graph, {
      graphPath: config.graphPath,
      source: config.source,
      port: opts.port,
    })
  })

// ── init ─────────────────────────────────────────────────────────────────────

const CONFIG_TEMPLATE = `# Corum project configuration
# Uncomment and set the options relevant to your setup.
# All values can be overridden by environment variables (CORUM_*) or CLI flags.

# Source type: 'file' (default) or 'git'
# Maps to: CORUM_SOURCE
# source: file

# ── File source (default) ─────────────────────────────────────────────────────
# Local path to the graph directory.
# Maps to: CORUM_GRAPH_PATH
# graph: .corum/graph

# ── Git source ────────────────────────────────────────────────────────────────
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
`

program
  .command('init')
  .description('Scaffold .corum/config.yaml with commented defaults')
  .action(() => {
    const configPath = path.join(process.cwd(), '.corum', 'config.yaml')
    if (existsSync(configPath)) {
      process.stdout.write(`.corum/config.yaml already exists — not overwriting\n`)
      return
    }
    mkdirSync(path.dirname(configPath), { recursive: true })
    writeFileSync(configPath, CONFIG_TEMPLATE)
    process.stdout.write(`Created .corum/config.yaml\n`)
  })

// ── import ───────────────────────────────────────────────────────────────────

const importCmd = program.command('import')
  .description('Import specifications into the graph')
  .option('--config <path>', 'Path to import config YAML')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (opts) => {
    if (!opts.config) {
      importCmd.help()
      return
    }
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const config = loadImportConfig(path.resolve(opts.config))
      const result = await runImport(config, runtimeConfig)
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

importCmd
  .command('openapi <spec>')
  .description('Import an OpenAPI spec into the graph')
  .option('--component-strategy <strategy>', 'Component mapping: uri-segment, tag, hardcoded', 'uri-segment')
  .option('--segment <n>', 'URI segment index (uri-segment strategy)', parseInt)
  .option('--pattern <regex>', 'Regex pattern (uri-segment strategy)')
  .option('--component <name>', 'Component name (hardcoded strategy)')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (spec: string, opts) => {
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const entry = buildOpenAPIConfig(spec, opts.componentStrategy, opts.segment, opts.pattern, opts.component)
      const result = await runImport({ imports: [entry] }, runtimeConfig)
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })

function buildRuntimeConfig(graphOverride?: string) {
  if (graphOverride) process.env.CORUM_GRAPH_PATH = path.resolve(graphOverride)
  return createGraphRuntimeConfig()
}

function reportDiagnostics(diagnostics: { severity: string; file: string; message: string }[]): void {
  for (const d of diagnostics) {
    const prefix = d.severity === 'error' ? 'ERROR' : 'WARN'
    process.stderr.write(`[${prefix}] ${d.file}: ${d.message}\n`)
  }
  const errors = diagnostics.filter(d => d.severity === 'error').length
  const warnings = diagnostics.filter(d => d.severity === 'warning').length
  process.stdout.write(`Import complete. ${errors} error(s), ${warnings} warning(s).\n`)
}

program.parse()
```

- [ ] **Step 2: Build and run tests**

```bash
npm test
```

Expected: build succeeds, all tests pass.

- [ ] **Step 3: Smoke-test the CLI commands manually**

```bash
node dist/src/bin/corum.js --help
node dist/src/bin/corum.js mcp --help
node dist/src/bin/corum.js web --help
node dist/src/bin/corum.js init --help
```

Expected: each command shows its description and options.

- [ ] **Step 4: Commit**

```bash
git add src/bin/corum.ts
git commit -m "feat: add corum mcp, web, and init CLI commands"
```

---

## Task 7: Complete ci-cd.yml with publish job

Versioning uses `paulhatch/semantic-version`, which reads git tags to determine the next version. No version bump commit is pushed to main (branch is protected). Instead, a git tag is pushed after publish — that tag becomes the base for the next run. `package.json` in the repo stays at `0.1.0` permanently; the published package always has the correct version.

**Files:**
- Modify: `.github/workflows/ci-cd.yml`

- [ ] **Step 1: Replace `.github/workflows/ci-cd.yml` with the full workflow**

```yaml
name: CI/CD

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test

  publish:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - name: Determine next version
        id: semver
        uses: paulhatch/semantic-version@v5.4.0
        with:
          tag_prefix: "v"
          major_pattern: "(MAJOR)"
          minor_pattern: "(MINOR)"
      - name: Set version in package.json
        run: npm version ${{ steps.semver.outputs.version }} --no-git-tag-version
      - name: Publish to npm
        run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - name: Tag release
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag v${{ steps.semver.outputs.version }}
          git push origin v${{ steps.semver.outputs.version }}
```

**Note:** `NODE_AUTH_TOKEN` must be set as a secret in GitHub repository settings (Settings → Secrets → Actions). To bump major or minor, include `(MAJOR)` or `(MINOR)` in the commit message — otherwise every push to main is a patch bump.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: add publish job using semantic-version and npm provenance"
```

---

## Task 8: Open pull request

- [ ] **Step 1: Push the branch**

```bash
git push -u origin NpmPublish
```

- [ ] **Step 2: Open a PR from `NpmPublish` → `main`**

```bash
gh pr create --title "feat: publish @atolis-hq/corum to npm with CLI and CI/CD" --body "$(cat <<'EOF'
## Summary
- Adds `corum mcp`, `corum web`, `corum init` CLI commands
- Adds `.corum/config.yaml` discovery (lowest precedence, walks up from cwd)
- Publishes as `@atolis-hq/corum` — patch bump on every push to main via `paulhatch/semantic-version` git tags; add `(MAJOR)` or `(MINOR)` to commit messages for larger bumps

## Bootstrap steps after merge
1. `npm login && npm publish --access public` (first publish from local, creates the package on npm)
2. Set `NPM_TOKEN` secret in GitHub repo settings (Settings → Secrets → Actions)
3. Push a `v0.1.0` git tag so semantic-version has a base: `git tag v0.1.0 && git push origin v0.1.0`

## Test plan
- [ ] `corum --help` shows all subcommands
- [ ] `corum mcp --help`, `corum web --help`, `corum init --help` show correct options
- [ ] `corum init` creates `.corum/config.yaml`; second run prints "already exists"
- [ ] Config file values used when env vars absent; env vars override config file
- [ ] CI passes on the PR
EOF
)"
```

- [ ] **Step 3: Verify CI passes on the PR**

Check GitHub Actions — the `test` job should pass. The `publish` job should not run (only triggers on push to main).
