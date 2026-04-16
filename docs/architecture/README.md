# Architecture

**Status:** Draft v0.1
**Last updated:** 2026-04-16

This directory collects the high-level architecture for the Corum implementation. It is derived from the vision (`docs/vision/`), the product decisions (`docs/pdr/`), and the accepted architecture decisions (`docs/adr/`). Where this directory and an ADR disagree, **the ADR wins** — update this doc.

## Documents

| # | Document | Purpose |
|---|---|---|
| 01 | [Architecture Overview](01-architecture-overview.md) | The system at a glance — responsibilities, runtime model, clean-architecture layering, key invariants |
| 02 | [Packages and Folder Structure](02-packages-and-folder-structure.md) | The TypeScript monorepo layout, package boundaries, dependency rules, and per-package responsibilities |
| 03 | [Extensibility: Packs, Adapters, Plugins](03-extensibility-packs-adapters-plugins.md) | Template packs, spec adapters (the pluggable reader/writer evaluation), view plugins, output plugins |
| 04 | [Libraries, Tooling and Testing](04-libraries-tooling-and-testing.md) | Open source dependencies to adopt, build/tooling choices, and the testing strategy |

## Where to start building

See [01 — Architecture Overview § Build sequence](01-architecture-overview.md#build-sequence). The short version: build inward-out starting from the `@corum/schema` logical model, then the file format, then the graph engine, then the linter and MCP/CLI surfaces. The React UI (`@corum/ui-*`, `@corum/web`) is explicitly deferred.

## Why TypeScript

- The system exposes a React web app alongside the MCP server and CLI — code reuse for types, validation, renderers, and the template-pack loader is meaningful.
- MCP, JSON Schema, YAML, OpenAPI, AsyncAPI, GraphQL SDL, and Git tooling all have first-class TypeScript libraries.
- Agents and IDE tooling in the ecosystem we're targeting (Claude Desktop, Cursor, VS Code) are node-native.
- Lowers the barrier for contributors writing template packs and adapters.
