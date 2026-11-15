# Corum documentation

Corum is a Git-native design graph for service architecture. You work with it
through an AI agent connected over MCP; the agent reads and writes the graph
for you, and every change lands in Git.

> Corum is still evolving. Pages covering areas that are likely to change carry
> a **Status** note.

## Suggested reading order

1. [Getting started](getting-started.md) - install, initialise a project, connect an agent.
2. [Concepts](concepts.md) - nodes, edges, clusters, IDs, branches and lineage.
3. [Templates and packs](templates-and-packs.md) - how node types are defined and extended.
4. [Importing](importing.md) - bring in OpenAPI, AsyncAPI and extractor output.
5. [Working with agents](working-with-agents.md) - asking questions and making changes.

## Reference

- [MCP tools](mcp-tools.md) - every tool, client configuration, output options.
- [CLI](cli.md) - every command, including `lint` and the web UI.
- [Configuration](configuration.md) - `.corum/config.yaml`, environment variables, file vs Git source.

## Other contents

- [spec-examples/](spec-examples/) - sample OpenAPI and AsyncAPI specs for trying out imports.

Design decisions, plans and specs live in [../project](../project); they are
internal records rather than user guides.
