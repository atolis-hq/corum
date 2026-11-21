# Templates and packs

## Templates

A **template** defines a kind of node: which properties it accepts, what it
can own, and which edge types it may use. `APIEndpoint`, `DomainModel`,
`Schema` and `Field` are all templates. Templates live as YAML under
`.corum/packs/<pack>/templates/`.

The parts of a template that matter most:

| Key | What it does |
| --- | --- |
| `name` | Template name, used in node IDs and in `template:` |
| `extends` | Inherit from another template (`IntegrationEvent` extends `Event`) |
| `properties` | JSON Schema for the node's properties; the linter checks nodes against it |
| owned sections | Sections such as `schemas`, `fields`, `operations`. Each declares an `item-template`, and every entry becomes a child node |
| `edge-types` | Which edge types the template may use as `outgoing`, `incoming` or `supports` |
| `info.role` | Engine-level behaviour; see below |
| `ui` | Icon, colour and display properties for the web UI |

A trimmed example:

```yaml
name: DomainModel
properties:
  type: object
  properties:
    description: { type: string }
    schema: { type: string, format: node-ref }
invariants:
  item-template: Invariant
operations:
  item-template: DomainOperation
edge-types:
  outgoing: [has-field, has-value, produces]
  supports: [reads, derived-from, maps-to]
```

### Roles

Some templates declare an `info.role`: `field`, `value`, `type-container`,
`enum-container` or `mapping`. Corum's engine keys behaviour such as schema
collapsing and field lineage off roles, never template names. A template that
extends `Schema` inherits its role, so an `AvroSchema extends Schema` works with
lineage tools with no extra work.

### How node blocks become nodes

When a cluster is loaded, owned sections are materialised as child nodes with
IDs that extend the parent's, and structural edges (`has-field`, `has-value`)
are generated. See [Concepts](concepts.md#clusters).

## Packs

A **pack** is a bundle of templates, optional edge types and optional import
adapters, versioned and installed together.

```
.corum/packs/rest/
  pack.yaml          name, version, description, requires, templates, files
  templates/         one YAML file per template
  adapters/          import adapters (e.g. openapi.yaml)
  edge-types.yaml    optional extra edge types
  kinds.yaml         optional namespace kinds
```

```yaml
# pack.yaml
name: rest
version: "1.0.0"
description: "Templates for HTTP and REST services. Adapter: OpenAPI"
requires:
  - core
templates:
  - APIEndpoint
files:
  - adapters/openapi.yaml
```

Packs are loaded in dependency order, and templates are sorted by inheritance
before any graph content is parsed.

Packs can also bundle web UI plugins using `plugins` in `pack.yaml`. See
[Bundle a plugin with a pack](plugins.md#bundle-a-plugin-with-a-pack) for the
directory layout, required `files` entries and current source limits. Bundled
plugins execute JavaScript in the browser, so review them as part of deciding
whether to trust a pack.

### Official packs

| Pack | Provides | Import adapter |
| --- | --- | --- |
| `core` | `Schema`, `Field`, `EnumDefinition`, `EnumValue`, `Mapping`. Required by everything else | - |
| `domain` | `DomainModel`, `DomainOperation`, `Command`, `ReadModel`, `ValueObject`, `Invariant` | - |
| `rest` | `APIEndpoint` | OpenAPI |
| `messaging` | `Event`, `DomainEvent`, `IntegrationEvent` | AsyncAPI |
| `extract` | Interchange format schema (not installed by default) | `corum` interchange files |

### Installing and listing

```bash
corum pack install domain            # latest
corum pack install domain@v0.1.5    # a specific tag
corum pack list
```

Installing downloads the pack into `.corum/packs/`, adds it to
`.corum/graph/graph.yaml` and records it in `.corum/packs.yaml`.
`corum init` installs `core`, `domain`, `rest` and `messaging`.

### Custom edge types

A pack can add edge types in `edge-types.yaml`. Each needs a `category`
(`structural`, `semantic` or `lineage`) and may declare a `properties` schema
for data carried on the edge. Core types cannot be overridden. The category
decides how tools treat the type: summary counts, lineage defaults and
collapse filtering.

### Custom kinds

Every namespace (the first segment of a node ID) has one **kind**, which
classifies it and decides how tools label it. A pack can declare kinds in an
optional `kinds.yaml`:

```yaml
kinds:
  journey:
    label: Journey          # display label, required
    templates: [Journey, Step]   # optional, advisory
```

- Kind ids are free strings matched exactly, including case and punctuation.
- The `core` pack declares `component` (label `Component`). It is the built-in
  default, so it exists even when no pack declares kinds.
- Redeclaring a kind with an identical definition in another pack is fine;
  redeclaring it with a different definition is an error diagnostic.
- A namespace whose declared kind is not in the registry still loads. Lint
  warns, and the kind id is shown as its label.
- If a kind lists `templates`, lint warns when a namespace of that kind owns
  other templates. This is advisory only; the loader and write path never
  enforce it. `component` is unrestricted.
- A malformed `kinds.yaml` is an error diagnostic and does not stop loading.

Kinds are classification and display metadata only. Engine behaviour keys off
template roles, never kinds.

### Writing your own pack

Create a directory under `.corum/packs/`, give it a `pack.yaml` and templates,
and list it under `templatePacks` in `.corum/graph/graph.yaml`. Start by
extending a core template (for example `extends: Schema`) rather than
defining a new one, so you inherit its roles and behaviour. Run `corum lint` to
check the result. You can also ask your agent to draft a template, using
`list_templates` and `get_template` to study the existing ones.

> **Status:** pack authoring, the registry and versioning are still being
> developed. Expect details of `pack.yaml` and the registry to change.
