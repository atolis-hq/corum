# Getting started

Corum stores your service design as YAML files in a Git repository and exposes
it to AI agents through an MCP server. You normally don't edit those files by
hand: you connect an agent, and the agent reads and changes the graph through
Corum's tools.

## Install

```bash
npm install -g @atolis-hq/corum
```

Or run without installing:

```bash
npx @atolis-hq/corum <command>
```

**Windows:** if PowerShell reports an execution policy error, run
`Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` once, or use `npx`, which
needs no setup.

Update with `npm update -g @atolis-hq/corum`.

## Initialise a project

From the root of the repository that will hold your design:

```bash
corum init
```

This creates:

| Path | Purpose |
| --- | --- |
| `.corum/config.yaml` | Project configuration ([details](configuration.md)) |
| `.corum/graph/graph.yaml` | Graph definition, including which packs it uses |
| `.corum/graph/components/`, `.corum/graph/edges/` | Where nodes and edges are stored |
| `.corum/packs/` | Downloaded template packs: `core`, `domain`, `rest`, `messaging` |
| `.corum/packs.yaml` | Manifest of installed packs |

Commit `.corum/` to Git. The repository is the database; there is nothing else
to host.

## Connect an agent

Add Corum to your MCP client. For Claude Code or Claude Desktop:

```json
{
  "mcpServers": {
    "corum": {
      "command": "corum",
      "args": ["mcp", "--no-web"],
      "env": { "CORUM_GRAPH_PATH": "/path/to/your/.corum/graph" }
    }
  }
}
```

If you haven't installed globally, use `"command": "npx"` and
`"args": ["@atolis-hq/corum", "mcp", "--no-web"]`.

Drop `--no-web` if you also want the [web UI](cli.md#corum-web) alongside the
MCP server.

## Your first conversation

An empty graph has nothing to read yet, so start by describing what you want
modelled, or import an existing spec (see [Importing](importing.md)).

Things you can ask:

- "Give me an overview of the graph."
- "Model an `orders` component with an `Order` domain model: id, customer id,
  status and a list of line items."
- "Import `specs/orders.openapi.yaml` and show me which fields feed the `Order`
  model."
- "If I rename `customerId` on Order, what is affected?"

For changes, the agent opens a working session, makes the edits, shows you the
pending diff and commits. See [Working with agents](working-with-agents.md).

## Check your work

```bash
corum lint     # validate the graph against its templates
corum web      # browse the graph in a browser
```

Because everything is in Git, you can review agent changes as ordinary diffs
and pull requests.

## Next steps

- [Concepts](concepts.md) to understand what the agent is building.
- [Importing](importing.md) to populate the graph from existing specs.
