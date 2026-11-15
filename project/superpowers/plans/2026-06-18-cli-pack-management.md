# CLI Pack Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the corum CLI so `corum init` scaffolds a ready-to-use project (config, graph, default packs), `corum pack install <name[@ref]>` downloads template packs from GitHub, and `corum pack list` shows what is installed.

**Architecture:** A new `src/pack/` module owns all pack concerns — GitHub URL construction, registry fetching, file downloading, local manifest, and graph.yaml mutation. `src/bin/corum.ts` orchestrates these modules. Packs are downloaded by resolving the latest GitHub release tag then fetching individual files via `raw.githubusercontent.com`. The `CorumConfig` type in `src/source/config-file.ts` gains a `pack_registry` field so the existing config loading path is reused.

**Tech Stack:** Node.js built-in `fetch` (Node 24+), `yaml` package (already a dependency), `node:fs`, `node:fs/promises`, `node:path`, `node:test` for tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packs/registry.yaml` | Create | Official pack registry (static data, committed to repo) |
| `src/pack/github-urls.ts` | Create | URL construction and parsing — keeps raw/api URL logic out of other modules |
| `src/pack/registry.ts` | Create | Fetch and parse registry YAML; resolve latest release tag via GitHub API |
| `src/pack/installer.ts` | Create | Download pack.yaml + template files and write to disk |
| `src/pack/manifest.ts` | Create | Read/write `.corum/packs.yaml` — upsert installed pack entries |
| `src/pack/graph-yaml.ts` | Create | Read/write `.corum/graph/graph.yaml` — append templatePacks entries |
| `src/source/config-file.ts` | Modify | Add `pack_registry?: string` to `CorumConfig` |
| `src/bin/corum.ts` | Modify | Add `pack install`, `pack list`; extend `init` |
| `test/pack-github-urls.test.ts` | Create | Unit tests for github-urls |
| `test/pack-registry.test.ts` | Create | Unit tests for registry fetcher |
| `test/pack-installer.test.ts` | Create | Unit tests for file installer |
| `test/pack-manifest.test.ts` | Create | Unit tests for manifest read/write |
| `test/pack-graph-yaml.test.ts` | Create | Unit tests for graph.yaml updater |
| `test/config-file.test.ts` | Modify | Add test for `pack_registry` field parsing |

---

## Task 1: Create `packs/registry.yaml`

No tests — this is a static data file.

**Files:**
- Create: `packs/registry.yaml`

- [ ] **Step 1: Create the registry file**

```yaml
version: "1.0"
packs:
  - name: core
    description: "Core templates required by all graphs"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/core
  - name: domain
    description: "Domain model templates (DomainModel, Command, ReadModel, etc.)"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/domain
  - name: rest
    description: "REST API templates (APIEndpoint)"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/rest
  - name: messaging
    description: "Messaging templates (DomainEvent, IntegrationEvent)"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/messaging
```

- [ ] **Step 2: Commit**

```bash
git add packs/registry.yaml
git commit -m "feat: add official pack registry"
```

---

## Task 2: GitHub URL helper (`src/pack/github-urls.ts`)

**Files:**
- Create: `src/pack/github-urls.ts`
- Create: `test/pack-github-urls.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/pack-github-urls.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGitHubUrl,
  parseGitHubRepo,
  toRegistryFetchUrl,
  toPackRawBaseUrl,
  toReleasesApiUrl,
} from '../src/pack/github-urls.js'

describe('parseGitHubUrl', () => {
  it('parses owner, repo, and path', () => {
    assert.deepEqual(
      parseGitHubUrl('https://github.com/atolis-hq/corum/packs/registry.yaml'),
      { owner: 'atolis-hq', repo: 'corum', path: 'packs/registry.yaml' },
    )
  })

  it('parses a multi-segment path', () => {
    assert.deepEqual(
      parseGitHubUrl('https://github.com/atolis-hq/corum/.corum/packs/core'),
      { owner: 'atolis-hq', repo: 'corum', path: '.corum/packs/core' },
    )
  })

  it('throws on non-github URLs', () => {
    assert.throws(
      () => parseGitHubUrl('https://example.com/foo/bar/baz'),
      /not a github\.com url/i,
    )
  })

  it('throws if path is missing', () => {
    assert.throws(
      () => parseGitHubUrl('https://github.com/atolis-hq/corum'),
      /missing path/i,
    )
  })
})

describe('parseGitHubRepo', () => {
  it('parses owner and repo from a repo URL', () => {
    assert.deepEqual(
      parseGitHubRepo('https://github.com/atolis-hq/corum'),
      { owner: 'atolis-hq', repo: 'corum' },
    )
  })

  it('throws on non-github URLs', () => {
    assert.throws(
      () => parseGitHubRepo('https://example.com/foo'),
      /not a github\.com url/i,
    )
  })
})

describe('toRegistryFetchUrl', () => {
  it('converts github url to raw HEAD url', () => {
    assert.equal(
      toRegistryFetchUrl('https://github.com/atolis-hq/corum/packs/registry.yaml'),
      'https://raw.githubusercontent.com/atolis-hq/corum/HEAD/packs/registry.yaml',
    )
  })
})

describe('toPackRawBaseUrl', () => {
  it('constructs raw base url for a pack at a given ref', () => {
    assert.equal(
      toPackRawBaseUrl('atolis-hq', 'corum', 'v0.1.6', '.corum/packs/core'),
      'https://raw.githubusercontent.com/atolis-hq/corum/v0.1.6/.corum/packs/core',
    )
  })
})

describe('toReleasesApiUrl', () => {
  it('constructs github releases api url', () => {
    assert.equal(
      toReleasesApiUrl('atolis-hq', 'corum'),
      'https://api.github.com/repos/atolis-hq/corum/releases/latest',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build && node --test dist/test/pack-github-urls.test.js
```

Expected: compilation error — `../src/pack/github-urls.js` does not exist yet.

- [ ] **Step 3: Create `src/pack/github-urls.ts`**

```typescript
export interface GitHubUrlParts {
  owner: string
  repo: string
  path: string
}

export function parseGitHubUrl(url: string): GitHubUrlParts {
  const u = new URL(url)
  if (u.hostname !== 'github.com') throw new Error(`Not a github.com URL: ${url}`)
  const segments = u.pathname.replace(/^\//, '').split('/')
  if (segments.length < 3) throw new Error(`Missing path in GitHub URL: ${url}`)
  const [owner, repo, ...rest] = segments
  return { owner, repo, path: rest.join('/') }
}

export function parseGitHubRepo(repoUrl: string): { owner: string; repo: string } {
  const u = new URL(repoUrl)
  if (u.hostname !== 'github.com') throw new Error(`Not a github.com URL: ${repoUrl}`)
  const [owner, repo] = u.pathname.replace(/^\//, '').split('/')
  return { owner, repo }
}

export function toRegistryFetchUrl(configUrl: string): string {
  const { owner, repo, path } = parseGitHubUrl(configUrl)
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`
}

export function toPackRawBaseUrl(owner: string, repo: string, ref: string, packPath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${packPath}`
}

export function toReleasesApiUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build && node --test dist/test/pack-github-urls.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pack/github-urls.ts test/pack-github-urls.test.ts
git commit -m "feat: add github url helper for pack management"
```

---

## Task 3: Pack registry fetcher (`src/pack/registry.ts`)

**Files:**
- Create: `src/pack/registry.ts`
- Create: `test/pack-registry.test.ts`
- Modify: `src/source/config-file.ts` (add `pack_registry` field)
- Modify: `test/config-file.test.ts` (add test for `pack_registry`)

- [ ] **Step 1: Add `pack_registry` to `CorumConfig` in `src/source/config-file.ts`**

Add `pack_registry?: string` to the `CorumConfig` type:

```typescript
export type CorumConfig = {
  source?: string
  graph?: string
  git_local_path?: string
  git_remote_url?: string
  git_branch?: string
  git_poll_seconds?: number
  git_token?: string
  git_username?: string
  pack_registry?: string
}
```

The rest of `config-file.ts` is unchanged — `loadProjectConfig` reads all fields via `parse(content) as CorumConfig`.

- [ ] **Step 2: Add a test for `pack_registry` to `test/config-file.test.ts`**

Append this `it` block inside the existing `describe('loadProjectConfig', ...)`:

```typescript
  it('loads pack_registry as a string', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(
      path.join(dir, '.corum', 'config.yaml'),
      'pack_registry: https://github.com/atolis-hq/corum/packs/registry.yaml\n',
    )
    try {
      const result = loadProjectConfig(dir)
      assert.equal(result.pack_registry, 'https://github.com/atolis-hq/corum/packs/registry.yaml')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
```

- [ ] **Step 3: Run config-file tests to verify they pass**

```bash
npm run build && node --test dist/test/config-file.test.js
```

Expected: all tests pass (including the new one).

- [ ] **Step 4: Write failing tests for registry.ts**

Create `test/pack-registry.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fetchRegistry, findPack, resolveRef } from '../src/pack/registry.js'
import type { Registry } from '../src/pack/registry.js'

const sampleRegistry: Registry = {
  version: '1.0',
  packs: [
    { name: 'core', description: 'Core', repo: 'https://github.com/a/b', path: '.corum/packs/core' },
    { name: 'domain', description: 'Domain', repo: 'https://github.com/a/b', path: '.corum/packs/domain' },
  ],
}

function mockFetchOk(body: string): typeof fetch {
  return async (_url: string | URL | Request) =>
    ({ ok: true, text: async () => body, json: async () => JSON.parse(body) }) as unknown as Response
}

function mockFetchFail(status: number): typeof fetch {
  return async (_url: string | URL | Request) =>
    ({ ok: false, status, statusText: 'Error' }) as unknown as Response
}

describe('fetchRegistry', () => {
  it('parses a registry YAML response', async () => {
    const yaml = `version: "1.0"\npacks:\n  - name: core\n    description: Core\n    repo: https://github.com/a/b\n    path: .corum/packs/core\n`
    const result = await fetchRegistry('https://github.com/a/b/packs/registry.yaml', mockFetchOk(yaml))
    assert.equal(result.version, '1.0')
    assert.equal(result.packs.length, 1)
    assert.equal(result.packs[0].name, 'core')
  })

  it('throws if fetch fails', async () => {
    await assert.rejects(
      () => fetchRegistry('https://github.com/a/b/packs/registry.yaml', mockFetchFail(404)),
      /404/,
    )
  })
})

describe('findPack', () => {
  it('returns matching pack', () => {
    const pack = findPack(sampleRegistry, 'domain')
    assert.equal(pack.name, 'domain')
  })

  it('throws with helpful message for unknown pack', () => {
    assert.throws(
      () => findPack(sampleRegistry, 'unknown'),
      /pack "unknown" not found in registry/i,
    )
  })
})

describe('resolveRef', () => {
  it('returns specified ref without calling the api', async () => {
    const mockFetch = async () => { throw new Error('should not be called') }
    const ref = await resolveRef('a', 'b', 'v1.2.3', mockFetch as unknown as typeof fetch)
    assert.equal(ref, 'v1.2.3')
  })

  it('fetches latest release tag when no ref specified', async () => {
    const mockFetch = async (_url: string | URL | Request) =>
      ({ ok: true, json: async () => ({ tag_name: 'v0.1.6' }) }) as unknown as Response
    const ref = await resolveRef('atolis-hq', 'corum', undefined, mockFetch)
    assert.equal(ref, 'v0.1.6')
  })

  it('throws if releases api fails', async () => {
    await assert.rejects(
      () => resolveRef('a', 'b', undefined, mockFetchFail(404)),
      /404/,
    )
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
npm run build && node --test dist/test/pack-registry.test.js
```

Expected: compilation error — `../src/pack/registry.js` does not exist yet.

- [ ] **Step 6: Create `src/pack/registry.ts`**

```typescript
import { parse } from 'yaml'
import { toRegistryFetchUrl, toReleasesApiUrl } from './github-urls.js'

export interface RegistryPack {
  name: string
  description: string
  repo: string
  path: string
}

export interface Registry {
  version: string
  packs: RegistryPack[]
}

export async function fetchRegistry(configUrl: string, fetchFn: typeof fetch = fetch): Promise<Registry> {
  const rawUrl = toRegistryFetchUrl(configUrl)
  const res = await fetchFn(rawUrl)
  if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status} ${res.statusText}`)
  const text = await res.text()
  return parse(text) as Registry
}

export function findPack(registry: Registry, name: string): RegistryPack {
  const pack = registry.packs.find(p => p.name === name)
  if (!pack) {
    const available = registry.packs.map(p => p.name).join(', ')
    throw new Error(`Pack "${name}" not found in registry. Available: ${available}`)
  }
  return pack
}

export async function resolveRef(
  owner: string,
  repo: string,
  specifiedRef: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (specifiedRef) return specifiedRef
  const url = toReleasesApiUrl(owner, repo)
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`Failed to resolve latest release: ${res.status} ${res.statusText}`)
  const data = await res.json() as { tag_name: string }
  return data.tag_name
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npm run build && node --test dist/test/pack-registry.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/pack/registry.ts test/pack-registry.test.ts src/source/config-file.ts test/config-file.test.ts
git commit -m "feat: add pack registry fetcher and pack_registry config field"
```

---

## Task 4: Pack file installer (`src/pack/installer.ts`)

**Files:**
- Create: `src/pack/installer.ts`
- Create: `test/pack-installer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/pack-installer.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installPackFiles } from '../src/pack/installer.js'

const packYaml = `name: core\nversion: "1.0.0"\ndescription: Core\ntemplates:\n  - Schema\n  - Field\n`
const schemaYaml = `name: Schema\n`
const fieldYaml = `name: Field\n`

function makeMockFetch(responses: Record<string, string>): typeof fetch {
  return async (url: string | URL | Request) => {
    const key = url.toString()
    const body = responses[key]
    if (body === undefined) throw new Error(`Unexpected fetch: ${key}`)
    return { ok: true, text: async () => body } as unknown as Response
  }
}

describe('installPackFiles', () => {
  it('downloads pack.yaml and all template files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const baseUrl = 'https://raw.githubusercontent.com/a/b/v1/.corum/packs/core'
      const mockFetch = makeMockFetch({
        [`${baseUrl}/pack.yaml`]: packYaml,
        [`${baseUrl}/templates/Schema.yaml`]: schemaYaml,
        [`${baseUrl}/templates/Field.yaml`]: fieldYaml,
      })
      await installPackFiles(baseUrl, path.join(dir, 'core'), mockFetch)
      assert.equal(fs.readFileSync(path.join(dir, 'core', 'pack.yaml'), 'utf8'), packYaml)
      assert.equal(fs.readFileSync(path.join(dir, 'core', 'templates', 'Schema.yaml'), 'utf8'), schemaYaml)
      assert.equal(fs.readFileSync(path.join(dir, 'core', 'templates', 'Field.yaml'), 'utf8'), fieldYaml)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('throws if pack.yaml fetch fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const baseUrl = 'https://raw.githubusercontent.com/a/b/v1/.corum/packs/core'
      const mockFetch = async (_url: string | URL | Request) =>
        ({ ok: false, status: 404, statusText: 'Not Found' }) as unknown as Response
      await assert.rejects(
        () => installPackFiles(baseUrl, path.join(dir, 'core'), mockFetch),
        /404/,
      )
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('throws if a template file fetch fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const baseUrl = 'https://raw.githubusercontent.com/a/b/v1/.corum/packs/core'
      const mockFetch = async (url: string | URL | Request) => {
        if (url.toString().endsWith('pack.yaml')) {
          return { ok: true, text: async () => packYaml } as unknown as Response
        }
        return { ok: false, status: 500, statusText: 'Server Error' } as unknown as Response
      }
      await assert.rejects(
        () => installPackFiles(baseUrl, path.join(dir, 'core'), mockFetch),
        /500/,
      )
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build && node --test dist/test/pack-installer.test.js
```

Expected: compilation error — `../src/pack/installer.js` does not exist yet.

- [ ] **Step 3: Create `src/pack/installer.ts`**

```typescript
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'

interface PackMeta {
  templates: string[]
}

export async function installPackFiles(
  baseUrl: string,
  destDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const packYamlUrl = `${baseUrl}/pack.yaml`
  const packRes = await fetchFn(packYamlUrl)
  if (!packRes.ok) throw new Error(`Failed to fetch pack.yaml: ${packRes.status} ${packRes.statusText}`)
  const packText = await packRes.text()
  const meta = parse(packText) as PackMeta

  await mkdir(path.join(destDir, 'templates'), { recursive: true })
  await writeFile(path.join(destDir, 'pack.yaml'), packText)

  for (const templateName of meta.templates) {
    const templateUrl = `${baseUrl}/templates/${templateName}.yaml`
    const res = await fetchFn(templateUrl)
    if (!res.ok) throw new Error(`Failed to fetch template ${templateName}: ${res.status} ${res.statusText}`)
    await writeFile(path.join(destDir, 'templates', `${templateName}.yaml`), await res.text())
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build && node --test dist/test/pack-installer.test.js
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pack/installer.ts test/pack-installer.test.ts
git commit -m "feat: add pack file installer"
```

---

## Task 5: Local pack manifest (`src/pack/manifest.ts`)

**Files:**
- Create: `src/pack/manifest.ts`
- Create: `test/pack-manifest.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/pack-manifest.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { upsertPack, readManifest } from '../src/pack/manifest.js'
import type { InstalledPack } from '../src/pack/manifest.js'

const entry: InstalledPack = {
  name: 'core',
  repo: 'https://github.com/atolis-hq/corum',
  path: '.corum/packs/core',
  ref: 'v0.1.6',
  installedAt: '2026-06-18T10:00:00Z',
}

describe('readManifest', () => {
  it('returns empty packs array when file does not exist', async () => {
    const result = await readManifest('/nonexistent/path/packs.yaml')
    assert.deepEqual(result, { packs: [] })
  })
})

describe('upsertPack + readManifest', () => {
  it('creates packs.yaml on first upsert', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const manifestPath = path.join(dir, 'packs.yaml')
      await upsertPack(manifestPath, entry)
      const manifest = await readManifest(manifestPath)
      assert.equal(manifest.packs.length, 1)
      assert.equal(manifest.packs[0].name, 'core')
      assert.equal(manifest.packs[0].ref, 'v0.1.6')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('updates existing entry by name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const manifestPath = path.join(dir, 'packs.yaml')
      await upsertPack(manifestPath, entry)
      await upsertPack(manifestPath, { ...entry, ref: 'v0.2.0' })
      const manifest = await readManifest(manifestPath)
      assert.equal(manifest.packs.length, 1)
      assert.equal(manifest.packs[0].ref, 'v0.2.0')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('appends a new entry without affecting existing ones', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const manifestPath = path.join(dir, 'packs.yaml')
      await upsertPack(manifestPath, entry)
      await upsertPack(manifestPath, { ...entry, name: 'domain', path: '.corum/packs/domain' })
      const manifest = await readManifest(manifestPath)
      assert.equal(manifest.packs.length, 2)
      assert.equal(manifest.packs[0].name, 'core')
      assert.equal(manifest.packs[1].name, 'domain')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build && node --test dist/test/pack-manifest.test.js
```

Expected: compilation error — `../src/pack/manifest.js` does not exist yet.

- [ ] **Step 3: Create `src/pack/manifest.ts`**

```typescript
import { readFile, writeFile } from 'node:fs/promises'
import { parse, stringify } from 'yaml'

export interface InstalledPack {
  name: string
  repo: string
  path: string
  ref: string
  installedAt: string
}

export interface PackManifest {
  packs: InstalledPack[]
}

export async function readManifest(manifestPath: string): Promise<PackManifest> {
  try {
    const text = await readFile(manifestPath, 'utf8')
    return parse(text) as PackManifest
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { packs: [] }
    throw err
  }
}

export async function upsertPack(manifestPath: string, entry: InstalledPack): Promise<void> {
  const manifest = await readManifest(manifestPath)
  const idx = manifest.packs.findIndex(p => p.name === entry.name)
  if (idx >= 0) {
    manifest.packs[idx] = entry
  } else {
    manifest.packs.push(entry)
  }
  await writeFile(manifestPath, stringify(manifest))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build && node --test dist/test/pack-manifest.test.js
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pack/manifest.ts test/pack-manifest.test.ts
git commit -m "feat: add local pack manifest reader/writer"
```

---

## Task 6: Graph YAML updater (`src/pack/graph-yaml.ts`)

**Files:**
- Create: `src/pack/graph-yaml.ts`
- Create: `test/pack-graph-yaml.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/pack-graph-yaml.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { registerPackInGraph } from '../src/pack/graph-yaml.js'

const minimalGraph = `schema-version: '1.0'\nname: My Graph\ntemplatePacks: []\ncomponents: []\n`

describe('registerPackInGraph', () => {
  it('appends a templatePacks entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const graphPath = path.join(dir, 'graph.yaml')
      fs.writeFileSync(graphPath, minimalGraph)
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      const parsed = parse(fs.readFileSync(graphPath, 'utf8'))
      assert.equal(parsed.templatePacks.length, 1)
      assert.deepEqual(parsed.templatePacks[0], { name: 'core', path: '../packs/core' })
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('does not duplicate an existing entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const graphPath = path.join(dir, 'graph.yaml')
      fs.writeFileSync(graphPath, minimalGraph)
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      const parsed = parse(fs.readFileSync(graphPath, 'utf8'))
      assert.equal(parsed.templatePacks.length, 1)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('appends multiple packs independently', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const graphPath = path.join(dir, 'graph.yaml')
      fs.writeFileSync(graphPath, minimalGraph)
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      await registerPackInGraph(graphPath, 'domain', '../packs/domain')
      const parsed = parse(fs.readFileSync(graphPath, 'utf8'))
      assert.equal(parsed.templatePacks.length, 2)
      assert.equal(parsed.templatePacks[0].name, 'core')
      assert.equal(parsed.templatePacks[1].name, 'domain')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build && node --test dist/test/pack-graph-yaml.test.js
```

Expected: compilation error — `../src/pack/graph-yaml.js` does not exist yet.

- [ ] **Step 3: Create `src/pack/graph-yaml.ts`**

```typescript
import { readFile, writeFile } from 'node:fs/promises'
import { parse, stringify } from 'yaml'

interface GraphYaml {
  'schema-version': string
  name: string
  templatePacks: Array<{ name: string; path: string }>
  components: unknown[]
}

export async function registerPackInGraph(
  graphYamlPath: string,
  packName: string,
  relativePath: string,
): Promise<void> {
  const text = await readFile(graphYamlPath, 'utf8')
  const graph = parse(text) as GraphYaml
  if (graph.templatePacks.some(p => p.name === packName)) return
  graph.templatePacks.push({ name: packName, path: relativePath })
  await writeFile(graphYamlPath, stringify(graph))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build && node --test dist/test/pack-graph-yaml.test.js
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pack/graph-yaml.ts test/pack-graph-yaml.test.ts
git commit -m "feat: add graph.yaml templatePacks updater"
```

---

## Task 7: `corum pack install` command

**Files:**
- Modify: `src/bin/corum.ts`

Adds an `installPack` orchestrator function and the `pack install` CLI subcommand. No new unit tests — the modules are already tested individually.

- [ ] **Step 1: Add imports to `src/bin/corum.ts`**

Add these imports after the existing imports at the top of the file:

```typescript
import { readFile as fsReadFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { fetchRegistry, findPack, resolveRef } from '../pack/registry.js'
import { parseGitHubRepo, toPackRawBaseUrl } from '../pack/github-urls.js'
import { installPackFiles } from '../pack/installer.js'
import { upsertPack } from '../pack/manifest.js'
import { registerPackInGraph } from '../pack/graph-yaml.js'
```

- [ ] **Step 2: Add `installPack` helper function**

Add this function just before the `program.parse()` line at the bottom of `src/bin/corum.ts`:

```typescript
async function readPackRegistryUrl(cwd: string): Promise<string> {
  const configPath = path.join(cwd, '.corum', 'config.yaml')
  const text = await fsReadFile(configPath, 'utf8')
  const config = parseYaml(text) as { pack_registry?: string }
  if (!config.pack_registry) throw new Error('pack_registry not set in .corum/config.yaml — run corum init first')
  return config.pack_registry
}

export async function installPack(nameWithRef: string, cwd: string = process.cwd()): Promise<void> {
  const atIdx = nameWithRef.indexOf('@')
  const name = atIdx >= 0 ? nameWithRef.slice(0, atIdx) : nameWithRef
  const specifiedRef = atIdx >= 0 ? nameWithRef.slice(atIdx + 1) : undefined

  const registryUrl = await readPackRegistryUrl(cwd)
  const registry = await fetchRegistry(registryUrl)
  const pack = findPack(registry, name)
  const { owner, repo } = parseGitHubRepo(pack.repo)
  const ref = await resolveRef(owner, repo, specifiedRef)
  const baseUrl = toPackRawBaseUrl(owner, repo, ref, pack.path)

  await installPackFiles(baseUrl, path.join(cwd, '.corum', 'packs', name))
  await upsertPack(path.join(cwd, '.corum', 'packs.yaml'), {
    name,
    repo: pack.repo,
    path: pack.path,
    ref,
    installedAt: new Date().toISOString(),
  })
  await registerPackInGraph(
    path.join(cwd, '.corum', 'graph', 'graph.yaml'),
    name,
    `../packs/${name}`,
  )
  process.stdout.write(`Installed pack: ${name}@${ref}\n`)
}
```

- [ ] **Step 3: Add `pack` subcommand to the program**

Add this block before `program.parse()` in `src/bin/corum.ts`:

```typescript
// ── pack ─────────────────────────────────────────────────────────────────────

const packCmd = program.command('pack').description('Manage template packs')

packCmd
  .command('install <name>')
  .description('Install a pack from the registry (e.g. core, domain@v0.1.5)')
  .action(async (name: string) => {
    try {
      await installPack(name)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })
```

- [ ] **Step 4: Build and smoke-test**

```bash
npm run build
node dist/src/bin/corum.js pack --help
```

Expected output:
```
Usage: corum pack [options] [command]

Manage template packs

Options:
  -h, --help      display help for command

Commands:
  install <name>  Install a pack from the registry (e.g. core, domain@v0.1.5)
  help [command]  display help for command
```

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/bin/corum.ts
git commit -m "feat: add corum pack install command"
```

---

## Task 8: `corum pack list` command

**Files:**
- Modify: `src/bin/corum.ts`
- Modify: `src/pack/manifest.ts` (no change needed — `readManifest` is already exported)

- [ ] **Step 1: Add `pack list` subcommand**

Add this block after the `pack install` command (before `program.parse()`):

```typescript
packCmd
  .command('list')
  .description('List installed packs')
  .action(async () => {
    try {
      const manifest = await readManifest(path.join(process.cwd(), '.corum', 'packs.yaml'))
      if (manifest.packs.length === 0) {
        process.stdout.write('No packs installed. Run: corum pack install <name>\n')
        return
      }
      for (const p of manifest.packs) {
        process.stdout.write(`${p.name}@${p.ref}  (${p.installedAt})\n`)
      }
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  })
```

Add this import at the top of `src/bin/corum.ts` (alongside the other pack imports added in Task 7):

```typescript
import { readManifest } from '../pack/manifest.js'
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
node dist/src/bin/corum.js pack list --help
```

Expected:
```
Usage: corum pack list [options]

List installed packs

Options:
  -h, --help  display help for command
```

- [ ] **Step 3: Commit**

```bash
git add src/bin/corum.ts
git commit -m "feat: add corum pack list command"
```

---

## Task 9: Extend `corum init`

**Files:**
- Modify: `src/bin/corum.ts`

Extends the existing `init` command to scaffold the graph directory and install the four default packs.

- [ ] **Step 1: Update `CONFIG_TEMPLATE` to include `pack_registry`**

In `src/bin/corum.ts`, update the `CONFIG_TEMPLATE` constant. Add `pack_registry` as the first uncommented field (since it is required for pack commands):

```typescript
const CONFIG_TEMPLATE = `# Corum project configuration
# Uncomment and set the options relevant to your setup.
# All values can be overridden by environment variables (CORUM_*) or CLI flags.

# Registry URL for discovering and installing template packs.
pack_registry: https://github.com/atolis-hq/corum/packs/registry.yaml

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
```

- [ ] **Step 2: Add graph scaffold template**

Add this constant in `src/bin/corum.ts`, after `CONFIG_TEMPLATE`:

```typescript
const GRAPH_TEMPLATE = `schema-version: '1.0'
name: My Graph
templatePacks: []
components: []
`
```

- [ ] **Step 3: Replace the `init` action with the extended version**

Replace the existing `init` command action in `src/bin/corum.ts`:

```typescript
program
  .command('init')
  .description('Scaffold .corum project structure and install default packs')
  .action(async () => {
    const cwd = process.cwd()
    const corumDir = path.join(cwd, '.corum')
    const configPath = path.join(corumDir, 'config.yaml')
    const graphPath = path.join(corumDir, 'graph', 'graph.yaml')

    if (existsSync(configPath)) {
      process.stdout.write(`.corum/config.yaml already exists — not overwriting\n`)
    } else {
      mkdirSync(path.dirname(configPath), { recursive: true })
      writeFileSync(configPath, CONFIG_TEMPLATE)
      process.stdout.write(`Created .corum/config.yaml\n`)
    }

    if (existsSync(graphPath)) {
      process.stdout.write(`.corum/graph/graph.yaml already exists — not overwriting\n`)
    } else {
      mkdirSync(path.dirname(graphPath), { recursive: true })
      writeFileSync(graphPath, GRAPH_TEMPLATE)
      mkdirSync(path.join(corumDir, 'graph', 'components'), { recursive: true })
      mkdirSync(path.join(corumDir, 'graph', 'edges'), { recursive: true })
      process.stdout.write(`Created .corum/graph/graph.yaml\n`)
    }

    for (const packName of ['core', 'domain', 'rest', 'messaging']) {
      try {
        await installPack(packName, cwd)
      } catch (err) {
        process.stderr.write(`[ERROR] Failed to install pack ${packName}: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }
    }
  })
```

- [ ] **Step 4: Build and verify help output**

```bash
npm run build
node dist/src/bin/corum.js init --help
```

Expected:
```
Usage: corum init [options]

Scaffold .corum project structure and install default packs

Options:
  -h, --help  display help for command
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/bin/corum.ts
git commit -m "feat: extend corum init to scaffold graph and install default packs"
```

---

## Task 10: Update README

**Files:**
- Modify: `README.md`

No tests — documentation only.

- [ ] **Step 1: Update the Quick Start section**

Replace the existing Quick Start section:

```markdown
## Quick Start

Scaffold a config file in your project:

```bash
corum init
```

This creates `.corum/config.yaml` with commented defaults. Edit it to point at your graph directory or git repository, then start the MCP server:

```bash
corum mcp
```
```

With:

```markdown
## Quick Start

Scaffold a new project in the current directory:

```bash
corum init
```

This creates `.corum/config.yaml`, scaffolds a graph at `.corum/graph/`, and downloads the official template packs (`core`, `domain`, `rest`, `messaging`). Then start the MCP server:

```bash
corum mcp
```
```

- [ ] **Step 2: Update the `corum init` command description**

Replace:

```markdown
### `corum init`

Scaffold `.corum/config.yaml` with commented defaults. Does not overwrite an existing file.

```bash
corum init
```
```

With:

```markdown
### `corum init`

Scaffold a `.corum/` project structure and install the four default template packs (`core`, `domain`, `rest`, `messaging`). Skips any step where the target already exists.

```bash
corum init
```

Creates:
- `.corum/config.yaml` — project configuration
- `.corum/graph/graph.yaml` — graph definition
- `.corum/graph/components/` and `.corum/graph/edges/` — empty directories ready for nodes
- `.corum/packs/` — downloaded template packs
- `.corum/packs.yaml` — local manifest of installed packs
```

- [ ] **Step 3: Add `corum pack` section after `corum init`**

Insert this after the `corum init` section and before the `corum import` section:

```markdown
### `corum pack install`

Install a template pack from the registry into `.corum/packs/`. Appends the pack to `.corum/graph/graph.yaml` and records it in `.corum/packs.yaml`.

```bash
corum pack install <name>          # install latest release
corum pack install <name>@<ref>    # install a specific tag
```

Examples:

```bash
corum pack install domain
corum pack install domain@v0.1.5
```

### `corum pack list`

List installed packs with their resolved version and install date.

```bash
corum pack list
```
```

- [ ] **Step 4: Add `pack_registry` to the configuration table**

Add a row to the configuration table:

```markdown
| `pack_registry` | — | URL of the pack registry YAML (set by `corum init`) |
```

Insert it as the first row in the table (before `source`).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for corum init and pack commands"
```
