# Concepts

## The graph

A Corum graph is a set of **nodes** connected by typed **edges**. Nodes
describe the things in your architecture: APIs, domain models, events,
schemas and their fields. Edges describe how they relate: an endpoint
`calls` a domain operation, a response field `maps-to` a domain field.

The graph lives as YAML files in a Git repository. Git is the database, so
history, branching, review and access control come from Git.

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

This one block produces an endpoint node, schema nodes, and a node per field,
all linked by structure automatically. References such as
`#/schemas/order-line-item` resolve to the owned schema; a bare node ID points
at a node elsewhere in the graph.

On disk, clusters live under
`.corum/graph/components/<component>/<Template>s/<name>.yaml`.

## Edges

Edges connect two node IDs with a type. Edge IDs take the form
`{from}__{type}__{to}`.

- **Structural** edges (`has-field`, `has-value`) are generated from ownership.
- **Explicit** edges are stored in `.corum/graph/edges/` and cross node
  boundaries.

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
develop a proposed design on a branch, diff it against the default branch, and
analyse impact across branches before merging. Renames leave an alias trail, so
references to old IDs from other branches or imports still resolve.

## Where to go next

- [Templates and packs](templates-and-packs.md) explains where node types come from.
- [Working with agents](working-with-agents.md) shows how to read and change the graph.
