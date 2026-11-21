<div align="center">


  <img src="https://raw.githubusercontent.com/atolis-hq/corum/refs/heads/main/assets/corum-logo.svg" alt="logo" width="200" height="auto" />
  <h1>Corum</h1>
  
  <p>
    Unified system design surface, built for agents and humans.
  </p>
  
  
<!-- Badges -->
<p>
  <a href="https://github.com/atolis-hq/corum/commits/main">
    <img src="https://img.shields.io/github/last-commit/atolis-hq/corum" alt="last update" />
  </a>
  <a href="https://github.com/atolis-hq/corum/actions/workflows/ci-cd.yml">
    <img src="https://github.com/atolis-hq/corum/actions/workflows/ci-cd.yml/badge.svg" alt="CI/CD status" />
  </a>
  <!-- <a href="https://github.com/atolis-hq/corum/network/members">
    <img src="https://img.shields.io/github/forks/atolis-hq/corum" alt="forks" />
  </a>
  <a href="https://github.com/atolis-hq/corum/stargazers">
    <img src="https://img.shields.io/github/stars/atolis-hq/corum" alt="stars" />
  </a> -->
  <a href="https://github.com/atolis-hq/corum/issues/">
    <img src="https://img.shields.io/github/issues/atolis-hq/corum" alt="open issues" />
  </a>
  <a href="https://github.com/atolis-hq/corum/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/atolis-hq/corum.svg" alt="license" />
  </a>
  <a href="https://github.com/atolis-hq/corum/tags">
    <img src="https://img.shields.io/github/v/tag/atolis-hq/corum" alt="latest tag" />
  </a>
  <a href="https://www.npmjs.com/package/@atolis-hq/corum">
    <img src="https://img.shields.io/npm/v/%40atolis-hq%2Fcorum" alt="npm version" />
  </a>
</p>
</div>

<br />


Corum is a Git-native, extensible design graph for software architecture. It models components as nodes with typed edges, and exposes the graph through MCP tools so AI assistants can reason about and evolve your architecture. Corum provides several out of the box schemas (such as APIs, domain models, events, schemas, fields) but can be customised to model any data structure.  The graph enables modelling data lineage at object and field level, and the branching model enables multiple simultaneous designs with cross branch impact analysis.

## Install

```bash
npm install -g @atolis-hq/corum
```

Or run without installing:

```bash
npx @atolis-hq/corum <command>
```

**Windows:** If you see an "execution policy" error in PowerShell, run this once:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

This is a standard one-time setup step for Node.js development on Windows. Alternatively, `npx @atolis-hq/corum <command>` works without any setup on all platforms.

## Update

```bash
npm update -g @atolis-hq/corum
```

## Quick Start

Scaffold a new project in the current directory:

```bash
corum init
```

This creates `.corum/config.yaml`, scaffolds a graph at `.corum/graph/`, and downloads the official template packs (`core`, `domain`, `rest`, `messaging`). Then start the MCP server:

```bash
corum mcp
```

If you only want the web UI:

```bash
corum web
```

## Documentation

- [Getting started](docs/getting-started.md) - install, initialise, connect an agent
- [Concepts](docs/concepts.md) - nodes, edges, clusters, IDs, lineage, branches
- [Templates and packs](docs/templates-and-packs.md) - defining and extending node types
- [UI plugins](docs/plugins.md) - configuring and creating web UI plugins
- [Importing](docs/importing.md) - OpenAPI, AsyncAPI and extractor output
- [Working with agents](docs/working-with-agents.md) - reading and changing the graph
- [MCP tools](docs/mcp-tools.md), [CLI](docs/cli.md), [Configuration](docs/configuration.md) - reference

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for build, test, and local development instructions.


## Issues & Feature Requests

Found a bug or have an idea for Corum? [Open an issue](https://github.com/atolis-hq/corum/issues/new) —
bug reports and feature requests are both welcome.

## License

Corum is licensed under the [Apache License 2.0](LICENSE).
