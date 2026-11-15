# Working with agents

Corum is designed to be driven by an AI agent through its [MCP
tools](mcp-tools.md). This page describes the workflow and the kinds of
requests that work well. You don't need to name tools; the agent chooses them.

The server also exposes a `usage-guide` MCP prompt that orients an agent on
graph structure and conventions.

## Reading the graph

Typical questions and the tools behind them:

| You ask | Agent typically uses |
| --- | --- |
| "What's in this graph?" | `get_graph_summary`, `get_graph_metadata` |
| "Find anything to do with refunds." | `search_nodes` |
| "Show me the Order model in full." | `get_cluster` |
| "What feeds `totalAmount` in the order response?" | `get_lineage`, `get_linked_fields` |
| "What does this branch change?" | `list_branches`, `diff_branch` |

Good habits to encourage:

- Orient first. The agent should call `get_graph_metadata` before traversing,
  to learn which templates and edge types exist.
- Prefer search to inventory listing for discovery.
- Treat the graph as modelled truth, not complete truth. Ask the agent to
  verify against source material when a missing edge matters.

## Making changes

All writes happen inside a **working session**:

1. `start_changes` opens a session, optionally on a new branch.
2. One or more mutations: create, update, rename, delete nodes and edges.
   Each is validated before it applies.
3. `pending_changes` shows the journal and a diff.
4. `commit_changes` lints and persists; `discard_changes` aborts.

You'd ask: "On a branch `feat/order-design`, rename the `invoice` schema to
`bill` and show me the diff." The agent does the rest, and you review the
diff before it commits.

While a session is open, reads reflect the session's uncommitted changes.

### Renames and deletes

- `rename_node` is the only rename path. It cascades through references and
  leaves a `renamed-from` trail. Replacing a cluster or importing never infers
  a rename.
- `delete_node` is a soft delete for nodes that exist on the default branch
  (marked `removed`, so consumers can see the intent) and a hard delete for
  nodes created on your branch.
- `apply_cluster` with `replace` is authoritative for a root's owned sections:
  absent children are deleted.

### Autosave and Git

| Source | `autosave` default | Behaviour |
| --- | --- | --- |
| Filesystem | on | Each change writes immediately; `commit_changes` lint-gates and closes the session. `discard_changes` doesn't undo what was already written. |
| Git | off | Changes stay in memory until `commit_changes`. With `autosave: true`, each change makes a `corum-wip:` checkpoint commit that is squashed on commit. |

See [Configuration](configuration.md) for source modes.

## Reviewing agent work

- Read the `pending_changes` diff before approving a commit.
- Run `corum lint` to catch property and edge-type violations.
- Open a pull request on the branch and review the YAML like code.
- Use the [web UI](cli.md#corum-web) to see the graph visually.

> **Status:** the session model, Git checkpointing and branch workflows are
> still changing.
