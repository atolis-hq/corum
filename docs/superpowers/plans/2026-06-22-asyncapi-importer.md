# AsyncAPI Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an AsyncAPI v2+v3 importer as `AsyncAPIAdapter`, creating `IntegrationEvent`/`DomainEvent`/`Schema`/`Field`/`EnumDefinition` nodes from an AsyncAPI spec, following the same patterns as the existing OpenAPI adapter.

**Architecture:** Three new files under `src/adapters/asyncapi/` (`parser.ts`, `mapper.ts`, `index.ts`) mirroring the OpenAPI adapter layout. Config type in `src/import/config.ts` replaces the stub `AsyncAPIImportEntry`. Event.yaml template is updated. A new pack adapter config `.corum/packs/messaging/adapters/asyncapi.yaml` drives template and scalar-type mapping.

**Tech Stack:** `@asyncapi/parser` v3 (handles both AsyncAPI v2.x and v3.0 via unified API), Node.js built-in test runner (`node:test`), TypeScript strict mode, ESM.

## Global Constraints

- TypeScript strict ESM: all imports use `.js` extension, `"type": "module"` in package.json
- Test runner: `node:test` + `node:assert/strict` — no Jest, no Vitest
- Golden file normalization: replace `lastModifiedAt: .+` and `extractedFrom: .+` before comparison (see existing `test/import/runner.test.ts`)
- Node IDs: `{component}.{TemplateName}.{name}` for root nodes (3-segment); child IDs extend with `.{section}.{name}`
- All generated nodes: `state: 'implemented'`, `stability: 'unstable'`, `schemaVersion: '1'`, `derivedBy: 'adapter:asyncapi'`, `derivation: 'determined'`
- `@asyncapi/parser` diagnostic severities: `0` = error, `1` = warning — map to Corum `'error'`/`'warning'`
- `message.name()` → primary name source; `message.id()` → fallback for `messageNaming` strategies; anonymous (neither) → error + skip
- Same message name on 2+ channels → 1 Event node; topic holds first channel address; `severity: 'info'` diagnostic for extras (note: Corum `Diagnostic.severity` only accepts `'error'|'warning'` — cast `'info'` diagnostics to `'warning'` with an `[INFO]` prefix, or omit; check `src/schema/index.ts` before deciding)
- Schema counting counts **unique message names** per schema (not raw message count) — deduplication happens before counting
- BFS closure: schemas referenced by shared schemas are also promoted to shared
- `correlationId` is transport metadata, not a payload field — it belongs in `headers`

---

### Task 1: Install `@asyncapi/parser` and replace `AsyncAPIImportEntry` stub

**Files:**
- Modify: `package.json`
- Modify: `src/import/config.ts`
- Modify: `test/import/config.test.ts`

**Interfaces:**
- Produces: `FieldStrategy` (exported type), `AsyncAPIImportEntry` (exported interface), `buildAsyncAPIConfig(spec, strategy, opts): AsyncAPIImportEntry` (exported function)

- [ ] **Step 1: Write failing tests — add to `test/import/config.test.ts`**

Add these imports at the top:
```typescript
import { buildAsyncAPIConfig } from '../../src/import/config.js'
```

Add this describe block:
```typescript
describe('buildAsyncAPIConfig', () => {
  it('builds channel-segment config', () => {
    const entry = buildAsyncAPIConfig('./events.yaml', 'channel-segment', { separator: '.', segment: 0 })
    assert.deepEqual(entry, {
      adapter: 'asyncapi',
      spec: './events.yaml',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
    })
  })

  it('builds hardcoded config', () => {
    const entry = buildAsyncAPIConfig('./events.yaml', 'hardcoded', { value: 'orders' })
    assert.deepEqual(entry, {
      adapter: 'asyncapi',
      spec: './events.yaml',
      componentMapping: { strategy: 'hardcoded', value: 'orders' },
    })
  })

  it('builds channel-pattern config', () => {
    const entry = buildAsyncAPIConfig('./events.yaml', 'channel-pattern', { pattern: '^([a-z]+)\\.' })
    assert.deepEqual(entry, {
      adapter: 'asyncapi',
      spec: './events.yaml',
      componentMapping: { strategy: 'channel-pattern', pattern: '^([a-z]+)\\.' },
    })
  })

  it('throws when hardcoded strategy missing value', () => {
    assert.throws(() => buildAsyncAPIConfig('./events.yaml', 'hardcoded', {}), /--component required/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```
npm run build 2>&1 | head -10
```
Expected: compile error — `buildAsyncAPIConfig` not found in `config.ts`

- [ ] **Step 3: Install `@asyncapi/parser`**

```bash
npm install @asyncapi/parser
```

- [ ] **Step 4: Replace `src/import/config.ts`**

```typescript
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

export type FieldStrategy =
  | { strategy: 'channel-segment'; separator: string; segment: number }
  | { strategy: 'channel-pattern'; pattern: string }
  | { strategy: 'name-segment'; separator: string; segment: number }
  | { strategy: 'name-pattern'; pattern: string }
  | { strategy: 'tag' }
  | { strategy: 'hardcoded'; value: string }

export type ComponentMapping =
  | { strategy: 'uri-segment'; segment: number }
  | { strategy: 'uri-segment'; pattern: string }
  | { strategy: 'tag' }
  | { strategy: 'hardcoded'; component: string }

export interface OpenAPIImportEntry {
  adapter: 'openapi'
  spec: string
  componentMapping: ComponentMapping
}

export interface AsyncAPIImportEntry {
  adapter: 'asyncapi'
  spec: string
  componentMapping: FieldStrategy
  messageNaming?: FieldStrategy
  eventClassification?:
    | { strategy: 'always-integration' }
    | { strategy: 'always-domain' }
    | { from: FieldStrategy; domainValue: string }
}

export type ImportEntry = OpenAPIImportEntry | AsyncAPIImportEntry

export interface ImportConfig {
  imports: ImportEntry[]
}

export function loadImportConfig(filePath: string): ImportConfig {
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    throw new Error(`Failed to parse import config: ${err}`)
  }
  if (!isImportConfig(raw)) {
    throw new Error(`Invalid import config: must have an "imports" array`)
  }
  return raw
}

function isImportConfig(value: unknown): value is ImportConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'imports' in value &&
    Array.isArray((value as Record<string, unknown>).imports)
  )
}

export function buildOpenAPIConfig(
  spec: string,
  strategy: string,
  segment?: number,
  pattern?: string,
  component?: string,
): OpenAPIImportEntry {
  let componentMapping: ComponentMapping
  if (strategy === 'hardcoded') {
    if (!component) throw new Error('--component required for hardcoded strategy')
    componentMapping = { strategy: 'hardcoded', component }
  } else if (strategy === 'tag') {
    componentMapping = { strategy: 'tag' }
  } else if (pattern) {
    componentMapping = { strategy: 'uri-segment', pattern }
  } else {
    componentMapping = { strategy: 'uri-segment', segment: segment ?? 0 }
  }
  return { adapter: 'openapi', spec, componentMapping }
}

export function buildAsyncAPIConfig(
  spec: string,
  strategy: string,
  opts: { separator?: string; segment?: number; pattern?: string; value?: string } = {},
): AsyncAPIImportEntry {
  let componentMapping: FieldStrategy
  if (strategy === 'hardcoded') {
    if (!opts.value) throw new Error('--component required for hardcoded strategy')
    componentMapping = { strategy: 'hardcoded', value: opts.value }
  } else if (strategy === 'tag') {
    componentMapping = { strategy: 'tag' }
  } else if (strategy === 'channel-pattern') {
    componentMapping = { strategy: 'channel-pattern', pattern: opts.pattern ?? '' }
  } else if (strategy === 'name-pattern') {
    componentMapping = { strategy: 'name-pattern', pattern: opts.pattern ?? '' }
  } else if (strategy === 'name-segment') {
    componentMapping = { strategy: 'name-segment', separator: opts.separator ?? '.', segment: opts.segment ?? 0 }
  } else {
    // default: channel-segment
    componentMapping = { strategy: 'channel-segment', separator: opts.separator ?? '.', segment: opts.segment ?? 0 }
  }
  return { adapter: 'asyncapi', spec, componentMapping }
}
```

- [ ] **Step 5: Build and run tests**

```
npm test
```
Expected: all prior tests pass, new `buildAsyncAPIConfig` tests pass

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/import/config.ts test/import/config.test.ts
git commit -m "feat: add @asyncapi/parser dep and replace AsyncAPIImportEntry stub with full FieldStrategy type"
```

---

### Task 2: Update Event template and add pack adapter config

**Files:**
- Modify: `.corum/packs/messaging/templates/Event.yaml`
- Create: `.corum/packs/messaging/adapters/asyncapi.yaml`

**Interfaces:**
- Produces: Event template with `topic`, `description`, `headers` properties (inheritable by DomainEvent + IntegrationEvent); `correlationId` removed

- [ ] **Step 1: Update `.corum/packs/messaging/templates/Event.yaml`**

Replace the file entirely:

```yaml
name: Event
info:
  version: "1.0.0"
  core: false
  abstract: true
  description: |
    Abstract base for all event types. Defines the shared payload schema.
    Use DomainEvent for internal facts; IntegrationEvent for cross-service contracts.
    correlationId is transport-level metadata — model it in headers, not as a payload field.

properties:
  type: object
  additionalProperties: false
  properties:
    topic:
      type: string
      description: "The channel address (topic/queue/stream) this event is published on."
    description:
      type: string
      description: "Human-readable description of what this event represents."
    headers:
      type: object
      description: "Map of header name to header definition. Carries message-level metadata (correlationId, traceId, etc.) separate from the payload."
      additionalProperties:
        type: object
        additionalProperties: false
        required:
          - type
        properties:
          type:
            type: string
            enum: [uuid, string, integer, decimal, boolean, datetime, date]
          required:
            type: boolean
          description:
            type: string

edges:
  outgoing:
    - triggers
  incoming:
    - produces

ui:
  icon: bolt
  colour: "#E8A838"
  displayName: Event
  displayProperties: []
```

- [ ] **Step 2: Verify the adapters directory path**

```bash
ls .corum/packs/messaging/
```
Expected: see `templates/` and `pack.yaml` — `adapters/` directory may not exist yet

- [ ] **Step 3: Create `.corum/packs/messaging/adapters/asyncapi.yaml`**

Create the directory and file:

```yaml
adapter: asyncapi
version: '1.0'

constructs:
  message:
    integrationTemplate: IntegrationEvent
    domainTemplate: DomainEvent

  payloadSchema:
    template: Schema
    section: schemas

  payloadField:
    template: Field
    section: fields

  enumDefinition:
    template: EnumDefinition
    section: enums

  enumValue:
    template: EnumValue
    section: values

scalarTypes:
  string: string
  string/uuid: uuid
  string/date: date
  string/date-time: datetime
  integer: integer
  number: decimal
  boolean: boolean
```

- [ ] **Step 4: Run tests to confirm no regressions**

```
npm test
```
Expected: all tests pass — template change removes `correlationId` property only, no structural impact on loader

- [ ] **Step 5: Commit**

```bash
git add .corum/packs/messaging/templates/Event.yaml .corum/packs/messaging/adapters/asyncapi.yaml
git commit -m "feat: update Event template (add topic/description/headers, remove correlationId) and add asyncapi pack adapter config"
```

---

### Task 3: AsyncAPI parser wrapper

**Files:**
- Create: `src/adapters/asyncapi/parser.ts`
- Create: `test/adapters/asyncapi/parser.test.ts`
- Create: `test/fixtures/asyncapi/specs/petstore-v3.yaml` (copy from docs/)
- Create: `test/fixtures/asyncapi/specs/petstore-v2.yaml` (copy from docs/)

**Interfaces:**
- Produces: `parseSpec(specPath: string): Promise<ParseResult>` where `ParseResult = { document: AsyncAPIDocumentInterface | null; diagnostics: Diagnostic[] }`

- [ ] **Step 1: Copy petstore specs to fixtures**

```bash
mkdir -p test/fixtures/asyncapi/specs
cp docs/spec-examples/asyncapi/petstore.asyncapi.3.0.yaml test/fixtures/asyncapi/specs/petstore-v3.yaml
cp docs/spec-examples/asyncapi/petstore.asyncapi.2.6.yaml test/fixtures/asyncapi/specs/petstore-v2.yaml
```

- [ ] **Step 2: Write failing test**

Create `test/adapters/asyncapi/parser.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSpec } from '../../../src/adapters/asyncapi/parser.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const specsDir = path.join(__dirname, '..', '..', 'fixtures', 'asyncapi', 'specs')

describe('parseSpec', () => {
  it('parses an AsyncAPI v3 spec and returns a document', async () => {
    const { document, diagnostics } = await parseSpec(path.join(specsDir, 'petstore-v3.yaml'))
    assert.ok(document, 'document should be defined')
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('parses an AsyncAPI v2 spec and returns a document', async () => {
    const { document, diagnostics } = await parseSpec(path.join(specsDir, 'petstore-v2.yaml'))
    assert.ok(document, 'document should be defined')
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('returns null document and error diagnostic for a missing file', async () => {
    const { document, diagnostics } = await parseSpec('/nonexistent/path/spec.yaml')
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'), 'should have at least one error diagnostic')
  })
})
```

- [ ] **Step 3: Run to verify failure**

```
npm run build 2>&1 | head -10
```
Expected: compile error — `parser.ts` not found

- [ ] **Step 4: Create `src/adapters/asyncapi/parser.ts`**

```typescript
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Parser } from '@asyncapi/parser'
import type { AsyncAPIDocumentInterface } from '@asyncapi/parser'
import type { Diagnostic } from '../../schema/index.js'

export interface ParseResult {
  document: AsyncAPIDocumentInterface | null
  diagnostics: Diagnostic[]
}

const parser = new Parser()

export async function parseSpec(specPath: string): Promise<ParseResult> {
  const diagnostics: Diagnostic[] = []
  try {
    const content = readFileSync(specPath, 'utf-8')
    const source = `file://${path.resolve(specPath)}`
    const result = await parser.parse(content, { source })

    for (const d of result.diagnostics) {
      if (d.severity === 0) {
        diagnostics.push({ severity: 'error', file: specPath, message: d.message })
      } else if (d.severity === 1) {
        diagnostics.push({ severity: 'warning', file: specPath, message: d.message })
      }
    }

    if (!result.document) {
      if (!diagnostics.some(d => d.severity === 'error')) {
        diagnostics.push({ severity: 'error', file: specPath, message: 'AsyncAPI parser returned no document' })
      }
      return { document: null, diagnostics }
    }

    return { document: result.document, diagnostics }
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: `Failed to parse AsyncAPI spec: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { document: null, diagnostics }
  }
}
```

- [ ] **Step 5: Build and run tests**

```
npm test
```
Expected: parser tests pass; petstore v2 and v3 each produce a non-null document with no errors

- [ ] **Step 6: Commit**

```bash
git add src/adapters/asyncapi/parser.ts test/adapters/asyncapi/parser.test.ts test/fixtures/asyncapi/specs/
git commit -m "feat: AsyncAPI parser wrapper (handles v2 and v3 via @asyncapi/parser)"
```

---

### Task 4: `extractValue` and `deriveScalarType` in mapper

**Files:**
- Create: `src/adapters/asyncapi/mapper.ts`
- Create: `test/adapters/asyncapi/mapper.test.ts`

**Interfaces:**
- Produces: `extractValue(strategy: FieldStrategy, operation: OperationInterface, message: MessageInterface): string | undefined`, `deriveScalarType(type: string, format: string | undefined, scalarTypes: Record<string, string>): string | undefined`

- [ ] **Step 1: Write failing tests**

Create `test/adapters/asyncapi/mapper.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractValue, deriveScalarType } from '../../../src/adapters/asyncapi/mapper.js'

const SCALAR_TYPES: Record<string, string> = {
  string: 'string', integer: 'integer', boolean: 'boolean', number: 'decimal',
  'string/uuid': 'uuid', 'string/date': 'date', 'string/date-time': 'datetime',
}

function makeOp(channelAddress: string, opTags: string[] = []) {
  return {
    channels: () => ({ all: () => [{ address: () => channelAddress }] }),
    tags: () => ({ all: () => opTags.map(name => ({ name: () => name })) }),
  }
}

function makeMsg(name: string | undefined, id = 'msg-id', msgTags: string[] = []) {
  return {
    name: () => name,
    id: () => id,
    tags: () => ({ all: () => msgTags.map(t => ({ name: () => t })) }),
  }
}

describe('extractValue', () => {
  it('channel-segment: splits on separator and returns segment by index', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 0 }, op as any, msg as any), 'orders')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 1 }, op as any, msg as any), 'v1')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 2 }, op as any, msg as any), 'order-placed')
  })

  it('channel-segment: negative segment counts from end', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: -1 }, op as any, msg as any), 'order-placed')
  })

  it('channel-segment: returns undefined for out-of-range segment', () => {
    const op = makeOp('orders')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-segment', separator: '.', segment: 5 }, op as any, msg as any), undefined)
  })

  it('channel-pattern: returns first capture group', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-pattern', pattern: '^([a-z]+)\\.' }, op as any, msg as any), 'orders')
  })

  it('channel-pattern: returns full match when no capture group', () => {
    const op = makeOp('orders.v1.order-placed')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-pattern', pattern: 'orders' }, op as any, msg as any), 'orders')
  })

  it('channel-pattern: returns undefined when no match', () => {
    const op = makeOp('orders.v1')
    const msg = makeMsg('OrderPlaced')
    assert.equal(extractValue({ strategy: 'channel-pattern', pattern: 'nomatch' }, op as any, msg as any), undefined)
  })

  it('name-segment: splits message name on separator', () => {
    const op = makeOp('any')
    const msg = makeMsg('OrderPlaced.v2')
    assert.equal(extractValue({ strategy: 'name-segment', separator: '.', segment: 0 }, op as any, msg as any), 'OrderPlaced')
    assert.equal(extractValue({ strategy: 'name-segment', separator: '.', segment: -1 }, op as any, msg as any), 'v2')
  })

  it('name-segment: falls back to id when name() is undefined', () => {
    const op = makeOp('any')
    const msg = makeMsg(undefined, 'OrderPlaced.v2')
    assert.equal(extractValue({ strategy: 'name-segment', separator: '.', segment: 0 }, op as any, msg as any), 'OrderPlaced')
  })

  it('name-pattern: returns match from message name', () => {
    const op = makeOp('any')
    const msg = makeMsg('ProductUpdatedDomainEvent')
    assert.equal(extractValue({ strategy: 'name-pattern', pattern: 'DomainEvent' }, op as any, msg as any), 'DomainEvent')
    assert.equal(extractValue({ strategy: 'name-pattern', pattern: 'IntegrationEvent' }, op as any, msg as any), undefined)
  })

  it('tag: returns first tag from message', () => {
    const op = makeOp('any', [])
    const msg = makeMsg('OrderPlaced', 'id', ['domain'])
    assert.equal(extractValue({ strategy: 'tag' }, op as any, msg as any), 'domain')
  })

  it('tag: falls back to operation tags when message has none', () => {
    const op = makeOp('any', ['integration'])
    const msg = makeMsg('OrderPlaced', 'id', [])
    assert.equal(extractValue({ strategy: 'tag' }, op as any, msg as any), 'integration')
  })

  it('hardcoded: always returns the fixed value', () => {
    const op = makeOp('any')
    const msg = makeMsg('Anything')
    assert.equal(extractValue({ strategy: 'hardcoded', value: 'payments' }, op as any, msg as any), 'payments')
  })
})

describe('deriveScalarType', () => {
  it('maps JSON Schema primitive types to Corum scalar types', () => {
    assert.equal(deriveScalarType('string', undefined, SCALAR_TYPES), 'string')
    assert.equal(deriveScalarType('integer', undefined, SCALAR_TYPES), 'integer')
    assert.equal(deriveScalarType('boolean', undefined, SCALAR_TYPES), 'boolean')
    assert.equal(deriveScalarType('number', undefined, SCALAR_TYPES), 'decimal')
  })

  it('maps format-qualified types', () => {
    assert.equal(deriveScalarType('string', 'uuid', SCALAR_TYPES), 'uuid')
    assert.equal(deriveScalarType('string', 'date', SCALAR_TYPES), 'date')
    assert.equal(deriveScalarType('string', 'date-time', SCALAR_TYPES), 'datetime')
  })

  it('returns undefined for unknown types', () => {
    assert.equal(deriveScalarType('object', undefined, SCALAR_TYPES), undefined)
    assert.equal(deriveScalarType('array', undefined, SCALAR_TYPES), undefined)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```
npm run build 2>&1 | head -10
```
Expected: compile error — `mapper.ts` not found

- [ ] **Step 3: Create `src/adapters/asyncapi/mapper.ts`**

```typescript
import type { OperationInterface, MessageInterface, AsyncAPIDocumentInterface } from '@asyncapi/parser'
import type { Node, Edge, Diagnostic } from '../../schema/index.js'
import type { AdapterPackConfig } from '../index.js'
import type { AsyncAPIImportEntry, FieldStrategy } from '../../import/config.js'

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function extractValue(
  strategy: FieldStrategy,
  operation: OperationInterface,
  message: MessageInterface,
): string | undefined {
  switch (strategy.strategy) {
    case 'channel-segment': {
      const address = operation.channels().all()[0]?.address() ?? ''
      const parts = address.split(strategy.separator).filter(s => s.length > 0)
      const idx = strategy.segment < 0 ? parts.length + strategy.segment : strategy.segment
      return parts[idx]
    }
    case 'channel-pattern': {
      const address = operation.channels().all()[0]?.address() ?? ''
      const match = address.match(strategy.pattern)
      return match?.[1] ?? match?.[0]
    }
    case 'name-segment': {
      const source = message.name() ?? message.id()
      if (!source) return undefined
      const parts = source.split(strategy.separator).filter(s => s.length > 0)
      const idx = strategy.segment < 0 ? parts.length + strategy.segment : strategy.segment
      return parts[idx]
    }
    case 'name-pattern': {
      const source = message.name() ?? message.id()
      if (!source) return undefined
      const match = source.match(strategy.pattern)
      return match?.[1] ?? match?.[0]
    }
    case 'tag': {
      const msgTags = message.tags().all()
      if (msgTags.length > 0) return msgTags[0].name()
      const opTagsFn = (operation as unknown as { tags?: () => { all: () => Array<{ name(): string }> } }).tags
      const opTags = opTagsFn?.()?.all?.() ?? []
      return opTags[0]?.name()
    }
    case 'hardcoded':
      return strategy.value
  }
}

export function deriveScalarType(
  type: string,
  format: string | undefined,
  scalarTypes: Record<string, string>,
): string | undefined {
  if (format && scalarTypes[`${type}/${format}`]) return scalarTypes[`${type}/${format}`]
  return scalarTypes[type]
}

// Placeholder — completed in Task 7
export function mapDocument(
  _document: AsyncAPIDocumentInterface,
  _entry: AsyncAPIImportEntry,
  _packConfig: AdapterPackConfig,
): MapResult {
  return { nodes: [], edges: [], diagnostics: [] }
}
```

- [ ] **Step 4: Build and run tests**

```
npm test
```
Expected: `extractValue` and `deriveScalarType` tests pass; prior tests unaffected

- [ ] **Step 5: Commit**

```bash
git add src/adapters/asyncapi/mapper.ts test/adapters/asyncapi/mapper.test.ts
git commit -m "feat: AsyncAPI mapper scaffold with extractValue and deriveScalarType"
```

---

### Task 5: `deriveMessageName`, `classifyEvent`, and `deriveNodeId`

**Files:**
- Modify: `src/adapters/asyncapi/mapper.ts`
- Modify: `test/adapters/asyncapi/mapper.test.ts`

**Interfaces:**
- Consumes: `extractValue` from Task 4
- Produces: `deriveMessageName(message, namingCtx, specPath): { name: string } | null`, `classifyEvent(classification, operation, message): 'IntegrationEvent' | 'DomainEvent'`, `deriveNodeId(kind, component, name, opts?): string`, `toKebabCase(str): string` (internal helper, exported for testing)

- [ ] **Step 1: Write failing tests — add to `test/adapters/asyncapi/mapper.test.ts`**

Add imports:
```typescript
import { deriveMessageName, classifyEvent, deriveNodeId, toKebabCase } from '../../../src/adapters/asyncapi/mapper.js'
```

Add describe blocks:
```typescript
describe('toKebabCase', () => {
  it('converts PascalCase to kebab-case', () => {
    assert.equal(toKebabCase('OrderPlaced'), 'order-placed')
    assert.equal(toKebabCase('DomainEvent'), 'domain-event')
  })
  it('passes through already-kebab strings', () => {
    assert.equal(toKebabCase('order-placed'), 'order-placed')
  })
  it('normalises multiple separators', () => {
    assert.equal(toKebabCase('Order__Placed'), 'order-placed')
  })
})

describe('deriveMessageName', () => {
  it('returns kebab-case of message.name() when no messageNaming config', () => {
    const msg = makeMsg('OrderPlaced')
    assert.deepEqual(deriveMessageName(msg as any, undefined, 'spec.yaml'), { name: 'order-placed' })
  })

  it('applies messageNaming strategy to message name', () => {
    const op = makeOp('any')
    const msg = makeMsg('OrderPlaced.v2')
    const result = deriveMessageName(
      msg as any,
      { strategy: { strategy: 'name-segment', separator: '.', segment: 0 }, operation: op as any },
      'spec.yaml',
    )
    assert.deepEqual(result, { name: 'order-placed' })
  })

  it('returns null when name is absent and no messageNaming config', () => {
    const msg = makeMsg(undefined, 'some-id')
    assert.equal(deriveMessageName(msg as any, undefined, 'spec.yaml'), null)
  })

  it('returns null for anonymous message (no name, no id)', () => {
    const msg = makeMsg(undefined, '')
    assert.equal(deriveMessageName(msg as any, undefined, 'spec.yaml'), null)
  })
})

describe('classifyEvent', () => {
  it('returns IntegrationEvent when classification is absent', () => {
    assert.equal(classifyEvent(undefined, makeOp('any') as any, makeMsg('OrderPlaced') as any), 'IntegrationEvent')
  })

  it('returns IntegrationEvent for always-integration', () => {
    assert.equal(classifyEvent({ strategy: 'always-integration' }, makeOp('any') as any, makeMsg('OrderPlaced') as any), 'IntegrationEvent')
  })

  it('returns DomainEvent for always-domain', () => {
    assert.equal(classifyEvent({ strategy: 'always-domain' }, makeOp('any') as any, makeMsg('OrderPlaced') as any), 'DomainEvent')
  })

  it('returns DomainEvent when extracted value matches domainValue', () => {
    const classification = { from: { strategy: 'channel-segment' as const, separator: '.', segment: 0 }, domainValue: 'internal' }
    assert.equal(classifyEvent(classification, makeOp('internal.orders') as any, makeMsg('OrderPlaced') as any), 'DomainEvent')
  })

  it('returns IntegrationEvent when extracted value does not match domainValue', () => {
    const classification = { from: { strategy: 'channel-segment' as const, separator: '.', segment: 0 }, domainValue: 'internal' }
    assert.equal(classifyEvent(classification, makeOp('external.orders') as any, makeMsg('OrderPlaced') as any), 'IntegrationEvent')
  })
})

describe('deriveNodeId', () => {
  it('builds IntegrationEvent root node ID', () => {
    assert.equal(
      deriveNodeId('event', 'orders', 'order-placed', { template: 'IntegrationEvent' }),
      'orders.IntegrationEvent.order-placed',
    )
  })

  it('builds DomainEvent root node ID', () => {
    assert.equal(
      deriveNodeId('event', 'orders', 'order-created', { template: 'DomainEvent' }),
      'orders.DomainEvent.order-created',
    )
  })

  it('builds Schema child node ID from parent and section', () => {
    assert.equal(
      deriveNodeId('schema', 'orders', 'order-placed', {
        parentId: 'orders.IntegrationEvent.order-placed',
        section: 'schemas',
      }),
      'orders.IntegrationEvent.order-placed.schemas.order-placed',
    )
  })

  it('builds Field child node ID', () => {
    assert.equal(
      deriveNodeId('field', 'orders', 'orderId', {
        parentId: 'orders.IntegrationEvent.order-placed.schemas.order-placed',
        section: 'fields',
      }),
      'orders.IntegrationEvent.order-placed.schemas.order-placed.fields.orderId',
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

```
npm run build 2>&1 | head -10
```
Expected: compile errors for missing exports

- [ ] **Step 3: Add functions to `src/adapters/asyncapi/mapper.ts`**

Insert after `deriveScalarType`:

```typescript
export function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function deriveMessageName(
  message: MessageInterface,
  namingCtx: { strategy: FieldStrategy; operation: OperationInterface } | undefined,
  _specPath: string,
): { name: string } | null {
  const rawName = message.name()
  const rawId = message.id()

  if (!rawName && (!rawId || rawId.startsWith('<anonymous'))) return null
  if (!rawName && !namingCtx) return null

  const extracted = namingCtx
    ? extractValue(namingCtx.strategy, namingCtx.operation, message)
    : rawName

  if (!extracted) return null
  return { name: toKebabCase(extracted) }
}

export function classifyEvent(
  classification: AsyncAPIImportEntry['eventClassification'],
  operation: OperationInterface,
  message: MessageInterface,
): 'IntegrationEvent' | 'DomainEvent' {
  if (!classification || classification.strategy === 'always-integration') return 'IntegrationEvent'
  if (classification.strategy === 'always-domain') return 'DomainEvent'
  const value = extractValue(classification.from, operation, message)
  return value === classification.domainValue ? 'DomainEvent' : 'IntegrationEvent'
}

export function deriveNodeId(
  kind: 'event' | 'schema' | 'field' | 'enum' | 'enumValue',
  component: string,
  name: string,
  opts?: { template?: string; parentId?: string; section?: string },
): string {
  if (kind === 'event') return `${component}.${opts?.template ?? 'IntegrationEvent'}.${name}`
  return `${opts!.parentId}.${opts!.section}.${name}`
}
```

- [ ] **Step 4: Build and run tests**

```
npm test
```
Expected: all new tests pass; prior tests unchanged

- [ ] **Step 5: Commit**

```bash
git add src/adapters/asyncapi/mapper.ts test/adapters/asyncapi/mapper.test.ts
git commit -m "feat: deriveMessageName, classifyEvent, deriveNodeId for AsyncAPI mapper"
```

---

### Task 6: Schema counting and `extractHeaders`

**Files:**
- Modify: `src/adapters/asyncapi/mapper.ts`
- Modify: `test/adapters/asyncapi/mapper.test.ts`

**Interfaces:**
- Produces: `countMessageSchemaUsage(document): Map<string, number>`, `collectSharedSchemaNames(document, counts): Set<string>`, `extractHeaders(rawHeaders, scalarTypes, specPath): { headers: Record<string, unknown>; diagnostics: Diagnostic[] } | null`

- [ ] **Step 1: Write failing tests — add to `test/adapters/asyncapi/mapper.test.ts`**

Add imports:
```typescript
import { countMessageSchemaUsage, collectSharedSchemaNames, extractHeaders } from '../../../src/adapters/asyncapi/mapper.js'
```

Add describe blocks:
```typescript
function makeDoc(schemaNames: string[], messages: Array<{ name: string; payloadRef?: string }>) {
  const ops = messages.map(m => ({
    messages: () => ({
      all: () => [{
        name: () => m.name,
        id: () => m.name,
        json: () => m.payloadRef ? { payload: { $ref: `#/components/schemas/${m.payloadRef}` } } : {},
      }],
    }),
    channels: () => ({ all: () => [{ address: () => 'test.channel' }] }),
  }))
  return {
    allOperations: () => ops,
    json: () => ({ components: { schemas: Object.fromEntries(schemaNames.map(n => [n, { type: 'object' }])) } }),
  }
}

describe('countMessageSchemaUsage', () => {
  it('counts 1 when one unique message name references a schema', () => {
    const doc = makeDoc(['Order'], [{ name: 'OrderPlaced', payloadRef: 'Order' }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Order'), 1)
  })

  it('counts 1 when two messages with the same name reference the same schema', () => {
    const doc = makeDoc(['Pet'], [{ name: 'Pet', payloadRef: 'Pet' }, { name: 'Pet', payloadRef: 'Pet' }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Pet'), 1)
  })

  it('counts 2 when two differently-named messages reference the same schema', () => {
    const doc = makeDoc(['Payload'], [{ name: 'EventA', payloadRef: 'Payload' }, { name: 'EventB', payloadRef: 'Payload' }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Payload'), 2)
  })

  it('returns 0 for schemas not referenced by any message', () => {
    const doc = makeDoc(['Unused'], [{ name: 'Event', payloadRef: undefined }])
    assert.equal(countMessageSchemaUsage(doc as any).get('Unused'), undefined)
  })
})

describe('collectSharedSchemaNames', () => {
  it('marks schemas with count >= 2 as shared', () => {
    const doc = makeDoc(['Shared', 'Owned'], [])
    const shared = collectSharedSchemaNames(doc as any, new Map([['Shared', 2], ['Owned', 1]]))
    assert.equal(shared.has('Shared'), true)
    assert.equal(shared.has('Owned'), false)
  })

  it('promotes schemas referenced by shared schemas (BFS closure)', () => {
    const doc = {
      allOperations: () => [],
      json: () => ({
        components: {
          schemas: {
            Shared: { type: 'object', properties: { child: { $ref: '#/components/schemas/Child' } } },
            Child: { type: 'object' },
          },
        },
      }),
    }
    const shared = collectSharedSchemaNames(doc as any, new Map([['Shared', 2]]))
    assert.equal(shared.has('Shared'), true)
    assert.equal(shared.has('Child'), true)
  })
})

describe('extractHeaders', () => {
  const ST = { string: 'string', integer: 'integer', 'string/uuid': 'uuid' }

  it('maps flat header properties to Corum header shape', () => {
    const raw = {
      type: 'object',
      properties: { correlationId: { type: 'string', format: 'uuid' }, retryCount: { type: 'integer' } },
      required: ['correlationId'],
    }
    const result = extractHeaders(raw, ST, 'spec.yaml')
    assert.ok(result)
    assert.deepEqual(result.headers, {
      correlationId: { type: 'uuid', required: true },
      retryCount: { type: 'integer', required: false },
    })
    assert.equal(result.diagnostics.length, 0)
  })

  it('skips nested object headers with a warning', () => {
    const raw = { type: 'object', properties: { nested: { type: 'object', properties: { x: { type: 'string' } } } } }
    const result = extractHeaders(raw, ST, 'spec.yaml')
    assert.ok(result)
    assert.equal(Object.keys(result.headers).length, 0)
    assert.equal(result.diagnostics.filter(d => d.severity === 'warning').length, 1)
  })

  it('handles type: [string, null] nullable pattern', () => {
    const raw = { type: 'object', properties: { name: { type: ['string', 'null'] } } }
    const result = extractHeaders(raw, ST, 'spec.yaml')
    assert.ok(result)
    assert.equal((result.headers.name as any).type, 'string')
  })

  it('returns null for falsy input', () => {
    assert.equal(extractHeaders(null, ST, 'spec.yaml'), null)
    assert.equal(extractHeaders(undefined, ST, 'spec.yaml'), null)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```
npm run build 2>&1 | head -10
```
Expected: compile error — new exports not found

- [ ] **Step 3: Add functions to `src/adapters/asyncapi/mapper.ts`** (insert after `deriveNodeId`)

```typescript
export function countMessageSchemaUsage(document: AsyncAPIDocumentInterface): Map<string, number> {
  const rawDoc = document.json() as { components?: { schemas?: Record<string, unknown> } }
  const schemaNames = Object.keys(rawDoc.components?.schemas ?? {})
  const schemaToMessages = new Map<string, Set<string>>()

  for (const operation of document.allOperations()) {
    for (const message of operation.messages().all()) {
      const msgName = message.name() ?? message.id()
      if (!msgName) continue
      const msgJson = JSON.stringify((message as unknown as { json(): unknown }).json())
      for (const name of schemaNames) {
        if (msgJson.includes(`"#/components/schemas/${name}"`)) {
          if (!schemaToMessages.has(name)) schemaToMessages.set(name, new Set())
          schemaToMessages.get(name)!.add(msgName)
        }
      }
    }
  }

  const counts = new Map<string, number>()
  for (const [name, names] of schemaToMessages) counts.set(name, names.size)
  return counts
}

export function collectSharedSchemaNames(
  document: AsyncAPIDocumentInterface,
  counts: Map<string, number>,
): Set<string> {
  const rawDoc = document.json() as { components?: { schemas?: Record<string, unknown> } }
  const shared = new Set<string>()

  for (const [name, count] of counts) {
    if (count >= 2) shared.add(name)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [candidateName] of Object.entries(rawDoc.components?.schemas ?? {})) {
      if (shared.has(candidateName)) continue
      for (const sharedName of shared) {
        const sharedSchema = rawDoc.components?.schemas?.[sharedName]
        if (JSON.stringify(sharedSchema).includes(`"#/components/schemas/${candidateName}"`)) {
          shared.add(candidateName)
          changed = true
          break
        }
      }
    }
  }
  return shared
}

export function extractHeaders(
  rawHeaders: unknown,
  scalarTypes: Record<string, string>,
  specPath: string,
): { headers: Record<string, unknown>; diagnostics: Diagnostic[] } | null {
  if (!rawHeaders || typeof rawHeaders !== 'object') return null
  const h = rawHeaders as { type?: string; properties?: Record<string, unknown>; required?: string[] }
  if (!h.properties || Object.keys(h.properties).length === 0) return null

  const headers: Record<string, unknown> = {}
  const diagnostics: Diagnostic[] = []

  for (const [name, rawDef] of Object.entries(h.properties)) {
    const def = rawDef as { type?: string | string[]; format?: string; description?: string }
    const rawType = Array.isArray(def.type) ? (def.type.find(t => t !== 'null') ?? 'string') : (def.type ?? 'string')

    if (rawType === 'object') {
      diagnostics.push({ severity: 'warning', file: specPath, message: `Header "${name}" is a nested object — skipping` })
      continue
    }

    const scalarType = deriveScalarType(rawType, def.format, scalarTypes) ?? 'string'
    const required = Array.isArray(h.required) && h.required.includes(name)
    const entry: Record<string, unknown> = { type: scalarType, required }
    if (def.description) entry.description = def.description
    headers[name] = entry
  }

  return { headers, diagnostics }
}
```

- [ ] **Step 4: Build and run tests**

```
npm test
```
Expected: all new tests pass

- [ ] **Step 5: Commit**

```bash
git add src/adapters/asyncapi/mapper.ts test/adapters/asyncapi/mapper.test.ts
git commit -m "feat: schema counting and extractHeaders for AsyncAPI mapper"
```

---

### Task 7: `mapDocument`, `AsyncAPIAdapter`, registration, and first integration test

**Files:**
- Modify: `src/adapters/asyncapi/mapper.ts` (replace placeholder `mapDocument`)
- Create: `src/adapters/asyncapi/index.ts`
- Modify: `src/adapters/index.ts`
- Create: `test/fixtures/asyncapi/specs/simple-events.yaml`
- Create: `test/fixtures/asyncapi/expected/simple-events/components/orders/IntegrationEvents/order-placed.yaml`
- Create: `test/import/asyncapi-runner.test.ts`

**Interfaces:**
- Consumes: all functions from Tasks 4–6
- Produces: `AsyncAPIAdapter` registered in the global adapter registry; end-to-end import pipeline working

- [ ] **Step 1: Create simple fixture spec**

Create `test/fixtures/asyncapi/specs/simple-events.yaml`:

```yaml
asyncapi: 3.0.0
info:
  title: Simple Events
  version: 1.0.0
channels:
  orders.order-placed:
    address: orders.order-placed
    messages:
      event:
        name: OrderPlaced
        payload:
          type: object
          required:
            - orderId
          properties:
            orderId:
              type: string
              format: uuid
            notes:
              type: string
operations:
  order-placed:
    action: receive
    channel:
      $ref: '#/channels/orders.order-placed'
    messages:
      - $ref: '#/channels/orders.order-placed/messages/event'
```

- [ ] **Step 2: Create golden file**

Create `test/fixtures/asyncapi/expected/simple-events/components/orders/IntegrationEvents/order-placed.yaml`:

```yaml
id: orders.IntegrationEvent.order-placed
template: IntegrationEvent
schemaVersion: '1'
metadata:
  component: orders
  state: implemented
  stability: unstable
  lastModifiedAt: <date>
  extractedFrom: <spec>
  derivation: determined
  derivedBy: adapter:asyncapi
properties:
  topic: orders.order-placed
schemas:
  order-placed:
    fields:
      notes:
        type: string
        nullable: true
      orderId:
        type: uuid
        nullable: false
```

Note: fields are serialized in alphabetical order by node ID (see `getDirectOwnedChildren` in `graph-writer.ts` which sorts by `id.localeCompare`). Adjust key order after first run if needed.

- [ ] **Step 3: Write failing integration test**

Create `test/import/asyncapi-runner.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { ImportConfig } from '../../src/import/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specsDir = path.join(repoRoot, 'test/fixtures/asyncapi/specs')
const expectedBaseDir = path.join(repoRoot, 'test/fixtures/asyncapi/expected')

function makeRuntimeConfig(graphDir: string) {
  process.env.CORUM_GRAPH_PATH = graphDir
  return createGraphRuntimeConfig()
}

async function setupGraphDir() {
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-asyncapi-'))
  const graph = await loadGraph({ graphPath: fixtureGraphDir })
  await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
  return { graphDir, cleanup: () => fs.rmSync(graphDir, { recursive: true, force: true }) }
}

function normalizeYaml(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/lastModifiedAt: .+/g, 'lastModifiedAt: <date>')
    .replace(/extractedFrom: .+/g, 'extractedFrom: <spec>')
}

function assertMatchesExpected(graphDir: string, goldenSubdir: string): void {
  const goldenDir = path.join(expectedBaseDir, goldenSubdir)
  function readYamlFiles(baseDir: string): Map<string, string> {
    const map = new Map<string, string>()
    if (!fs.existsSync(baseDir)) return map
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.yaml')) {
          const key = path.relative(baseDir, full).split(path.sep).join('/')
          map.set(key, fs.readFileSync(full, 'utf-8'))
        }
      }
    }
    walk(baseDir)
    return map
  }
  const golden = readYamlFiles(goldenDir)
  assert.ok(golden.size > 0, `golden dir ${goldenSubdir} should contain at least one file`)
  for (const [key, expected] of golden) {
    const actualPath = path.join(graphDir, key)
    assert.ok(fs.existsSync(actualPath), `expected ${key} to exist in graph output`)
    assert.equal(
      normalizeYaml(fs.readFileSync(actualPath, 'utf-8')),
      normalizeYaml(expected),
      `${key} should match golden file`,
    )
  }
}

describe('asyncapi import runner — simple-events.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'simple-events.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        }],
      }
      await runImport(config, makeRuntimeConfig(graphDir))
      assertMatchesExpected(graphDir, 'simple-events')
    } finally {
      cleanup()
    }
  })

  it('is idempotent — second import produces no new nodes', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'simple-events.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        }],
      }
      const runtimeConfig = makeRuntimeConfig(graphDir)
      await runImport(config, runtimeConfig)
      const before = await loadGraph({ graphPath: graphDir })
      const beforeCount = before.nodesById.size
      await runImport(config, runtimeConfig)
      const after = await loadGraph({ graphPath: graphDir })
      assert.equal(after.nodesById.size, beforeCount)
    } finally {
      cleanup()
    }
  })
})
```

- [ ] **Step 4: Run to verify failure**

```
npm run build 2>&1 | head -10
```
Expected: runtime error — `AsyncAPIAdapter` not registered, import fails

- [ ] **Step 5: Replace placeholder `mapDocument` in `src/adapters/asyncapi/mapper.ts`**

Replace the stub:

```typescript
export function mapDocument(
  document: AsyncAPIDocumentInterface,
  entry: AsyncAPIImportEntry,
  packConfig: AdapterPackConfig,
): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const sharedSchemas = new Map<string, string>()   // componentSchemaName → node ID
  const sourceSchemas = new Map<string, unknown>()   // componentSchemaName → raw schema JSON

  const rawDoc = document.json() as { components?: { schemas?: Record<string, unknown> } }

  for (const [name, schema] of Object.entries(rawDoc.components?.schemas ?? {})) {
    sourceSchemas.set(name, schema)
  }

  // Pre-pass: count unique message-name usages → determine shared schemas
  const schemaCounts = countMessageSchemaUsage(document)
  const sharedSchemaNames = collectSharedSchemaNames(document, schemaCounts)

  // Pre-pass: for each shared/enum schema, determine which component owns it
  // by inspecting which messages reference it, then derive component from those messages
  const schemaComponents = new Map<string, string>()
  for (const operation of document.allOperations()) {
    for (const message of operation.messages().all()) {
      const component = extractValue(entry.componentMapping, operation, message)
      if (!component) continue
      const msgName = message.name() ?? message.id()
      if (!msgName) continue
      const msgJson = JSON.stringify((message as unknown as { json(): unknown }).json())
      for (const schemaName of sharedSchemaNames) {
        if (msgJson.includes(`"#/components/schemas/${schemaName}"`)) {
          const existing = schemaComponents.get(schemaName)
          if (!existing) {
            schemaComponents.set(schemaName, component)
          } else if (existing !== component) {
            schemaComponents.set(schemaName, 'shared')
          }
        }
      }
    }
  }

  // Register shared schema and enum IDs upfront (same pattern as OpenAPI mapper)
  for (const [name, schema] of Object.entries(rawDoc.components?.schemas ?? {})) {
    const s = schema as { type?: string; enum?: unknown[] }
    const component = schemaComponents.get(name) ?? 'shared'
    if (s.enum) {
      sharedSchemas.set(name, `${component}.EnumDefinition.${name}`)
    } else if (sharedSchemaNames.has(name)) {
      sharedSchemas.set(name, `${component}.Schema.${name}`)
    }
  }

  // Emit standalone EnumDefinition nodes and shared Schema nodes
  for (const [name, schema] of Object.entries(rawDoc.components?.schemas ?? {})) {
    const s = schema as { type?: string; enum?: unknown[]; properties?: Record<string, unknown>; required?: string[] }
    const enumId = sharedSchemas.get(name)
    if (!enumId) continue

    if (s.enum) {
      const [component] = enumId.split('.')
      nodes.push(makeNode(packConfig.constructs.enumDefinition?.template ?? 'EnumDefinition', component, entry.spec, enumId))
      for (const value of s.enum) {
        const valueId = deriveNodeId('enumValue', component, String(value), { parentId: enumId, section: 'values' })
        const valueNode = makeNode(packConfig.constructs.enumValue?.template ?? 'EnumValue', component, entry.spec, valueId)
        valueNode.properties = { name: String(value) }
        nodes.push(valueNode)
        edges.push({ id: `${enumId}__has-value__${valueId}`, from: enumId, to: valueId, type: 'has-value', state: 'implemented', stability: 'unstable' })
      }
      continue
    }

    if (!sharedSchemaNames.has(name)) continue
    const [component] = enumId.split('.')
    nodes.push(makeNode(packConfig.constructs.payloadSchema?.template ?? 'Schema', component, entry.spec, enumId))
    emitFields(s, enumId, 'fields', undefined, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
  }

  // Process all operations; deduplicate messages by derived name
  const seenMessages = new Map<string, string>()  // messageName → first channel address

  for (const operation of document.allOperations()) {
    const channelAddress = operation.channels().all()[0]?.address() ?? ''

    for (const message of operation.messages().all()) {
      const component = extractValue(entry.componentMapping, operation, message)
      if (!component) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for message on channel "${channelAddress}" — skipping` })
        continue
      }

      const namingCtx = entry.messageNaming ? { strategy: entry.messageNaming, operation } : undefined
      const nameResult = deriveMessageName(message, namingCtx, entry.spec)

      if (!nameResult) {
        const hasId = message.id() && !message.id().startsWith('<anonymous')
        diagnostics.push({
          severity: hasId ? 'warning' : 'error',
          file: entry.spec,
          message: hasId
            ? `Cannot derive name for message on channel "${channelAddress}" — skipping. Set message.name or configure messageNaming.`
            : `Anonymous message on channel "${channelAddress}" — skipping (no name or id)`,
        })
        continue
      }

      const messageName = nameResult.name

      // Deduplication: same name = same Event node
      if (seenMessages.has(messageName)) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `[INFO] Message "${messageName}" also on channel "${channelAddress}" — using first channel "${seenMessages.get(messageName)}"` })
        continue
      }
      seenMessages.set(messageName, channelAddress)

      const eventTemplate = classifyEvent(entry.eventClassification, operation, message)
      const eventId = deriveNodeId('event', component, messageName, { template: eventTemplate })
      const eventNode = makeNode(eventTemplate, component, entry.spec, eventId)

      const msgRaw = (message as unknown as { json(): Record<string, unknown> }).json()
      const properties: Record<string, unknown> = { topic: channelAddress }
      if (msgRaw.description) properties.description = String(msgRaw.description)

      if (message.hasHeaders()) {
        const rawHeaders = msgRaw.headers ?? null
        const headerResult = extractHeaders(rawHeaders, packConfig.scalarTypes, entry.spec)
        if (headerResult) {
          diagnostics.push(...headerResult.diagnostics)
          if (Object.keys(headerResult.headers).length > 0) properties.headers = headerResult.headers
        }
      }

      eventNode.properties = properties
      nodes.push(eventNode)

      // Process payload
      const rawPayload = msgRaw.payload as Record<string, unknown> | undefined
      if (!rawPayload) continue

      const payloadStr = JSON.stringify(rawPayload)
      const refMatch = payloadStr.match(/"#\/components\/schemas\/([^"]+)"/)
      const payloadSchemaName = refMatch?.[1]

      if (payloadSchemaName) {
        const globalId = sharedSchemas.get(payloadSchemaName)
        if (globalId) {
          emitReadsEdge(eventId, globalId, edges)
        } else {
          const sourceSchema = sourceSchemas.get(payloadSchemaName) as { properties?: Record<string, unknown>; required?: string[] } | undefined
          if (sourceSchema) {
            const schemaKey = toKebabCase(payloadSchemaName)
            const schemaId = deriveNodeId('schema', component, schemaKey, { parentId: eventId, section: 'schemas' })
            nodes.push(makeNode(packConfig.constructs.payloadSchema?.template ?? 'Schema', component, entry.spec, schemaId))
            edges.push({ id: `${eventId}__has-field__${schemaId}`, from: eventId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
            emitFields(sourceSchema, schemaId, 'fields', eventId, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
          }
        }
      } else if (rawPayload.type === 'object' && rawPayload.properties) {
        const schemaId = deriveNodeId('schema', component, messageName, { parentId: eventId, section: 'schemas' })
        nodes.push(makeNode(packConfig.constructs.payloadSchema?.template ?? 'Schema', component, entry.spec, schemaId))
        edges.push({ id: `${eventId}__has-field__${schemaId}`, from: eventId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
        emitFields(rawPayload as { properties?: Record<string, unknown>; required?: string[] }, schemaId, 'fields', eventId, packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, new Map())
      } else {
        const primitiveType = Array.isArray(rawPayload.type) ? rawPayload.type.find(t => t !== 'null') : rawPayload.type
        if (primitiveType && primitiveType !== 'object') {
          diagnostics.push({ severity: 'warning', file: entry.spec, message: `Message "${messageName}" has scalar payload (type: ${primitiveType}) — Event created with no schemas section` })
        }
      }
    }
  }

  return { nodes, edges, diagnostics }
}

function makeNode(template: string, component: string, specPath: string, id: string): Node {
  return {
    id, template, component,
    state: 'implemented', stability: 'unstable', schemaVersion: '1',
    lastModifiedAt: new Date().toISOString().split('T')[0],
    extractedFrom: specPath,
    derivation: 'determined',
    derivedBy: 'adapter:asyncapi',
    properties: {},
  }
}

function emitReadsEdge(from: string, to: string, edges: Edge[]): void {
  const id = `${from}__reads__${to}`
  if (!edges.some(e => e.id === id)) {
    edges.push({ id, from, to, type: 'reads', state: 'implemented', stability: 'unstable' })
  }
}

function refName(ref: string): string {
  return ref.split('/').pop() ?? ref
}

function isRefSchema(schema: unknown): schema is { $ref: string } {
  return typeof schema === 'object' && schema !== null && '$ref' in schema
}

function resolveAllOfRef(schema: unknown): unknown {
  if (isRefSchema(schema)) return schema
  const s = schema as { allOf?: unknown[] }
  if (Array.isArray(s.allOf) && s.allOf.length === 1 && isRefSchema(s.allOf[0])) return s.allOf[0]
  return schema
}

function emitFields(
  schema: { properties?: Record<string, unknown>; required?: string[] },
  parentId: string,
  section: string,
  rootId: string | undefined,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
  sourceSchemas: Map<string, unknown>,
  localSchemas: Map<string, string>,
): void {
  const readsSource = rootId ?? parentId
  const [component] = parentId.split('.')

  for (const [fieldName, rawFieldSchema] of Object.entries(schema.properties ?? {})) {
    const fieldSchema = resolveAllOfRef(rawFieldSchema)
    const fieldId = deriveNodeId('field', component, fieldName, { parentId, section })
    const fieldNode = makeNode(packConfig.constructs.payloadField?.template ?? 'Field', component, specPath, fieldId)
    const required = Array.isArray(schema.required) && schema.required.includes(fieldName)

    if (isRefSchema(fieldSchema)) {
      const schemaName = refName((fieldSchema as { $ref: string }).$ref)
      const globalId = sharedSchemas.get(schemaName)
      if (globalId) {
        emitReadsEdge(readsSource, globalId, edges)
        fieldNode.properties = { $ref: globalId, nullable: !required }
      } else if (localSchemas.has(schemaName)) {
        fieldNode.properties = { $ref: localSchemas.get(schemaName)!, nullable: !required }
      } else if (rootId) {
        const src = sourceSchemas.get(schemaName) as { properties?: Record<string, unknown>; required?: string[] } | undefined
        if (src) {
          const inlineId = deriveNodeId('schema', component, schemaName, { parentId: rootId, section: 'schemas' })
          if (!nodes.some(n => n.id === inlineId)) {
            nodes.push(makeNode(packConfig.constructs.payloadSchema?.template ?? 'Schema', component, specPath, inlineId))
            edges.push({ id: `${rootId}__has-field__${inlineId}`, from: rootId, to: inlineId, type: 'has-field', state: 'implemented', stability: 'unstable' })
            const localRef = `#/schemas/${schemaName}`
            localSchemas.set(schemaName, localRef)
            emitFields(src, inlineId, 'fields', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
          }
          fieldNode.properties = { $ref: localSchemas.get(schemaName) ?? `#/schemas/${schemaName}`, nullable: !required }
        } else {
          fieldNode.properties = { $ref: schemaName, nullable: !required }
        }
      } else {
        fieldNode.properties = { $ref: schemaName, nullable: !required }
      }
    } else {
      const fs = fieldSchema as { type?: string | string[]; format?: string; enum?: unknown[]; items?: unknown; properties?: Record<string, unknown>; additionalProperties?: unknown }
      const rawType = Array.isArray(fs.type) ? (fs.type.find(t => t !== 'null') ?? 'string') : (fs.type ?? 'string')
      const isNullableArray = Array.isArray(fs.type) && fs.type.includes('null')
      const nullable = !required || isNullableArray

      if (fs.enum) {
        const enumRef = sharedSchemas.get(fieldName)
        fieldNode.properties = enumRef ? { $ref: enumRef, nullable } : { type: 'string', nullable }
        if (!enumRef) diagnostics.push({ severity: 'warning', file: specPath, message: `Inline enum for field "${fieldId}" — treating as string` })
      } else if (rawType === 'array') {
        const items = fs.items ? resolveAllOfRef(fs.items) : undefined
        if (!items) {
          fieldNode.properties = { type: 'string', nullable, collection: 'array' }
        } else if (isRefSchema(items)) {
          const sn = refName((items as { $ref: string }).$ref)
          const gId = sharedSchemas.get(sn)
          if (gId) {
            emitReadsEdge(readsSource, gId, edges)
            fieldNode.properties = { $ref: gId, nullable, collection: 'array' }
          } else if (localSchemas.has(sn)) {
            fieldNode.properties = { $ref: localSchemas.get(sn)!, nullable, collection: 'array' }
          } else if (rootId) {
            const src = sourceSchemas.get(sn) as { properties?: Record<string, unknown>; required?: string[] } | undefined
            if (src) {
              const inlineId = deriveNodeId('schema', component, sn, { parentId: rootId, section: 'schemas' })
              if (!nodes.some(n => n.id === inlineId)) {
                nodes.push(makeNode(packConfig.constructs.payloadSchema?.template ?? 'Schema', component, specPath, inlineId))
                edges.push({ id: `${rootId}__has-field__${inlineId}`, from: rootId, to: inlineId, type: 'has-field', state: 'implemented', stability: 'unstable' })
                const localRef = `#/schemas/${sn}`
                localSchemas.set(sn, localRef)
                emitFields(src, inlineId, 'fields', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
              }
              fieldNode.properties = { $ref: localSchemas.get(sn) ?? `#/schemas/${sn}`, nullable, collection: 'array' }
            } else {
              fieldNode.properties = { type: 'string', nullable, collection: 'array' }
            }
          } else {
            fieldNode.properties = { type: 'string', nullable, collection: 'array' }
          }
        } else {
          const it = items as { type?: string; format?: string }
          fieldNode.properties = { type: deriveScalarType(it.type ?? 'string', it.format, packConfig.scalarTypes) ?? 'string', nullable, collection: 'array' }
        }
      } else if (rawType === 'object' && fs.properties) {
        if (rootId) {
          const inlineId = deriveNodeId('schema', component, fieldName, { parentId: rootId, section: 'schemas' })
          if (!nodes.some(n => n.id === inlineId)) {
            nodes.push(makeNode(packConfig.constructs.payloadSchema?.template ?? 'Schema', component, specPath, inlineId))
            edges.push({ id: `${rootId}__has-field__${inlineId}`, from: rootId, to: inlineId, type: 'has-field', state: 'implemented', stability: 'unstable' })
            const localRef = `#/schemas/${fieldName}`
            localSchemas.set(fieldName, localRef)
            emitFields(fs as { properties?: Record<string, unknown>; required?: string[] }, inlineId, 'fields', rootId, packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas)
          }
          fieldNode.properties = { $ref: localSchemas.get(fieldName) ?? `#/schemas/${fieldName}`, nullable }
        } else {
          diagnostics.push({ severity: 'warning', file: specPath, message: `Inline object field "${fieldId}" has no event context — treating as string` })
          fieldNode.properties = { type: 'string', nullable }
        }
      } else {
        const scalarType = deriveScalarType(rawType, fs.format, packConfig.scalarTypes)
        if (scalarType) {
          fieldNode.properties = { type: scalarType, nullable }
        } else {
          diagnostics.push({ severity: 'warning', file: specPath, message: `Unknown type for field "${fieldId}": ${rawType}/${fs.format} — defaulting to string` })
          fieldNode.properties = { type: 'string', nullable }
        }
      }
    }

    nodes.push(fieldNode)
    edges.push({ id: `${parentId}__has-field__${fieldId}`, from: parentId, to: fieldId, type: 'has-field', state: 'implemented', stability: 'unstable' })
  }
}
```

- [ ] **Step 6: Create `src/adapters/asyncapi/index.ts`**

```typescript
import type { AsyncAPIImportEntry } from '../../import/config.js'
import type { AdapterContext, AdapterResult, SpecAdapter } from '../index.js'
import { parseSpec } from './parser.js'
import { mapDocument } from './mapper.js'

export class AsyncAPIAdapter implements SpecAdapter<AsyncAPIImportEntry> {
  readonly adapterId = 'asyncapi' as const

  async import(entry: AsyncAPIImportEntry, context: AdapterContext): Promise<AdapterResult> {
    const { document, diagnostics } = await parseSpec(entry.spec)
    if (!document) return { nodes: [], edges: [], diagnostics }
    const { nodes, edges, diagnostics: mapDiagnostics } = mapDocument(document, entry, context.packConfig)
    return { nodes, edges, diagnostics: [...diagnostics, ...mapDiagnostics] }
  }
}
```

- [ ] **Step 7: Register `AsyncAPIAdapter` in `src/adapters/index.ts`**

Add after the last line of the file:

```typescript
import { AsyncAPIAdapter } from './asyncapi/index.js'
registerAdapter(new AsyncAPIAdapter())
```

- [ ] **Step 8: Build and run tests**

```
npm test
```
Expected: simple-events golden file test passes; idempotency test passes; all prior tests still pass

If the golden file field order doesn't match, run the import once, capture the actual output YAML, compare to the expected, and update the golden file field order to match what the writer produces. Fields are sorted alphabetically by node ID.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/asyncapi/ src/adapters/index.ts test/fixtures/asyncapi/ test/import/asyncapi-runner.test.ts
git commit -m "feat: AsyncAPIAdapter end-to-end — mapDocument, index, registration, simple-events integration test"
```

---

### Task 8: Remaining golden file fixtures

**Files:**
- Create: `test/fixtures/asyncapi/specs/mixed-events.yaml`
- Create: `test/fixtures/asyncapi/specs/with-enums.yaml`
- Create: `test/fixtures/asyncapi/specs/shared-payload.yaml`
- Create: `test/fixtures/asyncapi/specs/with-headers.yaml`
- Create: `test/fixtures/asyncapi/specs/message-naming.yaml`
- Create: corresponding `test/fixtures/asyncapi/expected/*/` golden files
- Modify: `test/import/asyncapi-runner.test.ts`

**Interfaces:**
- Consumes: `AsyncAPIAdapter` from Task 7
- Produces: test coverage for classification, enums, shared schemas, headers, message naming, parser normalisation

- [ ] **Step 1: Create `test/fixtures/asyncapi/specs/mixed-events.yaml`**

```yaml
asyncapi: 3.0.0
info:
  title: Mixed Events
  version: 1.0.0
channels:
  orders.order-placed:
    address: orders.order-placed
    messages:
      event:
        name: OrderPlaced
        tags:
          - name: integration
        payload:
          type: object
          required: [orderId]
          properties:
            orderId:
              type: string
              format: uuid
  orders.order-created:
    address: orders.order-created
    messages:
      event:
        name: OrderCreated
        tags:
          - name: domain
        payload:
          type: object
          required: [orderId]
          properties:
            orderId:
              type: string
              format: uuid
operations:
  order-placed:
    action: receive
    channel:
      $ref: '#/channels/orders.order-placed'
    messages:
      - $ref: '#/channels/orders.order-placed/messages/event'
  order-created:
    action: receive
    channel:
      $ref: '#/channels/orders.order-created'
    messages:
      - $ref: '#/channels/orders.order-created/messages/event'
```

- [ ] **Step 2: Create mixed-events golden files**

`test/fixtures/asyncapi/expected/mixed-events/components/orders/IntegrationEvents/order-placed.yaml`:
```yaml
id: orders.IntegrationEvent.order-placed
template: IntegrationEvent
schemaVersion: '1'
metadata:
  component: orders
  state: implemented
  stability: unstable
  lastModifiedAt: <date>
  extractedFrom: <spec>
  derivation: determined
  derivedBy: adapter:asyncapi
properties:
  topic: orders.order-placed
schemas:
  order-placed:
    fields:
      orderId:
        type: uuid
        nullable: false
```

`test/fixtures/asyncapi/expected/mixed-events/components/orders/DomainEvents/order-created.yaml`:
```yaml
id: orders.DomainEvent.order-created
template: DomainEvent
schemaVersion: '1'
metadata:
  component: orders
  state: implemented
  stability: unstable
  lastModifiedAt: <date>
  extractedFrom: <spec>
  derivation: determined
  derivedBy: adapter:asyncapi
properties:
  topic: orders.order-created
schemas:
  order-created:
    fields:
      orderId:
        type: uuid
        nullable: false
```

- [ ] **Step 3: Create `test/fixtures/asyncapi/specs/with-enums.yaml`**

```yaml
asyncapi: 3.0.0
info:
  title: With Enums
  version: 1.0.0
channels:
  orders.order-placed:
    address: orders.order-placed
    messages:
      event:
        name: OrderPlaced
        payload:
          type: object
          required: [orderId, status]
          properties:
            orderId:
              type: string
              format: uuid
            status:
              $ref: '#/components/schemas/OrderStatus'
operations:
  order-placed:
    action: receive
    channel:
      $ref: '#/channels/orders.order-placed'
    messages:
      - $ref: '#/channels/orders.order-placed/messages/event'
components:
  schemas:
    OrderStatus:
      type: string
      enum: [pending, confirmed, cancelled]
```

Create golden files:
- `components/orders/IntegrationEvents/order-placed.yaml` — `status: { $ref: orders.EnumDefinition.OrderStatus, nullable: false }`
- `components/orders/EnumDefinitions/OrderStatus.yaml` — standalone enum with values pending, confirmed, cancelled

- [ ] **Step 4: Create `test/fixtures/asyncapi/specs/shared-payload.yaml`**

```yaml
asyncapi: 3.0.0
info:
  title: Shared Payload
  version: 1.0.0
channels:
  orders.order-placed:
    address: orders.order-placed
    messages:
      event:
        name: OrderPlaced
        payload:
          $ref: '#/components/schemas/OrderPayload'
  orders.order-confirmed:
    address: orders.order-confirmed
    messages:
      event:
        name: OrderConfirmed
        payload:
          $ref: '#/components/schemas/OrderPayload'
operations:
  order-placed:
    action: receive
    channel:
      $ref: '#/channels/orders.order-placed'
    messages:
      - $ref: '#/channels/orders.order-placed/messages/event'
  order-confirmed:
    action: receive
    channel:
      $ref: '#/channels/orders.order-confirmed'
    messages:
      - $ref: '#/channels/orders.order-confirmed/messages/event'
components:
  schemas:
    OrderPayload:
      type: object
      required: [orderId]
      properties:
        orderId:
          type: string
          format: uuid
```

Create golden files:
- `components/orders/IntegrationEvents/order-placed.yaml` — no `schemas:` section, `properties:` only
- `components/orders/IntegrationEvents/order-confirmed.yaml` — same as above
- `components/orders/Schemas/OrderPayload.yaml` — standalone shared Schema

- [ ] **Step 5: Create `test/fixtures/asyncapi/specs/with-headers.yaml`**

```yaml
asyncapi: 3.0.0
info:
  title: With Headers
  version: 1.0.0
channels:
  orders.order-placed:
    address: orders.order-placed
    messages:
      event:
        name: OrderPlaced
        headers:
          type: object
          required: [correlationId]
          properties:
            correlationId:
              type: string
              format: uuid
            retryCount:
              type: integer
        payload:
          type: object
          required: [orderId]
          properties:
            orderId:
              type: string
              format: uuid
operations:
  order-placed:
    action: receive
    channel:
      $ref: '#/channels/orders.order-placed'
    messages:
      - $ref: '#/channels/orders.order-placed/messages/event'
```

Golden file: `properties.headers: { correlationId: { type: uuid, required: true }, retryCount: { type: integer, required: false } }`

- [ ] **Step 6: Create `test/fixtures/asyncapi/specs/message-naming.yaml`**

```yaml
asyncapi: 3.0.0
info:
  title: Message Naming
  version: 1.0.0
channels:
  payments.payment-captured:
    address: payments.payment-captured
    messages:
      event:
        name: PaymentCaptured.v2
        payload:
          type: object
          required: [paymentId]
          properties:
            paymentId:
              type: string
              format: uuid
operations:
  payment-captured:
    action: receive
    channel:
      $ref: '#/channels/payments.payment-captured'
    messages:
      - $ref: '#/channels/payments.payment-captured/messages/event'
```

Config uses `messageNaming: { strategy: 'name-segment', separator: '.', segment: 0 }` → strips `.v2` → node ID `payments.IntegrationEvent.payment-captured`.

- [ ] **Step 7: Add all fixture test blocks to `test/import/asyncapi-runner.test.ts`**

Add after the existing `simple-events` describe block:

```typescript
describe('asyncapi import runner — mixed-events.yaml (tag-based classification)', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'mixed-events.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
          eventClassification: { from: { strategy: 'tag' }, domainValue: 'domain' },
        }],
      }
      await runImport(config, makeRuntimeConfig(graphDir))
      assertMatchesExpected(graphDir, 'mixed-events')
    } finally { cleanup() }
  })
})

describe('asyncapi import runner — with-enums.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'with-enums.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        }],
      }
      await runImport(config, makeRuntimeConfig(graphDir))
      assertMatchesExpected(graphDir, 'with-enums')
    } finally { cleanup() }
  })
})

describe('asyncapi import runner — shared-payload.yaml', () => {
  it('shared schema promoted and both events get reads edges', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'shared-payload.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        }],
      }
      await runImport(config, makeRuntimeConfig(graphDir))
      const graph = await loadGraph({ graphPath: graphDir })
      assert.ok(graph.nodesById.has('orders.Schema.OrderPayload'), 'shared schema node should exist')
      assertMatchesExpected(graphDir, 'shared-payload')
    } finally { cleanup() }
  })
})

describe('asyncapi import runner — with-headers.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'with-headers.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
        }],
      }
      await runImport(config, makeRuntimeConfig(graphDir))
      assertMatchesExpected(graphDir, 'with-headers')
    } finally { cleanup() }
  })
})

describe('asyncapi import runner — message-naming.yaml', () => {
  it('strips version suffix from message name', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'asyncapi',
          spec: path.join(specsDir, 'message-naming.yaml'),
          componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
          messageNaming: { strategy: 'name-segment', separator: '.', segment: 0 },
        }],
      }
      await runImport(config, makeRuntimeConfig(graphDir))
      const graph = await loadGraph({ graphPath: graphDir })
      assert.ok(graph.nodesById.has('payments.IntegrationEvent.payment-captured'), 'versioned suffix stripped')
    } finally { cleanup() }
  })
})

describe('asyncapi import runner — petstore v3 vs v2 normalisation', () => {
  it('v3 and v2 produce identical Event node IDs', async () => {
    const mapping = { strategy: 'channel-segment' as const, separator: '.', segment: 0 }
    const { graphDir: v3Dir, cleanup: cleanV3 } = await setupGraphDir()
    const { graphDir: v2Dir, cleanup: cleanV2 } = await setupGraphDir()
    try {
      await runImport({ imports: [{ adapter: 'asyncapi', spec: path.join(specsDir, 'petstore-v3.yaml'), componentMapping: mapping }] }, makeRuntimeConfig(v3Dir))
      await runImport({ imports: [{ adapter: 'asyncapi', spec: path.join(specsDir, 'petstore-v2.yaml'), componentMapping: mapping }] }, makeRuntimeConfig(v2Dir))
      const v3Ids = [...(await loadGraph({ graphPath: v3Dir })).nodesById.keys()].filter(id => /\.(IntegrationEvent|DomainEvent)\./.test(id)).sort()
      const v2Ids = [...(await loadGraph({ graphPath: v2Dir })).nodesById.keys()].filter(id => /\.(IntegrationEvent|DomainEvent)\./.test(id)).sort()
      assert.deepEqual(v3Ids, v2Ids)
    } finally { cleanV3(); cleanV2() }
  })
})
```

- [ ] **Step 8: Build and create golden files from actual output**

For each new fixture, run the import once and capture output to create accurate golden files if the hand-written ones need adjustment:

```bash
npm run build
node -e "
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { loadGraph } from './dist/src/loader/index.js'
import { saveGraph } from './dist/src/writer/graph-writer.js'
import { runImport } from './dist/src/import/runner.js'
import { createGraphRuntimeConfig } from './dist/src/source/config.js'
const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-verify-'))
process.env.CORUM_GRAPH_PATH = graphDir
const runtimeConfig = createGraphRuntimeConfig()
const graph = await loadGraph({ graphPath: 'fixtures/sample-graph' })
await saveGraph(graph, { sourceGraphPath: 'fixtures/sample-graph', outputGraphPath: graphDir })
await runImport({ imports: [{ adapter: 'asyncapi', spec: 'test/fixtures/asyncapi/specs/with-enums.yaml', componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 } }] }, runtimeConfig)
console.log(fs.readFileSync(path.join(graphDir, 'components/orders/IntegrationEvents/order-placed.yaml'), 'utf-8'))
fs.rmSync(graphDir, { recursive: true, force: true })
" --input-type=module
```

Update golden files to match actual output if needed.

- [ ] **Step 9: Run full test suite**

```
npm test
```
Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
git add test/fixtures/asyncapi/ test/import/asyncapi-runner.test.ts
git commit -m "test: AsyncAPI golden file fixtures — mixed-events, with-enums, shared-payload, with-headers, message-naming, petstore normalisation"
```

---

### Task 9: CLI subcommand

**Files:**
- Modify: `src/bin/corum.ts`

**Interfaces:**
- Consumes: `buildAsyncAPIConfig` from `src/import/config.ts` (Task 1)
- Produces: `corum import asyncapi <spec>` subcommand with full strategy flags

- [ ] **Step 1: Update import statement in `src/bin/corum.ts`**

Change:
```typescript
import { buildOpenAPIConfig, loadImportConfig } from '../import/config.js'
```
To:
```typescript
import { buildOpenAPIConfig, buildAsyncAPIConfig, loadImportConfig } from '../import/config.js'
```

- [ ] **Step 2: Add the `asyncapi` subcommand after the existing `openapi` subcommand block**

Insert after the closing `.action(...)` of `importCmd.command('openapi')`:

```typescript
importCmd
  .command('asyncapi <spec>')
  .description('Import an AsyncAPI spec into the graph')
  .option('--component-strategy <strategy>', 'Component mapping: channel-segment, channel-pattern, name-segment, name-pattern, tag, hardcoded', 'channel-segment')
  .option('--separator <char>', 'Separator character for segment strategies')
  .option('--segment <n>', 'Segment index (0-based; negative counts from end)', parseInt)
  .option('--pattern <regex>', 'Regex pattern for pattern strategies')
  .option('--component <name>', 'Fixed component name for hardcoded strategy')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (spec: string, opts) => {
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const entry = buildAsyncAPIConfig(spec, opts.componentStrategy, {
        separator: opts.separator,
        segment: opts.segment,
        pattern: opts.pattern,
        value: opts.component,
      })
      const result = await runImport({ imports: [entry] }, runtimeConfig)
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })
```

- [ ] **Step 3: Build and verify CLI help**

```bash
npm run build
node dist/src/bin/corum.js import asyncapi --help
```

Expected output includes: `--component-strategy`, `--separator`, `--segment`, `--pattern`, `--component`

- [ ] **Step 4: Run full test suite**

```
npm test
```
Expected: all tests pass (loader fixture: 45 nodes, 38 edges; all new AsyncAPI tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/bin/corum.ts
git commit -m "feat: corum import asyncapi CLI subcommand"
```

---

### Task 10: Code review — alignment with OpenAPI adapter

**Files:**
- Review: `src/adapters/asyncapi/parser.ts` vs `src/adapters/openapi/parser.ts`
- Review: `src/adapters/asyncapi/mapper.ts` vs `src/adapters/openapi/mapper.ts`
- Review: `src/adapters/asyncapi/index.ts` vs `src/adapters/openapi/index.ts`
- Review: `src/import/config.ts` (both entry types)
- Review: `src/bin/corum.ts` (`import openapi` vs `import asyncapi` subcommands)
- Possibly modify: any of the above files to fix unjustified divergences

**Goal:** Methods that do conceptually similar things (parse a spec, emit fields, derive scalar types, build a node, collect diagnostics) should look similar. The test: a developer familiar with the OpenAPI adapter should not be surprised by the AsyncAPI adapter. Divergences are fine when the domain demands it; divergences because the same pattern wasn't noticed are not.

**Comparison checklist (execute each in turn):**

- [ ] **Step 1: Parser wrapper**

Read `src/adapters/openapi/parser.ts` and `src/adapters/asyncapi/parser.ts` in full. Compare:
- Return type: both should return `{ document, diagnostics }` with a nullable document
- Null-on-fatal-error guard: OpenAPI uses `SwaggerParser.bundle` inside a try/catch; AsyncAPI uses `parser.parse`. Both should return null document + error diagnostic rather than throwing
- Diagnostic mapping: check that the severity mapping (0→error, 1→warning) in the AsyncAPI parser matches the description in Global Constraints

List any divergence in a comment block below this step. Fix unjustified ones.

- [ ] **Step 2: `makeNode` signature and structure**

Read the `makeNode` helper in `src/adapters/asyncapi/mapper.ts` and compare with `makeNode` in `src/adapters/openapi/mapper.ts`. Check:
- Parameter order matches
- Required fields set identically: `state`, `stability`, `schemaVersion`, `derivation`, `derivedBy`, `lastModifiedAt`, `extractedFrom`
- Both use the same `extractedFrom` format (spec file path, not a URL)

List and fix divergences.

- [ ] **Step 3: `deriveScalarType` logic**

Compare `deriveScalarType` in both mappers. The OpenAPI version maps `string/date` → `date`, `string/date-time` → `datetime`, `string/uuid` → `uuid`, `integer` → `integer`, `number` → `decimal`, `boolean` → `boolean`, else → `string`. The AsyncAPI version should be identical in logic (different library types aside — both should ultimately look at `type` + `format` strings). If the mapping table differs in a way that isn't explained by a domain difference, align them.

- [ ] **Step 4: `emitFields` nullable handling**

Both mappers need to handle `type: [string, null]` (JSON Schema nullable). Read the relevant block in each and confirm the logic is equivalent — both should detect the array form, strip `null`, set `nullable: true`, and pass the remaining type string through `deriveScalarType`. If one does it differently, align them.

- [ ] **Step 5: `allOf` / `$ref` resolution**

The OpenAPI mapper has `resolveAllOfRef` to handle `allOf: [{ $ref }]` — a common pattern for nullable refs in OpenAPI 3.0. The AsyncAPI mapper may or may not need the same (AsyncAPI uses `$ref` directly at the message level). Check whether the AsyncAPI mapper handles the analogous pattern (direct `$ref` in payload properties). If the OpenAPI adapter has a helper that the AsyncAPI adapter replicates inline without extracting a named function, extract the function in the AsyncAPI mapper to match the style.

- [ ] **Step 6: Diagnostics collection pattern**

Both adapters accumulate diagnostics in a mutable array throughout `mapDocument`. Confirm both use the same pattern: a single `diagnostics: Diagnostic[]` array, pushed to locally, returned at the end. If one uses a different shape (e.g., throwing on first error, or returning nested arrays), align it.

- [ ] **Step 7: Adapter class structure**

Read `src/adapters/openapi/index.ts` and `src/adapters/asyncapi/index.ts`. Both should:
- Implement `SpecAdapter<XImportEntry>` with `readonly adapterId`
- Have an `async import(entry, context)` that calls the parser, short-circuits on null document, calls `mapDocument`, merges diagnostics, returns `{ nodes, edges, diagnostics }`
- Not contain business logic (parsing and mapping belong in the other two files)

Fix any structural divergences.

- [ ] **Step 8: CLI subcommand flags**

Read the `import openapi` and `import asyncapi` subcommands in `src/bin/corum.ts`. Check:
- Both use the same `yargs` chaining style
- Both call `runImport` the same way
- Both call `reportDiagnostics` and exit on error the same way
- Flag descriptions follow the same tense/capitalization convention

Align any cosmetic divergences.

- [ ] **Step 9: Run full test suite to confirm no regressions from alignment fixes**

```bash
npm test
```
Expected: all tests pass (loader fixture: 45 nodes, 38 edges; all AsyncAPI tests pass)

- [ ] **Step 10: Commit alignment fixes**

```bash
git add src/adapters/asyncapi/parser.ts src/adapters/asyncapi/mapper.ts src/adapters/asyncapi/index.ts src/bin/corum.ts
git commit -m "refactor: align asyncapi adapter structure with openapi adapter"
```

(Only include files that actually changed. If no changes were needed, skip this step and note that the implementations were already aligned.)
