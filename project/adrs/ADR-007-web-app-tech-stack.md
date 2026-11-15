# ADR 007 — Web App Tech Stack

**Date:** 2026-04-18  
**Status:** Accepted

## Decision

Use Express (already a transitive dependency) to serve the web UI from the MCP server process. Build the frontend with CDN React + Babel — no build step, same pattern as the existing wireframes.

## Context

The MCP server loads the graph. The web UI needs to query that data. Options were:

1. **Express + CDN React** — no new dependencies, no build step, files are plain `.jsx` editable directly
2. **Hono + CDN React** — lighter HTTP layer, but Hono is less familiar and offers no practical advantage here
3. **Express + Vite/bundled React** — proper TypeScript in the frontend, better tooling, but adds a build step and complexity that is premature at this stage

## Rationale

Option 1 was chosen because:
- Express is already present in the dependency tree
- CDN React mirrors the existing wireframe approach — primitives and CSS transfer directly
- No build step means less friction during early iteration
- Runtime-loadable plugins (drop a `.jsx` file, no rebuild) are simpler with this approach than with a bundler

## Plugin extensibility

The plugin system (`window.CorumPlugins` registry) is designed to be stable across a future migration to a bundler. Template name is the only coupling point. When TypeScript becomes a priority, the core app can move to a bundled build without breaking existing plugin files.

## Consequences

- No TypeScript in the frontend for now
- CDN dependency at runtime (React, Babel) — acceptable for an internal tool
- Migration to a bundler is straightforward when needed; the plugin contract doesn't change
