# Component Name Replacements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `componentNameReplacements` list to `ImportConfig` that maps raw extracted component names to canonical ones, applied immediately after extraction in each adapter before any node ID is built.

**Architecture:** A `ComponentNameReplacement[]` field on `ImportConfig` threads through `AdapterContext` to both adapter `mapDocument()` functions. A pure helper `applyComponentNameReplacements()` in `src/import/config.ts` is called at the two component-extraction call sites in each mapper (operations loop and schema component walk).

**Tech Stack:** TypeScript, Node.js built-in test runner (`node --test`), YAML config.

## Global Constraints

- Use Node.js built-in test runner (`import { describe, it } from 'node:test'`, `import assert from 'node:assert/strict'`)
- Run tests with `npm test` (builds first); run a single file with `node --test dist/test/path/file.test.js`
- All existing tests must continue to pass after each task
- No regex support, no convention-based normalization — exact-match only

---

### Task 1: Add `ComponentNameReplacement` type, helper, and validation

**Files:**
- Modify: `src/import/config.ts`
- Modify: `test/import/config.test.ts`

**Interfaces:**
- Produces:
  - `ComponentNameReplacement` interface: `{ from: string; to: string }`
  - `ImportConfig.componentNameReplacements?: ComponentNameReplacement[]`
  - `applyComponentNameReplacements(name: string, replacements: ComponentNameReplacement[]): string` — returns `replacements.find(r => r.from === name)?.to ?? name`
  - `loadImportConfig` throws `Invalid import config` if any replacement has empty `from` or `to`

- [ ] **Step 1: Write failing tests for `applyComponentNameReplacements`**

Add to `test/import/config.test.ts` after the existing `describe('buildAsyncAPIConfig', ...)` block:

```ts
describe('applyComponentNameReplacements', () => {
  it('returns the canonical name when from matches', () => {
    const result = applyComponentNameReplacements('ordershipping', [{ from: 'ordershipping', to: 'order-shipping' }])
    assert.equal(result, 'order-shipping')
  })

  it('returns the original name when no replacement matches', () => {
    const result = applyComponentNameReplacements('payments', [{ from: 'ordershipping', to: 'order-shipping' }])
    assert.equal(result, 'payments')
  })

  it('returns the original name when replacements list is empty', () => {
    const result = applyComponentNameReplacements('payments', [])
    assert.equal(result, 'payments')
  })

  it('applies the first matching replacement', () => {
    const result = applyComponentNameReplacements('a', [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])
    assert.equal(result, 'b')
  })
})
```

Update the import line at the top of `test/import/config.test.ts` to include `applyComponentNameReplacements`:

```ts
import { loadImportConfig, buildOpenAPIConfig, buildAsyncAPIConfig, applyComponentNameReplacements } from '../../src/import/config.js'
```

- [ ] **Step 2: Run tests to verify they fail**

```
node --test dist/test/import/config.test.js
```

Expected: compile error or test failure mentioning `applyComponentNameReplacements` not exported.

- [ ] **Step 3: Add `ComponentNameReplacement`, update `ImportConfig`, add helper, update validation**

In `src/import/config.ts`, add after the existing imports:

```ts
export interface ComponentNameReplacement {
  from: string
  to: string
}
```

Update `ImportConfig`:

```ts
export interface ImportConfig {
  componentNameReplacements?: ComponentNameReplacement[]
  imports: ImportEntry[]
}
```

Add the helper function after `isImportConfig`:

```ts
export function applyComponentNameReplacements(
  name: string,
  replacements: ComponentNameReplacement[],
): string {
  return replacements.find(r => r.from === name)?.to ?? name
}
```

Update `loadImportConfig` to validate replacements — add this block inside the function after the `isImportConfig` check:

```ts
const cfg = raw as ImportConfig
for (const replacement of cfg.componentNameReplacements ?? []) {
  if (!replacement.from || !replacement.to) {
    throw new Error(`Invalid import config: componentNameReplacements entries must have non-empty "from" and "to"`)
  }
}
```

- [ ] **Step 4: Write failing tests for validation**

Add to the `describe('loadImportConfig', ...)` block in `test/import/config.test.ts`:

```ts
it('parses config with componentNameReplacements', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
  const filePath = path.join(tmpDir, 'imports.yaml')
  fs.writeFileSync(filePath, `
componentNameReplacements:
  - from: ordershipping
    to: order-shipping
imports:
  - adapter: openapi
    spec: ./orders.yaml
    componentMapping:
      strategy: uri-segment
      segment: 0
`)
  const config = loadImportConfig(filePath)
  assert.deepEqual(config.componentNameReplacements, [{ from: 'ordershipping', to: 'order-shipping' }])
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

it('throws when a replacement has empty from', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
  const filePath = path.join(tmpDir, 'bad.yaml')
  fs.writeFileSync(filePath, `
componentNameReplacements:
  - from: ''
    to: order-shipping
imports: []
`)
  assert.throws(() => loadImportConfig(filePath), /Invalid import config/)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

it('throws when a replacement has empty to', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
  const filePath = path.join(tmpDir, 'bad.yaml')
  fs.writeFileSync(filePath, `
componentNameReplacements:
  - from: ordershipping
    to: ''
imports: []
`)
  assert.throws(() => loadImportConfig(filePath), /Invalid import config/)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
```

- [ ] **Step 5: Run all config tests to verify they pass**

```
npm test
```

Expected: all tests pass, including the new ones.

- [ ] **Step 6: Commit**

```bash
git add src/import/config.ts test/import/config.test.ts
git commit -m "feat: add ComponentNameReplacement type, helper, and validation"
```

---

### Task 2: Thread `componentNameReplacements` through `AdapterContext` and adapter index files

**Files:**
- Modify: `src/adapters/index.ts`
- Modify: `src/import/runner.ts`
- Modify: `src/adapters/openapi/index.ts`
- Modify: `src/adapters/asyncapi/index.ts`
- Modify: `src/adapters/openapi/mapper.ts` (signature only, no behavior change yet)
- Modify: `src/adapters/asyncapi/mapper.ts` (signature only, no behavior change yet)

**Interfaces:**
- Consumes: `ComponentNameReplacement` from Task 1
- Produces:
  - `AdapterContext.componentNameReplacements: ComponentNameReplacement[]`
  - `mapDocument` in both mappers accepts `componentNameReplacements: ComponentNameReplacement[] = []` as 4th parameter (defaulted to keep existing tests passing)

- [ ] **Step 1: Add `componentNameReplacements` to `AdapterContext`**

In `src/adapters/index.ts`, update the import and interface:

```ts
import type { Diagnostic, Edge, Node, Template } from '../schema/index.js'
import type { ImportEntry, ComponentNameReplacement } from '../import/config.js'

export interface AdapterContext {
  packConfig: AdapterPackConfig
  templates: Map<string, Template>
  componentNameReplacements: ComponentNameReplacement[]
}
```

- [ ] **Step 2: Update `runner.ts` to pass replacements into context**

In `src/import/runner.ts`, update the adapter call inside the `for` loop:

```ts
const result = await adapter.import(resolvedEntry, {
  packConfig,
  templates: graph.templates,
  componentNameReplacements: config.componentNameReplacements ?? [],
})
```

- [ ] **Step 3: Update `mapDocument` signatures to accept replacements (default `[]`)**

In `src/adapters/openapi/mapper.ts`, update the `mapDocument` signature:

```ts
export function mapDocument(
  document: OpenAPIV3.Document,
  entry: OpenAPIImportEntry,
  packConfig: AdapterPackConfig,
  componentNameReplacements: ComponentNameReplacement[] = [],
): MapResult {
```

Add the import at the top of `src/adapters/openapi/mapper.ts`:

```ts
import type { ComponentNameReplacement } from '../../import/config.js'
import { applyComponentNameReplacements } from '../../import/config.js'
```

In `src/adapters/asyncapi/mapper.ts`, update the `mapDocument` signature:

```ts
export function mapDocument(
  document: AsyncAPIDocumentInterface,
  entry: AsyncAPIImportEntry,
  packConfig: AdapterPackConfig,
  componentNameReplacements: ComponentNameReplacement[] = [],
): MapResult {
```

Add the import at the top of `src/adapters/asyncapi/mapper.ts`:

```ts
import type { ComponentNameReplacement } from '../../import/config.js'
import { applyComponentNameReplacements } from '../../import/config.js'
```

- [ ] **Step 4: Update adapter index files to pass replacements to `mapDocument`**

In `src/adapters/openapi/index.ts`:

```ts
const { nodes, edges, diagnostics: mapDiagnostics } = mapDocument(document, entry, context.packConfig, context.componentNameReplacements)
```

In `src/adapters/asyncapi/index.ts`:

```ts
const { nodes, edges, diagnostics: mapDiagnostics } = mapDocument(document, entry, context.packConfig, context.componentNameReplacements)
```

- [ ] **Step 5: Run all tests to verify nothing is broken**

```
npm test
```

Expected: all existing tests pass (no behavior change yet — `componentNameReplacements` defaults to `[]` and is unused).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/index.ts src/import/runner.ts src/adapters/openapi/index.ts src/adapters/asyncapi/index.ts src/adapters/openapi/mapper.ts src/adapters/asyncapi/mapper.ts
git commit -m "feat: thread componentNameReplacements through AdapterContext to mapDocument"
```

---

### Task 3: Apply replacements in OpenAPI mapper

**Files:**
- Modify: `src/adapters/openapi/mapper.ts`
- Modify: `test/adapters/openapi/mapper.test.ts`

**Interfaces:**
- Consumes: `applyComponentNameReplacements` and `ComponentNameReplacement` imported in Task 2
- Produces: component names extracted from URI/tags are replaced before being used in node IDs

Two call sites in `src/adapters/openapi/mapper.ts`:
1. **Operations loop** inside `mapDocument` (~line 149): where `component` is derived from URI/tag for endpoint nodes
2. **`deriveComponentForSchema`** (~line 567): where `component` is derived for shared schemas — this private function needs `componentNameReplacements` added as a parameter

- [ ] **Step 1: Write a failing test for OpenAPI component name replacement**

Add to `test/adapters/openapi/mapper.test.ts` after the existing `mapDocument` describe blocks:

```ts
describe('mapDocument — componentNameReplacements', () => {
  it('rewrites extracted component name in endpoint node ID', () => {
    const doc = makeDoc({
      '/ordershipping/create': {
        post: {
          operationId: 'createShipment',
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG, [{ from: 'ordershipping', to: 'order-shipping' }])
    assert.ok(nodes.some(n => n.id === 'order-shipping.APIEndpoint.createShipment'), 'expected canonical component name in node ID')
    assert.ok(!nodes.some(n => n.id.startsWith('ordershipping.')), 'expected raw component name to be absent')
  })

  it('does not affect names with no matching replacement', () => {
    const doc = makeDoc({
      '/payments/capture': {
        post: {
          operationId: 'capturePayment',
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG, [{ from: 'ordershipping', to: 'order-shipping' }])
    assert.ok(nodes.some(n => n.id === 'payments.APIEndpoint.capturePayment'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
node --test dist/test/adapters/openapi/mapper.test.js
```

Expected: FAIL — node IDs still use raw `ordershipping`.

- [ ] **Step 3: Apply replacement at the operations loop call site**

In `src/adapters/openapi/mapper.ts`, inside `mapDocument`'s operations loop, find (~line 149):

```ts
const component = entry.componentMapping.strategy === 'tag'
  ? operation.tags?.[0]
  : deriveComponent(urlPath, entry.componentMapping)
```

Replace with:

```ts
const rawComponent = entry.componentMapping.strategy === 'tag'
  ? operation.tags?.[0]
  : deriveComponent(urlPath, entry.componentMapping)
const component = rawComponent !== undefined
  ? applyComponentNameReplacements(rawComponent, componentNameReplacements)
  : undefined
```

- [ ] **Step 4: Apply replacement in `deriveComponentForSchema`**

Add `componentNameReplacements: ComponentNameReplacement[]` as a parameter (before `visited`) to the private `deriveComponentForSchema` function. Find its signature (~line 556):

```ts
function deriveComponentForSchema(name: string, document: OpenAPIV3.Document, entry: OpenAPIImportEntry, visited: Set<string> = new Set()): string | undefined {
```

Replace with:

```ts
function deriveComponentForSchema(name: string, document: OpenAPIV3.Document, entry: OpenAPIImportEntry, componentNameReplacements: ComponentNameReplacement[], visited: Set<string> = new Set()): string | undefined {
```

Inside `deriveComponentForSchema`, find where components are added to `directComponents` (~line 567):

```ts
const component = entry.componentMapping.strategy === 'tag'
  ? operation.tags?.[0]
  : deriveComponent(urlPath, entry.componentMapping)
if (component) directComponents.add(component)
```

Replace with:

```ts
const rawComponent = entry.componentMapping.strategy === 'tag'
  ? operation.tags?.[0]
  : deriveComponent(urlPath, entry.componentMapping)
if (rawComponent) directComponents.add(applyComponentNameReplacements(rawComponent, componentNameReplacements))
```

Also update the recursive call inside `deriveComponentForSchema` itself (~line 578):

```ts
const comp = deriveComponentForSchema(schemaName, document, entry, visited)
```

Replace with:

```ts
const comp = deriveComponentForSchema(schemaName, document, entry, componentNameReplacements, visited)
```

Update the single external call site of `deriveComponentForSchema` in `mapDocument` Pass 1 (~line 95):

```ts
const component = deriveComponentForSchema(name, document, entry, componentNameReplacements)
```

- [ ] **Step 5: Run tests to verify they pass**

```
npm test
```

Expected: all tests pass including the two new OpenAPI replacement tests.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/openapi/mapper.ts test/adapters/openapi/mapper.test.ts
git commit -m "feat: apply componentNameReplacements in OpenAPI mapper"
```

---

### Task 4: Apply replacements in AsyncAPI mapper

**Files:**
- Modify: `src/adapters/asyncapi/mapper.ts`
- Modify: `test/import/asyncapi-runner.test.ts`

**Interfaces:**
- Consumes: `applyComponentNameReplacements` and `ComponentNameReplacement` imported in Task 2

Two call sites in `src/adapters/asyncapi/mapper.ts`:
1. **Schema component walk** inside `mapDocument` (~line 260): where `component` is derived for assigning shared schemas to components
2. **Operations loop** inside `mapDocument` (~line 328): where `component` is derived for event node IDs

- [ ] **Step 1: Write a failing integration test for AsyncAPI component name replacement**

Add to `test/import/asyncapi-runner.test.ts` a new describe block after existing tests:

```ts
describe('runImport — componentNameReplacements', () => {
  it('rewrites extracted AsyncAPI component name in event node ID', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        componentNameReplacements: [{ from: 'logistics', to: 'order-logistics' }],
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'simple-events.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        } as AsyncAPIImportEntry],
      }
      const runtimeConfig = makeRuntimeConfig(graphDir)
      await runImport(config, runtimeConfig)
      const eventPath = path.join(graphDir, 'components', 'order-logistics', 'IntegrationEvents', 'ShipmentDispatched.yaml')
      assert.ok(fs.existsSync(eventPath), `expected node file at ${eventPath}`)
      const rawPath = path.join(graphDir, 'components', 'logistics', 'IntegrationEvents', 'ShipmentDispatched.yaml')
      assert.ok(!fs.existsSync(rawPath), 'expected raw component name to be absent')
    } finally {
      cleanup()
    }
  })
})
```

Note: `simple-events.yaml` produces a `logistics` component from the channel segment. This test remaps it to `order-logistics`.

- [ ] **Step 2: Run the test to verify it fails**

```
node --test dist/test/import/asyncapi-runner.test.js
```

Expected: FAIL — node file still written under `logistics/`.

- [ ] **Step 3: Apply replacement at the schema component walk call site**

In `src/adapters/asyncapi/mapper.ts`, inside `mapDocument`'s schema component walk (~line 260), find:

```ts
const component = extractValue(entry.componentMapping, operation, message)
if (!component) continue
```

Replace with:

```ts
const rawComponent = extractValue(entry.componentMapping, operation, message)
if (!rawComponent) continue
const component = applyComponentNameReplacements(rawComponent, componentNameReplacements)
```

- [ ] **Step 4: Apply replacement at the operations loop call site**

In `src/adapters/asyncapi/mapper.ts`, inside the operations loop (~line 328), find:

```ts
const component = extractValue(entry.componentMapping, operation, message)
if (!component) {
  diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for message on channel "${channelAddress}" — skipping` })
  continue
}
```

Replace with:

```ts
const rawComponent = extractValue(entry.componentMapping, operation, message)
if (!rawComponent) {
  diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for message on channel "${channelAddress}" — skipping` })
  continue
}
const component = applyComponentNameReplacements(rawComponent, componentNameReplacements)
```

- [ ] **Step 5: Run all tests to verify they pass**

```
npm test
```

Expected: all tests pass including the new AsyncAPI replacement integration test.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/asyncapi/mapper.ts test/import/asyncapi-runner.test.ts
git commit -m "feat: apply componentNameReplacements in AsyncAPI mapper"
```
