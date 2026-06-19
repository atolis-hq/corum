# Compact Names + Debug Mode

**Date:** 2026-06-19
**Status:** Approved

## Problem

Qualified node IDs (e.g. `orders.DomainModel.order.schemas.OrderItem`) appear in several places in the web UI — the type column, details/links column, and schema section headers. This is explicit but hurts readability for the normal browsing workflow. The full ID is useful for: manual file editing (escape hatch) and sharing context with Claude when debugging.

## Design

### Default (compact) mode

All places that currently show a qualified name display only the final/local segment instead:

| Location | Current | Compact |
|---|---|---|
| Type column (`fieldType`) | `orders.DomainModel.order.schemas.OrderItem` | `OrderItem` |
| Details column (`fieldDetails`) | `ref orders.DomainModel.order.schemas.OrderItem` | `ref OrderItem` |
| Schema ref inside link summary | already local via `fieldLocalName` — no change | — |
| Nested field prefix (`address.street.city`) | already uses local segments — no change | — |
| Schema section header subtitle | `orders.DomainModel.order.schemas.Order` (small mono) | unchanged — small enough to read as metadata |

The `title` attribute is set on every shortened element so the full qualified ID is visible on native hover.

### Debug mode

A toggle button lives in the **bottom of the nav rail** (low-traffic, but findable). State is persisted in `localStorage` under the key `corum:debugMode`. A subtle visual indicator (the button stays highlighted) shows debug mode is active.

When active:

- All qualified names render in full (the compact truncation is skipped)
- A **copy-to-clipboard button** appears next to:
  - The node page `h1` (copies `root.id`)
  - Each schema section header (copies `schema.id`)
  - Each enum section header (copies `enumNode.id`)
- Copy button uses `navigator.clipboard.writeText`. After copy, the button shows a brief checkmark (e.g. 1.5 s) then resets.

### What does not change

- Nested field name prefix accumulation (`address.street.city`, `items[].name`) — already uses local segments; no change in either mode
- Array/map suffixes (`[]`, `{}`, `{[]}`) — part of the prefix/type logic, unaffected
- Schema section header subtitle showing `schema.id` in small mono text — kept in both modes (it is small enough not to be noisy)
- Nav rail node labels — already use `displayName` (final segment); no change

## Implementation notes

- A `useDebugMode()` hook (or a simple `useState` + `localStorage` read) at the `App` level, passed down via props or a React context.
- `refName()` and `fieldType()` gain a `compact` boolean parameter (or the debug flag is threaded through). When `compact = true`, extract the final segment from a qualified ref string the same way `refLocalSchemaName` does.
- The copy button is a small inline component: `<CopyButton value={nodeId} />` — renders an icon, handles click, manages the transient checkmark state locally.
- The nav rail toggle button sits below the existing nav items, visually separated.

## Out of scope

- Keyboard shortcut for debug toggle (can be added later)
- Showing field-level copy buttons (schema/cluster ID is sufficient to locate a field in the source files)
- Any change to the MCP serialisation layer — this is purely a display concern
