# Concepts

## The graph

A Corum graph is a set of **nodes** connected by typed **edges**. Nodes
describe the things in your design; edges describe how they relate. Out of the
box Corum ships with software architecture in mind: APIs, domain models, events,
schemas and their fields, with edges such as an endpoint `calls` a domain
operation or a response field `maps-to` a domain field.

> **Not limited to architecture.** Node types and edge types come from
> [packs](templates-and-packs.md), not from the engine. The architecture packs
> are just the ones that ship first. A pack can model anything that has
> structure and relationships: data platforms, infrastructure, org
> structures, processes, and so on.

### Everything has an identity

Every node has a stable ID, **all the way down to individual fields**. Because a
field is a node like any other, relationships can be drawn between fields, not
just between whole services or schemas. That's what makes field-level lineage
possible, and it applies to whatever your templates define, not only fields.

### Relationships are optional

Nothing forces you to connect anything. A graph can start as a bare inventory
of nodes and gain edges as understanding grows, so it is useful at every level
of completeness. Imports and agents add relationships where they are known;
lack of an edge means "not modelled", not "unrelated".

### All state lives in Git

The graph, its history, its branches, its packs and its config are all files
in a Git repository. There is no database, server or service to run beyond
Corum itself, and the MCP server and web UI just read and write that repository
(a remote repository is cached as a local clone). Backup, access control, review and audit are whatever you
already use for Git.

> You don't author these files by hand. Agents write them through MCP tools,
> which validate every change. This page shows the formats so you can read and
> review what the agent produces.

## Nodes

Every node has:

- an **ID**, such as `orders.APIEndpoint.create-order`
- a **template** that says what kind of node it is (`APIEndpoint`, `DomainModel`, `Field`...)
- **properties** defined by that template
- a **state** and a **stability**

### IDs

IDs encode ownership as a dot path. A root node is
`component.Template.name`; anything it owns appends to that path:

```
orders.DomainModel.order                                  root node
orders.DomainModel.order.schemas.order                    owned schema
orders.DomainModel.order.schemas.order.fields.id          owned field
```

Segments use letters, digits, `_` and `-`. `__` is reserved for edge IDs.

### State and stability

| Field | Values | Default |
| --- | --- | --- |
| `state` | `draft`, `proposed`, `agreed`, `future`, `removed`, `implemented` | `proposed` |
| `stability` | `unstable`, `stable`, `deprecated` | `unstable` |

State tracks where a design is in its lifecycle; stability tracks how safe it
is to depend on.

## Design and derived data

Nodes in a graph come from two places, and Corum keeps track of which:

- **Design**: what you intend to build, created by people and agents on
  branches, usually with `state` of `draft`, `proposed`, `agreed` or `future`.
- **Derived**: what exists today, brought in from specs or code extraction by
  [imports](importing.md), usually with `state: implemented`.

Imported nodes carry provenance: where they came from (`extractedFrom`), how
sure the source is (`derivation`: `determined` for contract-derived,
`inferred` for heuristic or LLM-derived, `manual` for hand-entered) and which
tool produced them (`derivedBy`). Tools hide provenance by default; ask for it
when you need to trace a node to its source (`include_provenance`).

Re-importing refreshes derived facts without erasing the design decisions
layered on top; see [Re-importing](importing.md#re-importing). Moving a
design forward is a Git merge: a branch that proposes a change merges, and once the code ships,
extraction brings in the matching derived nodes (by convention marked
`implemented`).

## Clusters

A **cluster** is one YAML file defining a root node and everything it owns. A
template can declare owned sections (for example a `DomainModel` owns
`schemas`, `enums`, `invariants` and `operations`), and each entry in those
sections becomes its own node.

```yaml
id: orders.APIEndpoint.create-order
template: APIEndpoint
metadata:
  component: orders
  state: agreed
  stability: stable
properties:
  method: POST
  path: /orders
  request: '#/schemas/create-order-request'
schemas:
  create-order-request:
    fields:
      customerId:
        type: uuid
        nullable: false
      items:
        $ref: '#/schemas/order-line-item'
        nullable: false
        collection: array
```

This one block produces an endpoint node, schema nodes, and a node per field. References such as
`#/schemas/order-line-item` resolve to the owned schema; a bare node ID points
at a node elsewhere in the graph.

On disk, clusters live under
`.corum/graph/nodes/<component>/<Template>s/<name>.yaml`.

## Edges

Edges connect two node IDs with a type. Edge IDs take the form
`{from}__{type}__{to}`.

- **Derived** edges are generated automatically at load time and never written
  by hand. Ownership produces structural edges (`has-field`, `has-value`)
  from each parent to the children in its cluster. Properties that reference
  another node by its global ID (for example an endpoint's response schema
  living in another component) produce a `uses-type` edge. References to
  things inside the same cluster (`#/schemas/...`) need no edge.
- **Explicit** edges are everything else: relationships that cross node
  boundaries, such as `calls` or `maps-to`. They are stored in
  `.corum/graph/edges/`.

```yaml
edges:
  - from: orders.APIEndpoint.create-order
    to: orders.DomainModel.order.operations.place
    type: calls
```

Core edge types:

| Type | Meaning |
| --- | --- |
| `triggers`, `produces`, `reads`, `calls` | Runtime and behavioural relationships |
| `uses-type`, `implements` | Typing and realisation |
| `maps-to`, `derived-from` | Lineage between nodes or fields |
| `renamed-from` | Hidden trail left by renames |
| `has-field`, `has-value` | Structural ownership |

Packs can add more types. Each belongs to a category (`structural`,
`semantic` or `lineage`), which controls how tools treat it.

## Lineage

Because fields are nodes, `maps-to` edges give you **field-level lineage**: this
API response field comes from that read-model column, which comes from that
domain field. Agents can traverse lineage in either direction to answer impact
questions before a change is made.

The graph holds *modelled* relationships. A missing edge doesn't prove there is
no relationship, so agents treat similarity as a hypothesis to verify.

## Branches

Because the graph is in Git, a branch is a design alternative. You can
develop a proposed design on a branch and diff it against the default branch.
You can also compare across several branches at once, to see where proposals
conflict (two branches changing the same node) or complement each other
(changes that touch different parts of the graph and could be combined), and
analyse impact before anything merges. Renames leave an alias trail, so
references to old IDs from other branches or imports still resolve.

## Where to go next

- [Templates and packs](templates-and-packs.md) explains where node types come from.
- [Working with agents](working-with-agents.md) shows how to read and change the graph.
