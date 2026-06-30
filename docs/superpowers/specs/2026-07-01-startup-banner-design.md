# Startup Banner Design

**Date:** 2026-07-01  
**Scope:** `src/web/server.ts` startup logging + MCP server equivalent

## Goal

Replace the plain `[corum web] config ...` log lines with a branded terminal banner that shows the Corum logo, version, config, and active services at startup.

## Visual Design

```
  · ·   ⡎⠑ ⡎⢱ ⣏⡱ ⡇⢸ ⡷⢾
 · ◉ ·  ⠣⠔ ⠣⠜ ⠇⠱ ⠣⠜ ⠇⠸
  · ·   v0.1.0
  ──────────────────────────────────────────
  graphPath  C:\...\prl\.corum\graph
  webDir     C:\...\corum\web
  port       3030

  ● web   http://localhost:3030
```

### Colour

All colour is applied via ANSI true-color escape codes (`\x1b[38;2;R;G;Bm` / `\x1b[0m`).

| Element | Colour |
|---|---|
| Logo dots (`· ·` / `· ◉ ·`) | coral `#e8614a` |
| Braille CORUM text | coral `#e8614a` |
| Active service dot `●` | coral `#e8614a` |
| URL | coral `#e8614a` |
| Separator line `──...` | default terminal colour |
| Config rows (keys + values) | default terminal colour |
| Version `v0.1.0` | default terminal colour |

### Layout

Three logo lines on the left, three content lines on the right, flush-left aligned:

```
  · ·   ⡎⠑ ⡎⢱ ⣏⡱ ⡇⢸ ⡷⢾   ← line 1
 · ◉ ·  ⠣⠔ ⠣⠜ ⠇⠱ ⠣⠜ ⠇⠸   ← line 2
  · ·   v{version}            ← line 3
```

Config block starts on line 4 with no additional left-indent beyond the leading two spaces used throughout.

## Behaviour

### Web server (`startWebServer`)

Show when `options.port !== 0` (existing guard, unchanged). Replaces the four current `logger()` calls with a single `printBanner()` call.

Config rows shown:
- `graphPath` — absolute path to graph directory
- `webDir` — absolute path to web static files directory
- `port` — port number (integer)

Services line: `● web   http://localhost:{port}`

### MCP server

The MCP server (`src/mcp/index.ts`) currently has no startup banner. Add the same `printBanner()` call with:
- Config rows: `graphPath` only (no port/webDir)
- Services line: `● mcp   stdio`

### Implementation

Extract a shared `printBanner()` function into a new file `src/banner.ts`:

```ts
printBanner(options: {
  version: string        // from package.json
  config: Array<{ key: string; value: string }>
  services: Array<{ name: string; url: string }>
  logger?: (line: string) => void  // defaults to console.error
}): void
```

The function reads `version` from a constant rather than dynamically importing `package.json` at runtime, to keep the build simple. The version string is inlined at build time or read from a generated `src/version.ts`.

### Colour safety

No colour when `NO_COLOR` env var is set (honour the [no-color.org](https://no-color.org) convention). Check `process.env.NO_COLOR` before emitting ANSI codes.

## Out of scope

- Detecting whether the other service (mcp/web) is running from within each process
- Interactive terminal features
- Windows vs Unix line-ending differences (Node's `console.error` handles this)
