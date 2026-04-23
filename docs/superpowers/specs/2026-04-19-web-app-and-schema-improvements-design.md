# Web App & Schema Improvements Design

Date: 2026-04-19

## Scope

Six improvement areas: UI polish (icons, nav, properties card), template YAML restructure (`info:` block), field type system overhaul (`$ref` syntax, `format: node-ref`), and schema view link bug fix.

---

## 1. Font Awesome Icons

Replace hand-crafted inline SVGs with Font Awesome 6 Free via CDN (CSS variant).

**`web/index.html`** — add before app scripts:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" />
```

**`web/primitives.jsx`** — replace the `Icon` component:
```jsx
function Icon({ name, size }) {
  return <i className={`fa-solid fa-${name}`} style={size ? { fontSize: size } : undefined} />;
}
```

**Template YAMLs** — update `ui.icon` values to valid FA 6 Free Solid icon names:

| Current value       | FA icon name         |
|---------------------|----------------------|
| `domain-model`      | `sitemap`            |
| `api-endpoint`      | `plug`               |
| `domain-event`      | `bolt`               |
| `event`             | `bolt`               |
| `integration-event` | `share-nodes`        |
| `command`           | `terminal`           |
| `domain-operation`  | `gear`               |
| `read-model`        | `table-list`         |
| `value-object`      | `cube`               |
| `invariant`         | `shield-halved`      |
| `schema`            | `layer-group`        |
| `enum-definition`   | `list`               |
| `enum-value`        | `tag`                |
| `field`             | `minus`              |

New templates added by pack authors must use a valid FA 6 Free Solid icon name.

---

## 2. Secondary Nav Icons

Currently the nav renders a coloured square box next to template group names. Replace with the template's FA icon, tinted with `template.ui.colour`.

In `app.jsx`, where template group headings are rendered, change from the coloured box to:
```jsx
<i className={`fa-solid fa-${template.ui.icon}`} style={{ color: template.ui.colour }} />
```

---

## 3. Properties Card — Nested Structures

Currently `formatValue()` JSON-stringifies objects and arrays, producing unreadable blobs. Replace with recursive nested indentation.

**Approach:** if a property value is a plain object, render a sub-table indented beneath the key. If a value is an array, render each item as a sub-row (indexed or anonymous). Depth is tracked via CSS `padding-left` per level.

```
method        POST
path          /orders
responses
  200         → create-order-response  [link]
  422         → validation-error       [link]
request       → create-order-request  [link]
```

Node-ref values (see §5) render as clickable links rather than plain text.

---

## 4. Template YAML — `info:` Block

Restructure top-level metadata in all template YAML files to nest under `info:`, aligning with OpenAPI/AsyncAPI conventions.

**Before:**
```yaml
name: APIEndpoint
version: "1.0.0"
core: false
abstract: false
description: |
  ...
```

**After:**
```yaml
name: APIEndpoint
info:
  version: "1.0.0"
  core: false
  abstract: false
  description: |
    ...
```

All template YAMLs in all packs must be updated. The loader and any code reading these fields must be updated to read from `info.*`.

---

## 5. Field Type System — `$ref` Syntax

### 5a. Field property definitions (`Field.yaml`)

Replace the mutually-exclusive `scalarType` / `objectRef` pair with a single `type` (for primitives) XOR `$ref` (for node references). This mirrors OpenAPI's pattern exactly.

**Before:**
```yaml
fields:
  id:
    scalarType: uuid
    nullable: false
    cardinality: one
  status:
    objectRef: order-status
    nullable: false
    cardinality: one
```

**After:**
```yaml
fields:
  id:
    type: uuid
    nullable: false
    cardinality: one
  status:
    $ref: '#/enums/order-status'
    nullable: false
    cardinality: one
  items:
    $ref: '#/schemas/order-item'
    nullable: false
    cardinality: many
```

**Reference resolution:**
- `#/schemas/<name>` — local schema in this node's `schemas:` block
- `#/enums/<name>` — local enum in this node's `enums:` block
- bare string (no `#/`) — global node ID; generates an implicit `reads` edge

**Discriminator:** presence of `$ref` vs `type`. Mutually exclusive.

**`cardinality`** stays as `one | many` — not replaced with `type: array`. It is a domain concept, enables meaningful semantic diffs over time, and supports future richness (e.g., `zero-or-one`).

### 5b. Scalar type closed set

Valid `type` values for primitives: `uuid`, `string`, `integer`, `decimal`, `boolean`, `datetime`, `date`, `time`.

### 5c. `Field.yaml` template definition update

```yaml
properties:
  type: object
  properties:
    type:
      type: string
      enum: [uuid, string, integer, decimal, boolean, datetime, date, time]
      description: "Primitive scalar type. Mutually exclusive with $ref."
    $ref:
      type: string
      format: node-ref
      description: |
        Local or global reference to the node defining this field's type.
        Local: '#/schemas/<name>' or '#/enums/<name>'.
        Global: bare node ID (e.g. orders.DomainModel.order).
        Mutually exclusive with type.
    nullable:
      type: boolean
    cardinality:
      type: string
      enum: [one, many]
  oneOf:
    - required: [type]
      not: { required: [$ref] }
    - required: [$ref]
      not: { required: [type] }
```

### 5d. `format: node-ref` in template property definitions

Wherever a template property accepts a local name or global node ID as its value, annotate with `format: node-ref`. This allows the server to identify which properties to resolve and annotate in API responses.

**Example (`APIEndpoint.yaml`):**
```yaml
request:
  type: string
  format: node-ref

responses:
  type: object
  additionalProperties:
    type: string
    format: node-ref
```

Node data files use the same `'#/schemas/<name>'` / `'#/enums/<name>'` prefix convention as field `$ref` values, making references immediately obvious. Global node IDs remain bare strings. The `#/` prefix must be single-quoted in YAML (same quoting rule as field `$ref` values).

```yaml
# node data — APIEndpoint properties
properties:
  method: POST
  path: /orders
  request: '#/schemas/create-order-request'
  responses:
    "201": '#/schemas/create-order-response'
    "400": '#/schemas/problem-detail'
```

The server walks template property definitions, finds `format: node-ref`, strips the `#/schemas/` or `#/enums/` prefix to determine the local name, resolves to a node ID, and returns `{ display, nodeId }` so the UI can render links. Resolution is explicit — no ambiguous 3-tier lookup:

```typescript
function resolveNodeRef(graph, node, rawValue) {
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
  if (graph.nodesById.has(rawValue)) return { display: rawValue, nodeId: rawValue }
  return { display: rawValue }
}

---

## 6. Schema View — `maps-to` Links

**Bug:** `edges` from the cluster API response are never passed to `SchemaCard`. The "Links" column renders `fieldDetails(field.properties)` which only reads properties and is blind to edges.

**Fix:**

1. In `app.jsx`, pass `edges` from the cluster response to `SchemaCard`:
   ```jsx
   <SchemaCard
     key={templateName}
     title={templateName}
     nodes={groupNodes}
     allNodes={children}
     edges={edges}
   />
   ```

2. Thread `edges` through `SchemaCard` → `SchemaFieldRows`.

3. In `SchemaFieldRows`, for each field, filter edges for `maps-to` entries where `from === field.id`. Render each as a clickable link:
   - Display text: the local field name from the `to` node ID (last segment)
   - Navigate to: the owning node ID (strip `.fields.<name>` from `to`)

```jsx
const mapsTo = (edges ?? []).filter(e => e.from === field.id && e.type === 'maps-to');
// render in the links column:
mapsTo.map(e => {
  const targetNodeId = e.to.replace(/\.fields\.[^.]+$/, '');
  const targetFieldName = e.to.split('.').pop();
  return <a key={e.to} onClick={() => navigate(targetNodeId)}>{targetFieldName}</a>;
})
```

---

## 7. Migration — Existing Node YAML Files

All field definitions in existing cluster YAML files must be updated from `scalarType`/`objectRef` to `type`/`$ref` syntax. Root `properties` blocks that contain `format: node-ref` values must also be updated to use `'#/schemas/<name>'` / `'#/enums/<name>'` prefix format. This affects the fixture graph and any real graph data.

**Before:**
```yaml
id:
  scalarType: uuid
status:
  objectRef: order-status
items:
  objectRef: order-line-item
  cardinality: many
```

**After:**
```yaml
id:
  type: uuid
status:
  $ref: '#/enums/order-status'
items:
  $ref: '#/schemas/order-line-item'
  cardinality: many
```

Global node ID refs (no local block match) become bare strings without `#/`:
```yaml
sharedSchema:
  $ref: shared.component.Schema.name
```

---

## 8. `$ref` as a YAML Property Key — Loader & Writer Concerns

`$ref` is used as a data property key in node files for familiarity with OpenAPI. JSON Schema validators (ajv, etc.) correctly handle `$ref` as a property name under a `properties:` schema without treating it as a schema composition directive — it is only interpreted as a keyword when it appears at schema level, not in data being validated. This is safe for future linter use.

**Constraint:** Template schema files should avoid using JSON Schema `$ref` for internal schema composition (e.g. `$ref: '#/$defs/BaseField'`) while `$ref` is also defined as a valid data property name in the same file. Doing so would create two meanings of `$ref` in one document. If template schemas grow complex enough to need DRY reuse, revisit this.

**Node identity:** Node files use `id:` (not `$id:`). `$id` in JSON Schema sets a base URI for schema reference resolution — node files are data instances, not schema documents, and their IDs are dot-notation graph addresses, not URIs. `id:` is unambiguous and universally understood.

**Critical YAML quoting rule:** `#` begins a YAML comment when unquoted, so `$ref: #/schemas/order-status` would silently discard the value. Local ref values starting with `#/` MUST always be quoted:

```yaml
# Wrong — value treated as comment, parsed as null
$ref: #/schemas/order-status

# Correct
$ref: '#/schemas/order-status'
```

**Round-trip fidelity:** The loader and any file writer must both handle this correctly:

- **Loader (read):** YAML library (e.g. `js-yaml`) reads `$ref` as a plain key and the quoted string value normally. No special handling needed.
- **File writer (write):** When serializing field definitions back to YAML, values that start with `#/` must be emitted as single-quoted strings. Most YAML serializers will quote `#`-prefixed strings automatically (since they contain a comment character), but this must be verified and enforced — do not rely on default serialiser behaviour.

---

## What Does Not Change

- Node cluster YAML files (`schemas:`, `enums:`, `properties` blocks) — structure unchanged except field `type`/`$ref` syntax (covered in §7)
- Edge files — `maps-to` at field level is correct; `reads` at node level is correct
- Resolution logic — same three-tier lookup; `$ref` syntax makes the local/global distinction explicit in the data
- `cardinality` property — retained as domain concept
