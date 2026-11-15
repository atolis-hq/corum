# Corum Transport Importer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a `corum` import adapter that reads `*.corum.yaml` interchange files (produced by extraction tools like treesitter) and imports the contained nodes and edges into the corum graph.

**Architecture:** A new `extract` pack provides the adapter config stub and a formal interchange schema YAML. The adapter (`src/adapters/corum/`) follows the same parser → mapper → adapter-class structure as `openapi` and `asyncapi`. Because the interchange format is already corum-native (IDs, template names, and `$ref` values require no translation), the adapter ignores `context.packConfig` entirely and performs a direct reshape.

**Tech Stack:** TypeScript, `yaml` (already in deps), Node `fs` (readFileSync), Node test runner (`node:test`).

## Global Constraints

- Build command: `npm run build` (tsc → dist/). Tests: `npm test` or `node --test dist/test/<path>.js` for individual files.
- Use `node:test` and `node:assert/strict` — no Jest, no Vitest.
- Follow single-quote YAML stringify style (existing codebase pattern).
- No new npm dependencies.
- All imports use `.js` extension (ESM).
- State defaults: `state: 'implemented'`, `stability: 'unstable'` for all imported nodes/edges.
- `schemaVersion: '1'` on all imported nodes.
- Node `lastModifiedAt`: `new Date().toISOString().split('T')[0]` (YYYY-MM-DD).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `.corum/packs/extract/pack.yaml` | Pack manifest |
| Create | `.corum/packs/extract/adapters/corum.yaml` | Adapter config stub (satisfies runner requirement) |
| Create | `.corum/packs/extract/interchange.schema.yaml` | Formal envelope schema for extraction tools |
| Create | `src/adapters/corum/parser.ts` | YAML read + `CorumInterchangeDocument` interface + type guard |
| Create | `src/adapters/corum/mapper.ts` | Reshape parsed doc → `Node[]` + `Edge[]` |
| Create | `src/adapters/corum/index.ts` | `CorumAdapter` class |
| Modify | `src/adapters/index.ts` | Register `CorumAdapter` |
| Modify | `src/import/config.ts` | Add `CorumImportEntry`, add to `ImportEntry` union |
| Modify | `src/bin/corum.ts` | Add `corum import corum <spec>` subcommand |
| Modify | `README.md` | Document extract pack, import entry, CLI |
| Create | `test/adapters/corum/mapper.test.ts` | Unit tests for mapper |
| Create | `test/import/corum-runner.test.ts` | Integration test |
| Create | `test/fixtures/corum/specs/basic.corum.yaml` | Import fixture |
| Create | `test/fixtures/corum/expected/basic/components/orders/DomainEvents/OrderPlacedDomainEvent.yaml` | Golden cluster file |
| Create | `test/fixtures/corum/expected/basic/components/orders/DomainModels/OrderAggregate.yaml` | Golden cluster file |

---

### Task 1: Extract pack YAML files

**Files:**
- Create: `.corum/packs/extract/pack.yaml`
- Create: `.corum/packs/extract/adapters/corum.yaml`
- Create: `.corum/packs/extract/interchange.schema.yaml`

**Interfaces:**
- Produces: nothing consumed by code — static files read by the runner's pack config loader

- [ ] **Step 1: Create pack.yaml**

`.corum/packs/extract/pack.yaml`:
```yaml
name: extract
version: '1.0.0'
description: >-
  Corum extraction tooling support. Provides the interchange format schema
  and import adapter for corum-extract tools (treesitter, etc.).
```

- [ ] **Step 2: Create adapters/corum.yaml**

`.corum/packs/extract/adapters/corum.yaml`:
```yaml
adapter: corum
version: '1.0'
constructs: {}
scalarTypes: {}
```

- [ ] **Step 3: Create interchange.schema.yaml**

`.corum/packs/extract/interchange.schema.yaml`:
```yaml
$schema: 'https://json-schema.org/draft/2020-12/schema'
$id: 'corum/interchange'
title: Corum Interchange Format
description: |
  Output format produced by corum-extract tools (e.g. treesitter-based extractors).
  Defines the envelope structure only — node properties are template-specific
  and are validated by the graph loader after import, not here.

  Extractors SHOULD validate their output against this schema before shipping.
  The corum adapter validates the envelope at runtime using TypeScript type guards;
  this schema is the shared tooling contract.

type: object
required:
  - corumInterchange
  - nodes

properties:

  corumInterchange:
    type: string
    description: Interchange format version. Currently "1.0".
    example: '1.0'

  targets:
    type: array
    description: Template packs this file's nodes and edges require to be meaningful.
    items:
      type: object
      required: [pack, version]
      properties:
        pack:
          type: string
          description: Pack name (e.g. core, domain, messaging).
        version:
          type: string
          description: Semver range (e.g. ^1.0.0).

  source:
    type: object
    description: Metadata about the extraction tool that produced this file.
    properties:
      analyser:
        type: string
        description: Name of the extraction tool (e.g. corum-extract).
      version:
        type: string
        description: Version of the extraction tool.
      language:
        type: string
        description: Source language analysed (e.g. csharp, typescript).
      repo:
        type: string
        description: Path or URL to the source repository.

  nodes:
    type: array
    description: |
      Flat list of all nodes, including structural children (Schema, Field,
      EnumValue, DomainOperation, Invariant). The ID encodes the full ownership
      hierarchy: component.Template.name.section.childname.
    items:
      type: object
      required: [id, template, properties]
      properties:
        id:
          type: string
          description: |
            Fully qualified corum node ID.
            Root nodes: {component}.{Template}.{name}  (3 segments)
            Child nodes: {root-id}.{section}.{child-name}  (5+ segments)
        template:
          type: string
          description: |
            Corum template name (e.g. Command, DomainModel, Schema, Field,
            EnumDefinition, EnumValue, DomainOperation, Invariant, ValueObject,
            IntegrationEvent, DomainEvent). Must match a template in the active packs.
        properties:
          type: object
          description: Template-specific properties. May be empty ({}).
        provenance:
          type: object
          description: How this node was established by the extraction tool.
          properties:
            derivation:
              type: string
              enum: [resolved, inferred]
              description: |
                resolved — authoritative extraction (static analysis confirmed it exists).
                inferred — heuristic or probabilistic (name pattern, call graph, LLM).
            confidence:
              type: number
              minimum: 0
              maximum: 1
              description: |
                Extractor confidence (0–1). Only meaningful for derivation: inferred.
                The corum importer does not filter on this value — confidence informed
                which nodes the extractor chose to include.
            by:
              type: string
              description: Extraction tool/method identifier (e.g. treesitter).

  edges:
    type: array
    description: |
      Explicit non-structural edges. Structural edges (has-field, has-value) are
      implicit from the node ID hierarchy and should not be emitted here.
    items:
      type: object
      required: [from, to, type]
      properties:
        from:
          type: string
          description: Source node ID.
        to:
          type: string
          description: Target node ID.
        type:
          type: string
          enum:
            - triggers
            - produces
            - reads
            - calls
            - implements
            - maps-to
            - derived-from
            - renamed-from
          description: Edge type. Must be a valid corum EdgeType (excluding structural types).
        provenance:
          $ref: '#/properties/nodes/items/properties/provenance'

  gaps:
    type: array
    description: |
      Diagnostics from the extraction tool — things it could not resolve or
      collapsed due to conflicts. Surfaced as warnings during import.
    items:
      type: object
      required: [kind]
      properties:
        kind:
          type: string
          description: |
            Gap category. Common values:
              unresolved-field-type  — field type reference could not be resolved
              duplicate-domain-type  — same-name type collision; first-wins applied
        nodeId:
          type: string
          description: ID of the affected node (if applicable).
        reason:
          type: string
          description: Human-readable explanation of the gap.
```

- [ ] **Step 4: Build and verify no errors**

```bash
npm run build
```
Expected: exits 0, no TypeScript errors (these are YAML files so TS doesn't touch them, but verify the build is still clean).

- [ ] **Step 5: Commit**

```bash
git add .corum/packs/extract/
git commit -m "feat: add extract pack with interchange format schema"
```

---

### Task 2: CorumImportEntry type

**Files:**
- Modify: `src/import/config.ts` (add interface + union member)
- Modify: `test/import/config.test.ts` (add one describe block)

**Interfaces:**
- Produces: `CorumImportEntry { adapter: 'corum'; spec: string }` — used by Task 5 (adapter) and Task 7 (CLI)

- [ ] **Step 1: Write the failing test**

Add at the bottom of `test/import/config.test.ts`:

```typescript
describe('CorumImportEntry', () => {
  it('parses a corum import entry from config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
    const filePath = path.join(tmpDir, 'imports.yaml')
    fs.writeFileSync(filePath, `
imports:
  - adapter: corum
    spec: ./output.corum.yaml
`)
    const config = loadImportConfig(filePath)
    assert.equal(config.imports.length, 1)
    assert.equal(config.imports[0].adapter, 'corum')
    assert.equal(config.imports[0].spec, './output.corum.yaml')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to confirm it fails (TypeScript build error)**

```bash
npm run build
```
Expected: compiles fine (the config loader accepts any import entry shape via the union), but the `adapter: 'corum'` type is not yet in the union so `config.imports[0].adapter` will be typed as `'openapi' | 'asyncapi'`. The test runs but TypeScript may complain. Run it:

```bash
node --test dist/test/import/config.test.js 2>&1 | tail -5
```
Expected: the new test passes (runtime is fine, structural check works) but `npm run build` may fail if TypeScript rejects the unknown adapter discriminant. Add the type first.

- [ ] **Step 3: Add CorumImportEntry to config.ts**

In `src/import/config.ts`, add after the `AsyncAPIImportEntry` interface and update the union:

```typescript
export interface CorumImportEntry {
  adapter: 'corum'
  spec: string
}

export type ImportEntry = OpenAPIImportEntry | AsyncAPIImportEntry | CorumImportEntry
```

- [ ] **Step 4: Build and run test**

```bash
npm run build && node --test dist/test/import/config.test.js
```
Expected: all tests pass, including the new `CorumImportEntry` describe block.

- [ ] **Step 5: Commit**

```bash
git add src/import/config.ts test/import/config.test.ts
git commit -m "feat: add CorumImportEntry type to import config"
```

---

### Task 3: Parser

**Files:**
- Create: `src/adapters/corum/parser.ts`
- Create: `test/adapters/corum/parser.test.ts` (new — write first)

**Interfaces:**
- Produces:
  - `CorumInterchangeDocument` interface (re-exported, used by Task 4 mapper)
  - `ParseResult { document: CorumInterchangeDocument | null; diagnostics: Diagnostic[] }`
  - `parseSpec(specPath: string): ParseResult`

- [ ] **Step 1: Write the failing tests**

Create `test/adapters/corum/parser.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSpec } from '../../../src/adapters/corum/parser.js'

function writeTmp(content: string): { filePath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-parser-'))
  const filePath = path.join(dir, 'test.corum.yaml')
  fs.writeFileSync(filePath, content)
  return { filePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('parseSpec', () => {
  it('returns document for a valid interchange file', () => {
    const { filePath, cleanup } = writeTmp(`
corumInterchange: "1.0"
nodes:
  - id: orders.DomainEvent.OrderPlaced
    template: DomainEvent
    properties: {}
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.equal(document.corumInterchange, '1.0')
    assert.equal(document.nodes.length, 1)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })

  it('returns null and error diagnostic when corumInterchange key is missing', () => {
    const { filePath, cleanup } = writeTmp(`
nodes:
  - id: orders.DomainEvent.OrderPlaced
    template: DomainEvent
    properties: {}
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when nodes is missing', () => {
    const { filePath, cleanup } = writeTmp(`corumInterchange: "1.0"`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns document with warning for unknown version', () => {
    const { filePath, cleanup } = writeTmp(`
corumInterchange: "2.0"
nodes: []
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('2.0')))
    cleanup()
  })

  it('returns null and error diagnostic for invalid YAML', () => {
    const { filePath, cleanup } = writeTmp(`{ bad yaml: [`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when file does not exist', () => {
    const { document, diagnostics } = parseSpec('/nonexistent/path.corum.yaml')
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm run build 2>&1 | head -5
```
Expected: TypeScript error — `src/adapters/corum/parser.ts` does not exist.

- [ ] **Step 3: Implement parser.ts**

Create `src/adapters/corum/parser.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic } from '../../schema/index.js'

const SUPPORTED_VERSION = '1.0'

export interface CorumInterchangeProvenance {
  derivation?: 'resolved' | 'inferred'
  confidence?: number
  by?: string
}

export interface CorumInterchangeNode {
  id: string
  template: string
  properties: Record<string, unknown>
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeEdge {
  from: string
  to: string
  type: string
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeGap {
  kind: string
  nodeId?: string
  reason?: string
}

export interface CorumInterchangeDocument {
  corumInterchange: string
  targets?: Array<{ pack: string; version: string }>
  source?: {
    analyser?: string
    version?: string
    language?: string
    repo?: string
  }
  nodes: CorumInterchangeNode[]
  edges?: CorumInterchangeEdge[]
  gaps?: CorumInterchangeGap[]
}

export interface ParseResult {
  document: CorumInterchangeDocument | null
  diagnostics: Diagnostic[]
}

export function parseSpec(specPath: string): ParseResult {
  const diagnostics: Diagnostic[] = []
  let raw: unknown

  try {
    raw = parseYaml(readFileSync(specPath, 'utf-8'))
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: `Failed to read or parse file: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { document: null, diagnostics }
  }

  if (!isCorumInterchangeDocument(raw)) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: 'Invalid corum interchange file: missing required "corumInterchange" key or "nodes" array',
    })
    return { document: null, diagnostics }
  }

  const doc = raw as CorumInterchangeDocument

  if (doc.corumInterchange !== SUPPORTED_VERSION) {
    diagnostics.push({
      severity: 'warning',
      file: specPath,
      message: `Unknown corumInterchange version "${doc.corumInterchange}" — expected "${SUPPORTED_VERSION}", continuing`,
    })
  }

  return { document: doc, diagnostics }
}

function isCorumInterchangeDocument(value: unknown): value is CorumInterchangeDocument {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.corumInterchange === 'string' && Array.isArray(v.nodes)
}
```

- [ ] **Step 4: Build and run parser tests**

```bash
npm run build && node --test dist/test/adapters/corum/parser.test.js
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/corum/parser.ts test/adapters/corum/parser.test.ts
git commit -m "feat: corum interchange parser"
```

---

### Task 4: Mapper

**Files:**
- Create: `src/adapters/corum/mapper.ts`
- Create: `test/adapters/corum/mapper.test.ts`

**Interfaces:**
- Consumes: `CorumInterchangeDocument`, `CorumInterchangeNode`, `CorumInterchangeEdge` from `parser.ts`
- Produces:
  - `MapResult { nodes: Node[]; edges: Edge[]; diagnostics: Diagnostic[] }`
  - `mapDocument(document: CorumInterchangeDocument, specPath: string): MapResult`

- [ ] **Step 1: Write the failing tests**

Create `test/adapters/corum/mapper.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapDocument } from '../../../src/adapters/corum/mapper.js'
import type { CorumInterchangeDocument } from '../../../src/adapters/corum/parser.js'

const SPEC_PATH = '/fake/output.corum.yaml'

function makeDoc(overrides: Partial<CorumInterchangeDocument> = {}): CorumInterchangeDocument {
  return {
    corumInterchange: '1.0',
    nodes: [],
    ...overrides,
  }
}

describe('mapDocument — nodes', () => {
  it('maps a resolved node with derivation: determined', () => {
    const doc = makeDoc({
      nodes: [{
        id: 'orders.DomainEvent.OrderPlaced',
        template: 'DomainEvent',
        properties: { schema: 'OrderPlaced' },
        provenance: { derivation: 'resolved', by: 'treesitter' },
      }],
    })
    const { nodes, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 1)
    const n = nodes[0]
    assert.equal(n.id, 'orders.DomainEvent.OrderPlaced')
    assert.equal(n.template, 'DomainEvent')
    assert.equal(n.component, 'orders')
    assert.equal(n.state, 'implemented')
    assert.equal(n.stability, 'unstable')
    assert.equal(n.schemaVersion, '1')
    assert.equal(n.derivation, 'determined')
    assert.equal(n.derivedBy, 'adapter:corum/treesitter')
    assert.equal(n.extractedFrom, SPEC_PATH)
    assert.deepEqual(n.properties, { schema: 'OrderPlaced' })
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('maps an inferred node with derivation: inferred', () => {
    const doc = makeDoc({
      nodes: [{
        id: 'orders.DomainModel.OrderAggregate.operations.Place',
        template: 'DomainOperation',
        properties: { description: 'Place' },
        provenance: { derivation: 'inferred', confidence: 0.9, by: 'treesitter' },
      }],
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'inferred')
  })

  it('defaults derivation to determined when provenance is absent', () => {
    const doc = makeDoc({
      nodes: [{ id: 'orders.DomainEvent.OrderPlaced', template: 'DomainEvent', properties: {} }],
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'determined')
    assert.equal(nodes[0].derivedBy, 'adapter:corum')
  })

  it('uses adapter:corum as derivedBy when provenance.by is absent', () => {
    const doc = makeDoc({
      nodes: [{
        id: 'orders.DomainEvent.OrderPlaced',
        template: 'DomainEvent',
        properties: {},
        provenance: { derivation: 'resolved' },
      }],
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivedBy, 'adapter:corum')
  })

  it('emits a warning and skips nodes missing id or template', () => {
    const doc = makeDoc({
      nodes: [
        { id: '', template: 'DomainEvent', properties: {} },
        { id: 'orders.DomainEvent.OrderPlaced', template: '', properties: {} },
      ],
    })
    const { nodes, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 0)
    assert.equal(diagnostics.filter(d => d.severity === 'warning').length, 2)
  })
})

describe('mapDocument — edges', () => {
  it('constructs edge ID as from__type__to', () => {
    const doc = makeDoc({
      edges: [{
        from: 'orders.DomainModel.OrderAggregate.operations.Place',
        to: 'orders.DomainEvent.OrderPlaced',
        type: 'produces',
        provenance: { derivation: 'inferred', by: 'treesitter' },
      }],
    })
    const { edges } = mapDocument(doc, SPEC_PATH)
    assert.equal(edges.length, 1)
    assert.equal(edges[0].id, 'orders.DomainModel.OrderAggregate.operations.Place__produces__orders.DomainEvent.OrderPlaced')
    assert.equal(edges[0].type, 'produces')
    assert.equal(edges[0].state, 'implemented')
    assert.equal(edges[0].derivation, 'inferred')
    assert.equal(edges[0].derivedBy, 'adapter:corum/treesitter')
  })

  it('emits a warning and skips edges with unknown type', () => {
    const doc = makeDoc({
      edges: [{ from: 'a.B.C', to: 'd.E.F', type: 'unknown-type' }],
    })
    const { edges, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(edges.length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('unknown-type')))
  })
})

describe('mapDocument — gaps', () => {
  it('emits each gap as a warning diagnostic', () => {
    const doc = makeDoc({
      gaps: [
        { kind: 'unresolved-field-type', nodeId: 'orders.X.fields.Y', reason: 'MissingType' },
        { kind: 'duplicate-domain-type', reason: 'name collision' },
      ],
    })
    const { diagnostics } = mapDocument(doc, SPEC_PATH)
    const warnings = diagnostics.filter(d => d.severity === 'warning')
    assert.equal(warnings.length, 2)
    assert.ok(warnings[0].message.includes('unresolved-field-type'))
    assert.ok(warnings[1].message.includes('duplicate-domain-type'))
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm run build 2>&1 | head -5
```
Expected: TypeScript error — `src/adapters/corum/mapper.ts` does not exist.

- [ ] **Step 3: Implement mapper.ts**

Create `src/adapters/corum/mapper.ts`:

```typescript
import type { Diagnostic, Edge, EdgeType, Node } from '../../schema/index.js'
import type { CorumInterchangeDocument, CorumInterchangeEdge, CorumInterchangeNode, CorumInterchangeProvenance } from './parser.js'

const VALID_EDGE_TYPES = new Set<string>([
  'triggers', 'produces', 'reads', 'calls', 'implements',
  'maps-to', 'derived-from', 'renamed-from', 'has-field', 'has-value',
])

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function mapDocument(document: CorumInterchangeDocument, specPath: string): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []

  for (const gap of document.gaps ?? []) {
    const msg = gap.nodeId
      ? `[${gap.kind}] ${gap.nodeId}: ${gap.reason ?? ''}`
      : `[${gap.kind}] ${gap.reason ?? ''}`
    diagnostics.push({ severity: 'warning', file: specPath, message: msg })
  }

  for (const raw of document.nodes) {
    if (!raw.id || !raw.template) {
      diagnostics.push({ severity: 'warning', file: specPath, message: `Node missing id or template — skipping` })
      continue
    }
    nodes.push(mapNode(raw, specPath))
  }

  for (const raw of document.edges ?? []) {
    if (!VALID_EDGE_TYPES.has(raw.type)) {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        message: `Unknown edge type '${raw.type}' from '${raw.from}' to '${raw.to}' — skipping`,
      })
      continue
    }
    edges.push(mapEdge(raw))
  }

  return { nodes, edges, diagnostics }
}

function mapNode(raw: CorumInterchangeNode, specPath: string): Node {
  return {
    id: raw.id,
    template: raw.template,
    component: raw.id.split('.')[0],
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: new Date().toISOString().split('T')[0],
    extractedFrom: specPath,
    derivation: derivationOf(raw.provenance),
    derivedBy: derivedByOf(raw.provenance),
    properties: raw.properties ?? {},
  }
}

function mapEdge(raw: CorumInterchangeEdge): Edge {
  return {
    id: `${raw.from}__${raw.type}__${raw.to}`,
    from: raw.from,
    to: raw.to,
    type: raw.type as EdgeType,
    state: 'implemented',
    stability: 'unstable',
    derivation: derivationOf(raw.provenance),
    derivedBy: derivedByOf(raw.provenance),
  }
}

function derivationOf(p: CorumInterchangeProvenance | undefined): 'determined' | 'inferred' {
  return p?.derivation === 'inferred' ? 'inferred' : 'determined'
}

function derivedByOf(p: CorumInterchangeProvenance | undefined): string {
  return p?.by ? `adapter:corum/${p.by}` : 'adapter:corum'
}
```

- [ ] **Step 4: Build and run mapper tests**

```bash
npm run build && node --test dist/test/adapters/corum/mapper.test.js
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/corum/mapper.ts test/adapters/corum/mapper.test.ts
git commit -m "feat: corum interchange mapper"
```

---

### Task 5: Adapter class and registration

**Files:**
- Create: `src/adapters/corum/index.ts`
- Modify: `src/adapters/index.ts`

**Interfaces:**
- Consumes: `parseSpec` from `parser.ts`, `mapDocument` from `mapper.ts`, `CorumImportEntry` from `config.ts`
- Produces: `CorumAdapter` registered under `adapterId: 'corum'`

- [ ] **Step 1: Create adapter index.ts**

Create `src/adapters/corum/index.ts`:

```typescript
import type { CorumImportEntry } from '../../import/config.js'
import type { AdapterContext, AdapterResult, SpecAdapter } from '../index.js'
import { parseSpec } from './parser.js'
import { mapDocument } from './mapper.js'

export class CorumAdapter implements SpecAdapter<CorumImportEntry> {
  readonly adapterId = 'corum' as const

  async import(entry: CorumImportEntry, _context: AdapterContext): Promise<AdapterResult> {
    const { document, diagnostics } = parseSpec(entry.spec)
    if (!document) return { nodes: [], edges: [], diagnostics }

    const { nodes, edges, diagnostics: mapDiagnostics } = mapDocument(document, entry.spec)
    return { nodes, edges, diagnostics: [...diagnostics, ...mapDiagnostics] }
  }
}
```

- [ ] **Step 2: Register in adapters/index.ts**

At the bottom of `src/adapters/index.ts`, add:

```typescript
import { CorumAdapter } from './corum/index.js'
registerAdapter(new CorumAdapter())
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```
Expected: exits 0. No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/corum/index.ts src/adapters/index.ts
git commit -m "feat: register CorumAdapter"
```

---

### Task 6: Integration test

**Files:**
- Create: `test/fixtures/corum/specs/basic.corum.yaml`
- Create: `test/import/corum-runner.test.ts`
- Create: `test/fixtures/corum/expected/components/orders/DomainEvents/OrderPlacedDomainEvent.yaml`
- Create: `test/fixtures/corum/expected/components/orders/DomainModels/OrderAggregate.yaml`

**Interfaces:**
- Consumes: full adapter + runner pipeline as wired in Task 5

The runner expects a pack config for the `corum` adapter. The extract pack's `adapters/corum.yaml` must be in the active graph's packs. The fixture graph (`fixtures/sample-graph`) uses the packs at `.corum/packs/`. The integration test adds the extract pack to the graph temp dir the same way the other runner tests operate — by copying the sample graph which references the local packs.

**Important:** The sample graph at `fixtures/sample-graph/graph.yaml` may not include the extract pack. You must check and add it if missing.

- [ ] **Step 1: Check and update the sample graph pack list**

Read `fixtures/sample-graph/graph.yaml`. If `extract` pack is not listed in `templatePacks`, add it:

```yaml
- name: extract
  path: ../../../.corum/packs/extract
```

(Follow the same relative-path pattern as existing entries.)

- [ ] **Step 2: Create the fixture file**

Create `test/fixtures/corum/specs/basic.corum.yaml`:

```yaml
corumInterchange: '1.0'
source:
  analyser: corum-extract
  version: 0.1.0
  language: csharp
  repo: ../test-repo
nodes:
  - id: orders.DomainEvent.OrderPlacedDomainEvent
    template: DomainEvent
    properties:
      schema: OrderPlacedDomainEvent
    provenance:
      derivation: resolved
      by: treesitter
  - id: orders.DomainEvent.OrderPlacedDomainEvent.schemas.OrderPlacedDomainEvent
    template: Schema
    properties: {}
    provenance:
      derivation: resolved
      by: treesitter
  - id: orders.DomainEvent.OrderPlacedDomainEvent.schemas.OrderPlacedDomainEvent.fields.OrderId
    template: Field
    properties:
      nullable: false
      collection: one
      type: uuid
    provenance:
      derivation: resolved
      by: treesitter
  - id: orders.DomainModel.OrderAggregate
    template: DomainModel
    properties:
      description: OrderAggregate
    provenance:
      derivation: resolved
      by: treesitter
  - id: orders.DomainModel.OrderAggregate.operations.Place
    template: DomainOperation
    properties:
      description: Place
    provenance:
      derivation: inferred
      confidence: 0.9
      by: treesitter
edges:
  - from: orders.DomainModel.OrderAggregate.operations.Place
    to: orders.DomainEvent.OrderPlacedDomainEvent
    type: produces
    provenance:
      derivation: inferred
      confidence: 0.9
      by: treesitter
gaps:
  - kind: unresolved-field-type
    nodeId: orders.SomeNode.fields.SomeField
    reason: MissingType
```

- [ ] **Step 3: Write the runner test (first pass — node existence assertions only)**

Create `test/import/corum-runner.test.ts`:

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
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specsDir = path.join(repoRoot, 'test/fixtures/corum/specs')
const expectedBaseDir = path.join(repoRoot, 'test/fixtures/corum/expected')

function makeRuntimeConfig(graphDir: string) {
  process.env.CORUM_GRAPH_PATH = graphDir
  return createGraphRuntimeConfig()
}

async function setupGraphDir() {
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-runner-'))
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
    const actual = fs.readFileSync(actualPath, 'utf-8')
    assert.equal(normalizeYaml(actual), normalizeYaml(expected), `${key} content mismatch`)
  }
}

describe('corum import — basic fixture', () => {
  it('imports nodes and produces edge from basic.corum.yaml', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'corum',
          spec: path.join(specsDir, 'basic.corum.yaml'),
        }],
      }
      const runtimeConfig = makeRuntimeConfig(graphDir)
      const result = await runImport(config, runtimeConfig)

      // No errors (gap warning is expected)
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `unexpected errors: ${JSON.stringify(result.diagnostics.filter(d => d.severity === 'error'))}`)

      // Gap is surfaced as warning
      assert.ok(result.diagnostics.some(d => d.severity === 'warning' && d.message.includes('unresolved-field-type')))

      // Cluster files were written
      assert.ok(fs.existsSync(path.join(graphDir, 'components/orders/DomainEvents/OrderPlacedDomainEvent.yaml')))
      assert.ok(fs.existsSync(path.join(graphDir, 'components/orders/DomainModels/OrderAggregate.yaml')))

      // Golden file comparison
      assertMatchesExpected(graphDir, 'basic')
    } finally {
      cleanup()
    }
  })
})
```

- [ ] **Step 4: Build and run (will fail — golden files missing)**

```bash
npm run build && node --test dist/test/import/corum-runner.test.js
```
Expected: test fails with `golden dir basic should contain at least one file` — this is expected. The first-pass assertions (no errors, file existence) should pass. If those also fail, fix the root cause before continuing.

- [ ] **Step 5: Generate golden files**

Run the import once and copy the cluster output to the golden dir:

```bash
node -e "
const { loadGraph } = await import('./dist/src/loader/index.js');
const { saveGraph } = await import('./dist/src/writer/graph-writer.js');
const { runImport } = await import('./dist/src/import/runner.js');
const { createGraphRuntimeConfig } = await import('./dist/src/source/config.js');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-gen-'));
process.env.CORUM_GRAPH_PATH = tmpDir;
const graph = await loadGraph({ graphPath: 'fixtures/sample-graph' });
await saveGraph(graph, { sourceGraphPath: 'fixtures/sample-graph', outputGraphPath: tmpDir });
const rc = createGraphRuntimeConfig();
await runImport({ imports: [{ adapter: 'corum', spec: path.resolve('test/fixtures/corum/specs/basic.corum.yaml') }] }, rc);
console.log('output dir:', tmpDir);
" --input-type=module
```

Then copy the two cluster files to the golden dir (note the `basic/` subdirectory — this matches `assertMatchesExpected(graphDir, 'basic')`):
```bash
mkdir -p test/fixtures/corum/expected/basic/components/orders/DomainEvents
mkdir -p test/fixtures/corum/expected/basic/components/orders/DomainModels
cp <tmpDir>/components/orders/DomainEvents/OrderPlacedDomainEvent.yaml test/fixtures/corum/expected/basic/components/orders/DomainEvents/
cp <tmpDir>/components/orders/DomainModels/OrderAggregate.yaml test/fixtures/corum/expected/basic/components/orders/DomainModels/
```

Replace `lastModifiedAt` and `extractedFrom` values with `<date>` and `<spec>` placeholders in both copied files (since the test's `normalizeYaml` normalizes these at comparison time but the golden files should be committed in their raw form — leave them as-is, the normalizer handles them).

- [ ] **Step 6: Run test to confirm golden comparison passes**

```bash
node --test dist/test/import/corum-runner.test.js
```
Expected: 1 test passes.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```
Expected: all tests pass (the node/edge counts from fixtures still hold; no regressions).

- [ ] **Step 8: Commit**

```bash
git add test/fixtures/corum/ test/import/corum-runner.test.ts
git commit -m "test: corum adapter integration test with golden fixtures"
```

---

### Task 7: CLI subcommand

**Files:**
- Modify: `src/bin/corum.ts`

**Interfaces:**
- Consumes: `CorumImportEntry` shape (inlined), `runImport` (already imported), `buildRuntimeConfig` (already defined in file)

- [ ] **Step 1: Add the subcommand**

In `src/bin/corum.ts`, add after the `asyncapi` subcommand block (around line 227):

```typescript
importCmd
  .command('corum <spec>')
  .description('Import a corum interchange file into the graph')
  .option('--graph <path>', 'Override CORUM_GRAPH_PATH')
  .action(async (spec: string, opts) => {
    try {
      const runtimeConfig = buildRuntimeConfig(opts.graph)
      const entry = { adapter: 'corum' as const, spec: path.resolve(spec) }
      const result = await runImport({ imports: [entry] }, runtimeConfig)
      reportDiagnostics(result.diagnostics)
      if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
    } catch (err) {
      process.stderr.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(2)
    }
  })
```

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: exits 0.

- [ ] **Step 3: Smoke test the CLI help output**

```bash
node dist/src/bin/corum.js import --help
```
Expected output includes:
```
Commands:
  openapi <spec>    Import an OpenAPI spec into the graph
  asyncapi <spec>   Import an AsyncAPI spec into the graph
  corum <spec>      Import a corum interchange file into the graph
```

- [ ] **Step 4: Commit**

```bash
git add src/bin/corum.ts
git commit -m "feat: add corum import subcommand to CLI"
```

---

### Task 8: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add extract pack section**

Find the section in `README.md` that documents template packs (where `core`, `domain`, `rest`, `messaging` are described). Add `extract` to the list and install command:

```markdown
### extract pack

Provides the interchange format schema and import adapter for `corum-extract` tools
(treesitter-based extractors and similar). Install alongside the domain/messaging packs
when using extraction tooling:

```bash
corum pack install extract
```
```

- [ ] **Step 2: Add corum import adapter section**

Find the section documenting `openapi` and `asyncapi` adapters (likely under an "Importing" or "Import" heading). Add:

```markdown
### Corum interchange (corum-extract output)

Import a `*.corum.yaml` file produced by `corum-extract` or compatible tooling:

```yaml
# .corum/imports.yaml
imports:
  - adapter: corum
    spec: path/to/output.corum.yaml
```

Or via CLI:

```bash
corum import corum path/to/output.corum.yaml
```

The interchange format is self-describing — no component mapping strategy is needed.
Node IDs, template names, and field references are already corum-native. Gaps reported
by the extractor (unresolved types, name collisions) are surfaced as warnings.

Requires the `extract` pack to be active in your graph.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document extract pack and corum import adapter"
```

---

## Self-Review

**Spec coverage:**
- ✅ Extract pack (pack.yaml, adapters/corum.yaml, interchange.schema.yaml) — Task 1
- ✅ CorumImportEntry type — Task 2
- ✅ Parser with type guard, version check, error handling — Task 3
- ✅ Mapper: provenance → derivation, derivedBy, gap warnings, unknown edge type skip — Task 4
- ✅ CorumAdapter class ignoring packConfig — Task 5
- ✅ Integration test with golden files under `expected/basic/components/...` — Task 6
- ✅ CLI subcommand `corum import corum <spec>` — Task 7
- ✅ README update — Task 8
- ✅ No minConfidence filtering — confirmed dropped (spec §Provenance Mapping)
- ✅ Structural edges not reconstructed — confirmed (mapper emits only explicit edges)
- ✅ `state: implemented`, `stability: unstable` defaults — in mapper
- ✅ Edge ID: `{from}__{type}__{to}` — in mapper

**Type consistency check:**
- `parseSpec` returns `ParseResult { document: CorumInterchangeDocument | null; diagnostics }` — used same in Tasks 3, 4, 5 ✅
- `mapDocument(document, specPath)` — same signature in Tasks 4 and 5 ✅
- `CorumImportEntry { adapter: 'corum'; spec: string }` — used same in Tasks 2, 5, 7 ✅
- `derivationOf` returns `'determined' | 'inferred'` — matches `Node.derivation` and `Edge.derivation` type ✅

**Placeholder scan:** No TBDs, no "similar to", no "add appropriate" — clean.

**One open item in Task 6:** The sample-graph pack list check (Step 1) requires reading `fixtures/sample-graph/graph.yaml` at implementation time. The instruction is concrete — check and add if missing. Not a placeholder.
