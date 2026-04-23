# Web App & Schema Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the web UI (icons, nav, properties card, schema links) and modernise the template/node YAML schema to use an `info:` metadata block, `$ref`/`type` field syntax, and `format: node-ref` annotations.

**Architecture:** Two independent phases. Phase 1 changes only frontend files (`web/`) and template YAML `ui.icon` values — no TypeScript changes needed. Phase 2 changes the TypeScript schema types, loader, server, all template YAMLs, and migrates node data files; tasks within Phase 2 must be done in order. Phases can be committed and shipped independently.

**Tech Stack:** React 18 (Babel CDN, no build step), Express, Node.js ESM, TypeScript 5, `yaml` npm package (v2), Node.js built-in test runner (`node:test`).

---

## File Map

**Phase 1 — Web UI**
- Modify: `web/index.html` — add Font Awesome CDN
- Modify: `web/primitives.jsx` — Icon component, PropertiesTable/PropertyValue, fieldType, fieldDetails, buildSchemaModel, SchemaCard/SchemaFieldRows
- Modify: `web/app.jsx` — NavTree (accent→icon), NodePage (onNavigate + edges props)
- Modify: `web/style.css` — nested prop table, node-ref link styles
- Modify: `.corum/packs/*/templates/*.yaml` — `ui.icon` values only (14 files)

**Phase 2 — Schema Type System (in order)**
- Modify: `src/schema/index.ts` — Template interface
- Modify: `src/loader/pack-loader.ts` — RESERVED_TEMPLATE_KEYS, validation
- Modify: `src/web/server.ts` — /api/templates response, node-ref annotation
- Modify: `test/loader.test.ts` — expectations for info block
- Modify: `test/web.test.ts` — manually constructed templates
- Modify: `test/writer.test.ts` — add $ref round-trip test
- Modify: `.corum/packs/*/templates/*.yaml` — add `info:` block, Field.yaml $ref definition, node-ref format annotations (14 files)
- Modify: `fixtures/sample-graph/components/orders/DomainModels/order.yaml` — $ref migration
- Modify: `fixtures/sample-graph/components/orders/APIEndpoints/create-order.yaml` — $ref migration

---

## Phase 1: Web UI

### Task 1: Font Awesome CDN + replace Icon component

**Files:**
- Modify: `web/index.html`
- Modify: `web/primitives.jsx`

- [ ] **Step 1: Add FA 6 Free CDN to index.html**

In `web/index.html`, add before the first `<script>` tag:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" />
```

- [ ] **Step 2: Replace Icon component in primitives.jsx**

Replace the entire `Icon` function (lines 25–57):
```jsx
function Icon({ name, size }) {
  const style = size ? { fontSize: size } : undefined;
  return <i className={`fa-solid fa-${name}`} style={style} aria-hidden="true" />;
}
```

- [ ] **Step 3: Update NavRail icon names in app.jsx**

The NavRail uses hardcoded icon names `'grid'` and `'cube'`. Update to FA names (line ~88-89 of app.jsx):
```jsx
const items = [
  { id: 'dashboard', icon: 'table-cells', label: 'Dashboard' },
  { id: 'components', icon: 'cube', label: 'Models' },
];
```

Update caret references in NavTree (lines ~132-133 of app.jsx):
```jsx
<Icon name={openComponents[component] ? 'chevron-down' : 'chevron-right'} size={12} />
```

- [ ] **Step 4: Verify in browser**

Start the server: `npm run build && node dist/src/web/server.js`

Open `http://localhost:3000`. Verify: nav rail icons render as FA icons, caret expand/collapse works, no broken icon fallbacks.

- [ ] **Step 5: Commit**
```bash
git add web/index.html web/primitives.jsx web/app.jsx
git commit -m "feat: replace inline SVG icons with Font Awesome 6 Free"
```

---

### Task 2: Update template YAML ui.icon values

**Files:** All 14 template YAML files in `.corum/packs/`

- [ ] **Step 1: Update each template's ui.icon**

Apply these changes (only the `icon:` line in each file's `ui:` block):

`.corum/packs/core/templates/Field.yaml`: `icon: minus`
`.corum/packs/core/templates/Schema.yaml`: `icon: layer-group`
`.corum/packs/core/templates/EnumDefinition.yaml`: `icon: list`
`.corum/packs/core/templates/EnumValue.yaml`: `icon: tag`
`.corum/packs/domain/templates/DomainModel.yaml`: `icon: sitemap`
`.corum/packs/domain/templates/DomainOperation.yaml`: `icon: gear`
`.corum/packs/domain/templates/Command.yaml`: `icon: terminal`
`.corum/packs/domain/templates/ReadModel.yaml`: `icon: table-list`
`.corum/packs/domain/templates/Invariant.yaml`: `icon: shield-halved`
`.corum/packs/domain/templates/ValueObject.yaml`: `icon: cube`
`.corum/packs/messaging/templates/DomainEvent.yaml`: `icon: bolt`
`.corum/packs/messaging/templates/Event.yaml`: `icon: bolt`
`.corum/packs/messaging/templates/IntegrationEvent.yaml`: `icon: share-nodes`
`.corum/packs/rest/templates/APIEndpoint.yaml`: `icon: plug`

- [ ] **Step 2: Verify in browser**

Reload `http://localhost:3000`. At this point icons aren't yet shown in nav (Task 3 does that), but no errors should appear.

- [ ] **Step 3: Commit**
```bash
git add .corum/
git commit -m "feat: update template ui.icon values to Font Awesome 6 names"
```

---

### Task 3: Secondary nav — icon instead of coloured box

**Files:**
- Modify: `web/app.jsx` lines ~138–142

- [ ] **Step 1: Replace nav-template-accent with FA icon**

In `NavTree`, replace the `nav-template-accent` div with an FA icon (around line 139–141):
```jsx
<div className="nav-template-head">
  <i
    className={`fa-solid fa-${template?.ui?.icon ?? 'circle'}`}
    style={{ color: colour, fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}
  />
  <span>{templateName}</span>
</div>
```

- [ ] **Step 2: Remove the nav-template-accent CSS rule**

In `web/style.css`, find and delete the `.nav-template-accent` rule block.

- [ ] **Step 3: Verify in browser**

Reload. Each template group in the secondary nav should show the FA icon (e.g. sitemap for DomainModel, plug for APIEndpoint) tinted in the template colour.

- [ ] **Step 4: Commit**
```bash
git add web/app.jsx web/style.css
git commit -m "feat: show template icon in secondary nav instead of colour box"
```

---

### Task 4: Properties card — nested indentation + navigate callback

**Files:**
- Modify: `web/primitives.jsx`
- Modify: `web/app.jsx`
- Modify: `web/style.css`

- [ ] **Step 1: Add PropertyValue component to primitives.jsx**

Replace the `formatValue` function and `PropertiesTable` component with:
```jsx
function PropertyValue({ value, onNavigate }) {
  if (value === null || value === undefined) return <span className="prop-empty">—</span>;

  // Resolved node ref: { display, nodeId }
  if (typeof value === 'object' && 'display' in value && 'nodeId' in value) {
    return (
      <a className="node-ref-link" onClick={() => onNavigate && onNavigate(value.nodeId)}>
        {value.display}
      </a>
    );
  }

  // Unresolved ref: { display } only
  if (typeof value === 'object' && 'display' in value) {
    return <span>{value.display}</span>;
  }

  // Array
  if (Array.isArray(value)) {
    return (
      <div className="prop-array">
        {value.map((item, i) => (
          <div key={i} className="prop-array-item">
            <PropertyValue value={item} onNavigate={onNavigate} />
          </div>
        ))}
      </div>
    );
  }

  // Nested object → sub-table
  if (typeof value === 'object') {
    return (
      <table className="prop-table prop-table-nested">
        <tbody>
          {Object.entries(value).map(([k, v]) => (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td><PropertyValue value={v} onNavigate={onNavigate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return <span>{String(value)}</span>;
}

function PropertiesTable({ properties, onNavigate }) {
  const entries = Object.entries(properties ?? {});
  if (entries.length === 0) {
    return <p className="label-sm" style={{ padding: '10px 14px' }}>No properties.</p>;
  }
  return (
    <table className="prop-table">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <td className="mono">{key}</td>
            <td><PropertyValue value={value} onNavigate={onNavigate} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Export `PropertyValue` from `window.CorumPrimitives` at the bottom of primitives.jsx:
```jsx
window.CorumPrimitives = {
  BrandMark, Icon, StateTag, StabilityTag, Chip, TemplateBadge,
  PropertyValue, PropertiesTable, SchemaCard,
};
```

- [ ] **Step 2: Pass onNavigate through NodePage in app.jsx**

Change the NodePage function signature and the PropertiesTable call:
```jsx
function NodePage({ nodeId, templates, onNavigate }) {
  // ... existing code ...

  // Update the PropertiesTable call (~line 259):
  <PropertiesTable properties={root.properties} onNavigate={onNavigate} />
```

Pass `onNavigate` when rendering NodePage in App (~line 325):
```jsx
page = <NodePage nodeId={activeNodeId} templates={templates} onNavigate={handleNode} />;
```

- [ ] **Step 3: Add CSS for nested tables and links**

In `web/style.css`, add after the existing `.prop-table` rules:
```css
.prop-table-nested {
  width: 100%;
  margin: 2px 0;
  border-left: 2px solid var(--rule);
  padding-left: 8px;
}
.prop-table-nested td:first-child {
  color: var(--ink-3);
  font-size: 11px;
  padding: 2px 8px 2px 0;
}
.prop-array-item { padding: 1px 0; }
.node-ref-link {
  cursor: pointer;
  color: var(--accent);
  text-decoration: underline;
  font-size: inherit;
}
.prop-empty { color: var(--ink-4); }
```

- [ ] **Step 4: Verify in browser**

Navigate to an APIEndpoint node. The `responses` property should render as an indented sub-table. Scalar properties (method, path) render as plain text. Links appear when node-ref properties are resolved (after Task 15).

- [ ] **Step 5: Commit**
```bash
git add web/primitives.jsx web/app.jsx web/style.css
git commit -m "feat: properties card nested rendering and navigate callback"
```

---

### Task 5: Schema view — pass edges and render maps-to links

**Files:**
- Modify: `web/app.jsx`
- Modify: `web/primitives.jsx`

- [ ] **Step 1: Extract edges from cluster in NodePage and pass to SchemaCard**

In `app.jsx`, update the NodePage cluster destructure and SchemaCard call:
```jsx
const { root, children, edges } = cluster;
// ...
<SchemaCard
  key={templateName}
  title={templateName}
  nodes={groupNodes}
  allNodes={children}
  edges={edges}
/>
```

- [ ] **Step 2: Thread edges through SchemaCard and SchemaFieldRows in primitives.jsx**

Update `SchemaCard` signature and the `SchemaFieldRows` call within it:
```jsx
function SchemaCard({ title, nodes, allNodes, edges }) {
  // ...
  // In the Schema branch, update the SchemaFieldRows call:
  <SchemaFieldRows schemaName={schemaName} model={model} visited={new Set()} edges={edges ?? []} />
```

Update `SchemaFieldRows` signature and add maps-to rendering in the links column:
```jsx
function SchemaFieldRows({ schemaName, model, prefix = '', depth = 0, visited = new Set(), edges = [] }) {
  // ...
  // Inside the field map, update the links/lineage cell:
  const mapsTo = edges.filter(e => e.from === field.id && e.type === 'maps-to');
  // ...
  <div className="lineage">
    {mapsTo.length > 0
      ? mapsTo.map(e => {
          const targetNodeId = e.to.replace(/\.fields\.[^.]+$/, '');
          const targetFieldName = e.to.split('.').pop();
          return (
            <a
              key={e.to}
              className="node-ref-link"
              onClick={() => window.location.hash = `#/node?id=${encodeURIComponent(targetNodeId)}`}
              title={e.to}
            >
              → {targetFieldName}
            </a>
          );
        })
      : fieldDetails(field.properties)
    }
  </div>
```

Also thread `edges` through the recursive `SchemaFieldRows` call:
```jsx
<SchemaFieldRows
  schemaName={objectRef}
  model={model}
  prefix={childPrefix}
  depth={depth + 1}
  visited={nextVisited}
  edges={edges}
/>
```

- [ ] **Step 3: Verify in browser**

Navigate to `orders.APIEndpoint.create-order`. The schema card should show `→ id`, `→ customerId` etc. in the Links column for fields that have maps-to edges. Clicking a link navigates to the DomainModel node.

- [ ] **Step 4: Commit**
```bash
git add web/app.jsx web/primitives.jsx
git commit -m "feat: render maps-to edges as clickable links in schema card"
```

---

## Phase 2: Schema Type System

### Task 6: Update Template interface for info block

**Files:**
- Modify: `src/schema/index.ts`

- [ ] **Step 1: Update Template interface**

Replace the existing Template interface:
```typescript
export interface Template {
  name: string
  info: {
    version: string
    core?: boolean
    abstract?: boolean
    description?: string
  }
  extends?: string
  properties?: Record<string, unknown>
  'edge-types'?: {
    outgoing?: EdgeType[]
    incoming?: EdgeType[]
    supports?: EdgeType[]
  }
  ui?: {
    icon?: string
    colour?: string
    displayProperties?: string[]
    badge?: string
    nav?: {
      nestOwned?: Array<{
        section: string
        label?: string
      }>
    }
  }
  [section: string]: unknown
}
```

- [ ] **Step 2: Build to check types compile**

```bash
npm run build
```
Expected: TypeScript errors in pack-loader.ts and server.ts where `template.version`, `template.core`, `template.abstract`, `template.description` are accessed. These are fixed in the next tasks.

- [ ] **Step 3: Commit**
```bash
git add src/schema/index.ts
git commit -m "refactor: Template interface uses info block for metadata"
```

---

### Task 7: Pack loader reads info block

**Files:**
- Modify: `src/loader/pack-loader.ts`

- [ ] **Step 1: Update RESERVED_TEMPLATE_KEYS**

```typescript
const RESERVED_TEMPLATE_KEYS = new Set([
  'name', 'info', 'extends', 'properties', 'edge-types', 'ui',
])
```

- [ ] **Step 2: Update template validation in loadPacks**

Replace the validation check (around line 72):
```typescript
const info = typeof templateRecord.info === 'object' && templateRecord.info !== null
  ? templateRecord.info as Record<string, unknown>
  : null

if (typeof templateRecord.name !== 'string' || typeof info?.version !== 'string') {
  diagnostics.push({ severity: 'error', file: filePath, message: 'template missing required name or info.version' })
  continue
}
```

- [ ] **Step 3: Build**
```bash
npm run build
```
Expected: server.ts still has errors accessing old template fields. Pack-loader errors should be resolved.

- [ ] **Step 4: Commit**
```bash
git add src/loader/pack-loader.ts
git commit -m "refactor: pack loader reads template metadata from info block"
```

---

### Task 8: Server returns info fields

**Files:**
- Modify: `src/web/server.ts`

- [ ] **Step 1: Update /api/templates response**

Update the templates map (around line 77):
```typescript
.map(template => ({
  name: template.name,
  version: template.info?.version,
  core: template.info?.core ?? false,
  abstract: template.info?.abstract ?? false,
  extends: template.extends,
  description: template.info?.description,
  ui: template.ui,
}))
```

- [ ] **Step 2: Build and run tests**
```bash
npm test
```
Expected: Tests fail because template YAMLs still use old format. Web test fails because manually constructed templates use old format.

- [ ] **Step 3: Update web.test.ts manually constructed templates**

In `test/web.test.ts`, find every manually constructed template object and add the `info` block. For each template in `makeTestGraph()`:
```typescript
templates.set('DomainModel', {
  name: 'DomainModel',
  info: { version: '1', core: false, description: 'A domain model' },
  operations: { 'item-template': 'DomainOperation' },
  ui: { colour: '#4a90e2', icon: 'sitemap', nav: { nestOwned: [{ section: 'operations', label: 'Operations' }] } },
})
templates.set('DomainOperation', {
  name: 'DomainOperation',
  info: { version: '1', core: false, description: 'A domain operation' },
  ui: { colour: '#5B8C5A', icon: 'gear' },
})
templates.set('Field', {
  name: 'Field',
  info: { version: '1', core: true },
})
```

Apply the same `info` block pattern to every other manually constructed template in the test file.

- [ ] **Step 4: Build**
```bash
npm run build
```
Expected: TypeScript compiles. Tests still fail on loader tests because template YAMLs use old format.

- [ ] **Step 5: Commit**
```bash
git add src/web/server.ts test/web.test.ts
git commit -m "refactor: server and web tests use template info block"
```

---

### Task 9: Update all template YAML files to info block

**Files:** All 14 template YAML files in `.corum/packs/`

For each file, move `version`, `core`, `abstract`, `description` under a new `info:` key. `name` and `extends` stay at top level.

- [ ] **Step 1: Update `.corum/packs/core/templates/_base.yaml`**

Before:
```yaml
name: base
version: "1.0.0"
core: true
abstract: true
description: |
  ...
```
After:
```yaml
name: base
info:
  version: "1.0.0"
  core: true
  abstract: true
  description: |
    ...
```

- [ ] **Step 2: Update all remaining template YAMLs**

Apply the same pattern to all 13 remaining template files:
- `.corum/packs/core/templates/Field.yaml`
- `.corum/packs/core/templates/Schema.yaml`
- `.corum/packs/core/templates/EnumDefinition.yaml`
- `.corum/packs/core/templates/EnumValue.yaml`
- `.corum/packs/domain/templates/DomainModel.yaml`
- `.corum/packs/domain/templates/DomainOperation.yaml`
- `.corum/packs/domain/templates/Command.yaml`
- `.corum/packs/domain/templates/ReadModel.yaml`
- `.corum/packs/domain/templates/Invariant.yaml`
- `.corum/packs/domain/templates/ValueObject.yaml`
- `.corum/packs/messaging/templates/DomainEvent.yaml`
- `.corum/packs/messaging/templates/Event.yaml`
- `.corum/packs/messaging/templates/IntegrationEvent.yaml`
- `.corum/packs/rest/templates/APIEndpoint.yaml`

- [ ] **Step 3: Run tests**
```bash
npm test
```
Expected: All tests pass. The loader now reads `info.version`, template YAMLs provide it, web tests use the new structure.

- [ ] **Step 4: Commit**
```bash
git add .corum/
git commit -m "refactor: all template YAMLs use info block for metadata"
```

---

### Task 10: Field.yaml — $ref/$type property definition

**Files:**
- Modify: `.corum/packs/core/templates/Field.yaml`

- [ ] **Step 1: Update Field.yaml properties block**

Replace the `properties` and `oneOf` sections:
```yaml
properties:
  type: object
  additionalProperties: false
  required:
    - nullable
    - cardinality
  properties:
    type:
      type: string
      enum:
        - uuid
        - string
        - integer
        - decimal
        - boolean
        - datetime
        - date
        - time
      description: "Primitive scalar type. Mutually exclusive with $ref."
    $ref:
      type: string
      format: node-ref
      description: |
        Reference to the node defining this field's type.
        Local schema: '#/schemas/<name>'
        Local enum:   '#/enums/<name>'
        Global node:  bare node ID (e.g. orders.DomainModel.order)
        Mutually exclusive with type.
    nullable:
      type: boolean
      description: "Whether this field may be absent or null"
    cardinality:
      type: string
      enum:
        - one
        - many
      description: "Whether this field holds a single value or a collection"
  oneOf:
    - required:
        - type
      not:
        required:
          - $ref
    - required:
        - $ref
      not:
        required:
          - type
```

Also update `displayProperties` in `ui:`:
```yaml
ui:
  icon: minus
  colour: "#888888"
  displayProperties:
    - type
    - $ref
    - nullable
    - cardinality
```

- [ ] **Step 2: Build**
```bash
npm run build
```
Expected: Compiles with no errors. No tests will break yet (node files still use old syntax — that's Task 12).

- [ ] **Step 3: Commit**
```bash
git add .corum/packs/core/templates/Field.yaml
git commit -m "refactor: Field.yaml uses \$ref/type instead of objectRef/scalarType"
```

---

### Task 11: Add format: node-ref annotations to template YAMLs

**Files:**
- Modify: `.corum/packs/rest/templates/APIEndpoint.yaml`
- Modify: `.corum/packs/domain/templates/DomainModel.yaml`

- [ ] **Step 1: Update APIEndpoint.yaml**

In the `properties.properties` block, update `request` and `responses`:
```yaml
    request:
      type: string
      format: node-ref
      description: |
        Local schema ref ('#/schemas/<name>') or global node ID describing
        the request body. Omit for operations with no body (e.g. GET, DELETE).
      examples:
        - "'#/schemas/create-order-request'"

    responses:
      type: object
      minProperties: 1
      description: |
        Map of HTTP status code (or 'default') to a local schema ref
        ('#/schemas/<name>') or global node ID describing the response body.
      propertyNames:
        pattern: "^(default|[1-5][0-9]{2})$"
      additionalProperties:
        type: string
        format: node-ref
      examples:
        - "200": "'#/schemas/order-response'"
```

- [ ] **Step 2: Update DomainModel.yaml**

In `properties.properties`, add `format: node-ref` to the `schema` property:
```yaml
    schema:
      type: string
      format: node-ref
      description: |
        Local schema name or global Schema node ID defining the structure of
        this model.
```

- [ ] **Step 3: Build and test**
```bash
npm test
```
Expected: All tests pass. The format annotations are stored in the template object but not yet used by server logic.

- [ ] **Step 4: Commit**
```bash
git add .corum/packs/rest/templates/APIEndpoint.yaml .corum/packs/domain/templates/DomainModel.yaml
git commit -m "refactor: add format: node-ref to ref-typed template properties"
```

---

### Task 12: Migrate node data files to $ref syntax

**Files:**
- Modify: `fixtures/sample-graph/components/orders/DomainModels/order.yaml`
- Modify: `fixtures/sample-graph/components/orders/APIEndpoints/create-order.yaml`

- [ ] **Step 1: Add writer test for $ref round-trip**

In `test/writer.test.ts`, add a new test after the existing ones:
```typescript
it('round-trips field $ref values with correct YAML quoting', async () => {
  const outputGraphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-ref-roundtrip-'))
  try {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })

    // Find a field that will use $ref after migration
    const statusField = graph.nodesById.get('orders.DomainModel.order.schemas.order.fields.status')
    assert.ok(statusField, 'status field exists')

    await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: outputGraphDir })

    // Read the raw YAML and verify $ref is quoted (not treated as comment)
    const orderYaml = fs.readFileSync(
      path.join(outputGraphDir, 'components', 'orders', 'DomainModels', 'order.yaml'),
      'utf-8'
    )
    // Field $ref values
    assert.match(orderYaml, /\$ref: '#\/enums\/order-status'/, 'field $ref is quoted')
    assert.doesNotMatch(orderYaml, /\$ref: #\//, 'no unquoted $ref values')
    // Root property node-ref values
    assert.match(orderYaml, /schema: '#\/schemas\/order'/, 'schema property is quoted')

    // Verify round-trip loads correctly
    const reloadedGraph = await loadGraph({ graphPath: outputGraphDir })
    const reloadedField = reloadedGraph.nodesById.get('orders.DomainModel.order.schemas.order.fields.status')
    assert.ok(reloadedField, 'status field survives round-trip')
    assert.equal(reloadedField.properties['$ref'], '#/enums/order-status')
    const reloadedRoot = reloadedGraph.nodesById.get('orders.DomainModel.order')
    assert.equal(reloadedRoot?.properties.schema, '#/schemas/order', 'schema property survives round-trip')
  } finally {
    fs.rmSync(outputGraphDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**
```bash
npm run build && node --test dist/test/writer.test.js
```
Expected: The new test fails because `order.yaml` still uses `objectRef: order-status`.

- [ ] **Step 3: Migrate order.yaml**

Update `fixtures/sample-graph/components/orders/DomainModels/order.yaml`. Update the root `properties` block AND every field entry:

```yaml
properties:
  description: A placed customer order; aggregate root for the orders bounded context
  schema: '#/schemas/order'

schemas:
  order:
    description: Structure of the order aggregate
    fields:
      id:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: '#/enums/order-status'
        nullable: false
        cardinality: one
      items:
        $ref: '#/schemas/order-line-item'
        nullable: false
        cardinality: many
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
      notes:
        type: string
        nullable: true
        cardinality: one

  order-line-item:
    description: A single line item within the order
    fields:
      productId:
        type: uuid
        nullable: false
        cardinality: one
      quantity:
        type: integer
        nullable: false
        cardinality: one
      unitPrice:
        state: proposed
        type: decimal
        nullable: false
        cardinality: one
```

- [ ] **Step 4: Migrate create-order.yaml**

Update `fixtures/sample-graph/components/orders/APIEndpoints/create-order.yaml`. Update the root `properties` block AND every field entry:

```yaml
properties:
  method: POST
  path: /orders
  request: '#/schemas/create-order-request'
  responses:
    "201": '#/schemas/create-order-response'
    "400": '#/schemas/problem-detail'
    "409": '#/schemas/problem-detail'

schemas:
  create-order-request:
    description: Request body for creating an order
    fields:
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      items:
        $ref: '#/schemas/order-line-item'
        nullable: false
        cardinality: many
      notes:
        type: string
        nullable: true
        cardinality: one

  order-line-item:
    description: A single line item within the order
    fields:
      productId:
        type: uuid
        nullable: false
        cardinality: one
      quantity:
        type: integer
        nullable: false
        cardinality: one
      unitPrice:
        state: draft
        type: decimal
        nullable: false
        cardinality: one

  create-order-response:
    description: Confirmed order details returned on successful creation
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: '#/enums/order-status'
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      items:
        $ref: '#/schemas/order-line-item'
        nullable: false
        cardinality: many
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one

  problem-detail:
    description: RFC 7807 error response body
    fields:
      type:
        type: string
        nullable: false
        cardinality: one
      title:
        type: string
        nullable: false
        cardinality: one
      status:
        type: integer
        nullable: false
        cardinality: one
      detail:
        type: string
        nullable: true
        cardinality: one
```

- [ ] **Step 5: Run full test suite**
```bash
npm test
```
Expected: The new round-trip test passes. All existing tests continue to pass (the loader stores field properties as-is — `$ref` is just another key). The writer.test.ts node count (45) and edge count (38) should be unchanged.

- [ ] **Step 6: Commit**
```bash
git add fixtures/ test/writer.test.ts
git commit -m "refactor: migrate field definitions to \$ref/type syntax"
```

---

### Task 13: Update primitives.jsx for $ref field syntax

**Files:**
- Modify: `web/primitives.jsx`

The field rendering functions still reference `scalarType` and `objectRef`. Update them to use `type` and `$ref`.

- [ ] **Step 1: Update fieldType**

```jsx
function fieldType(properties) {
  const cardinality = properties?.cardinality === 'many' ? '[]' : '';
  if (properties?.type) return `${properties.type}${cardinality}`;
  const ref = properties?.['$ref'];
  if (ref) {
    const name = typeof ref === 'string' ? ref.replace(/^#\/(schemas|enums)\//, '') : ref;
    return `${name}${cardinality}`;
  }
  return cardinality ? `unknown${cardinality}` : 'unknown';
}
```

- [ ] **Step 2: Update fieldDetails**

```jsx
function fieldDetails(properties) {
  const parts = [];
  const ref = properties?.['$ref'];
  if (ref) parts.push(`ref ${typeof ref === 'string' ? ref.replace(/^#\/(schemas|enums)\//, '') : ref}`);
  if (properties?.description) parts.push(properties.description);
  return parts.length > 0 ? parts.join(' · ') : '-';
}
```

- [ ] **Step 3: Update buildSchemaModel**

```jsx
function buildSchemaModel(schemaNodes, allNodes) {
  const schemasByName = new Map(schemaNodes.map(node => [localSchemaName(node.id), node]));
  const fieldsBySchema = new Map();
  const referencedSchemas = new Set();

  for (const node of allNodes ?? []) {
    if (node.template !== 'Field') continue;
    const schemaName = fieldSchemaName(node.id);
    if (!schemaName) continue;
    if (!fieldsBySchema.has(schemaName)) fieldsBySchema.set(schemaName, []);
    fieldsBySchema.get(schemaName).push(node);

    const ref = node.properties?.['$ref'];
    const localName = typeof ref === 'string' ? ref.replace(/^#\/schemas\//, '') : null;
    if (localName && schemasByName.has(localName)) {
      referencedSchemas.add(localName);
    }
  }

  const topSchemas = schemaNodes.filter(node => !referencedSchemas.has(localSchemaName(node.id)));
  return {
    schemasByName,
    fieldsBySchema,
    topSchemas: topSchemas.length > 0 ? topSchemas : schemaNodes,
  };
}
```

- [ ] **Step 4: Update SchemaFieldRows canExpand logic**

```jsx
function SchemaFieldRows({ schemaName, model, prefix = '', depth = 0, visited = new Set(), edges = [] }) {
  const fields = model.fieldsBySchema.get(schemaName) ?? [];
  // ...
  return (
    <>
      {fields.map(field => {
        const name = fieldLocalName(field.id);
        const ref = field.properties?.['$ref'];
        const localRef = typeof ref === 'string' ? ref.replace(/^#\/schemas\//, '') : null;
        const canExpand = localRef !== null && model.schemasByName.has(localRef) && !visited.has(localRef);
        const childPrefix = `${prefix}${name}${field.properties?.cardinality === 'many' ? '[].' : '.'}`;
        const nextVisited = new Set(visited);
        nextVisited.add(schemaName);
        // ...
        {canExpand && (
          <SchemaFieldRows
            schemaName={localRef}
            model={model}
            prefix={childPrefix}
            depth={depth + 1}
            visited={nextVisited}
            edges={edges}
          />
        )}
```

- [ ] **Step 5: Verify in browser**

Navigate to a schema node. Field types should display correctly (e.g. `order-status` not `#/enums/order-status`, `order-line-item[]` for many cardinality).

- [ ] **Step 6: Commit**
```bash
git add web/primitives.jsx
git commit -m "feat: update field rendering for \$ref/type field syntax"
```

---

### Task 14: Server resolves node-ref properties in cluster response

**Files:**
- Modify: `src/web/server.ts`

- [ ] **Step 1: Add helper functions above createApp**

```typescript
type NodeRefValue = { display: string; nodeId: string } | { display: string }

function resolveNodeRef(graph: Graph, node: Node, rawValue: string): NodeRefValue {
  if (rawValue.startsWith('#/schemas/')) {
    const name = rawValue.slice(10)
    const id = `${node.id}.schemas.${name}`
    return graph.nodesById.has(id) ? { display: name, nodeId: id } : { display: name }
  }
  if (rawValue.startsWith('#/enums/')) {
    const name = rawValue.slice(8)
    const id = `${node.id}.enums.${name}`
    return graph.nodesById.has(id) ? { display: name, nodeId: id } : { display: name }
  }
  // bare string = global node ID
  if (graph.nodesById.has(rawValue)) return { display: rawValue, nodeId: rawValue }
  return { display: rawValue }
}

function getPropertySchemas(templateProperties: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (Array.isArray(templateProperties.allOf)) {
    const merged: Record<string, Record<string, unknown>> = {}
    for (const schema of templateProperties.allOf) {
      Object.assign(merged, getPropertySchemas(schema as Record<string, unknown>))
    }
    return merged
  }
  if (typeof templateProperties.properties === 'object' && templateProperties.properties !== null) {
    return templateProperties.properties as Record<string, Record<string, unknown>>
  }
  return {}
}

function annotateNodeRefProperties(graph: Graph, node: Node, template: Template): Record<string, unknown> {
  if (!template.properties) return node.properties
  const propSchemas = getPropertySchemas(template.properties as Record<string, unknown>)
  const result: Record<string, unknown> = { ...node.properties }

  for (const [key, schema] of Object.entries(propSchemas)) {
    const value = result[key]
    if (value === undefined) continue

    if (schema.format === 'node-ref' && typeof value === 'string') {
      result[key] = resolveNodeRef(graph, node, value)
    } else if (
      schema.type === 'object' &&
      typeof schema.additionalProperties === 'object' &&
      schema.additionalProperties !== null &&
      (schema.additionalProperties as Record<string, unknown>).format === 'node-ref' &&
      typeof value === 'object' && value !== null && !Array.isArray(value)
    ) {
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) =>
          typeof v === 'string' ? [k, resolveNodeRef(graph, node, v)] : [k, v]
        )
      )
    }
  }
  return result
}
```

- [ ] **Step 2: Apply annotation in the cluster endpoint**

In the `/api/cluster` handler, annotate the root node's properties before returning:
```typescript
const cluster = getCluster(graph, nodeId)
const rootTemplate = graph.templates.get(cluster.root.template)
const annotatedRoot = rootTemplate
  ? { ...cluster.root, properties: annotateNodeRefProperties(graph, cluster.root, rootTemplate) }
  : cluster.root
res.json({
  root: summarizeNodeForNavigation(graph, annotatedRoot),
  children: cluster.children.map(child => summarizeNodeForNavigation(graph, child)),
  edges: cluster.edges,
})
```

- [ ] **Step 3: Build and test**
```bash
npm test
```
Expected: All tests pass.

- [ ] **Step 4: Verify in browser**

Navigate to `orders.APIEndpoint.create-order`. The Properties card should show:
- `request`: clickable link labelled `create-order-request` → navigates to the schema node
- `responses` → nested sub-table with `201`/`400`/`409` keys, each a clickable link

- [ ] **Step 5: Commit**
```bash
git add src/web/server.ts
git commit -m "feat: server resolves node-ref properties and returns links in cluster response"
```
