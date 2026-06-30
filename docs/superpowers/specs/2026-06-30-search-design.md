# Search — Design Spec

**Date:** 2026-06-30

## Overview

A Spotlight-style quick-nav modal for the Corum web UI, triggered by `Ctrl+K` / `Cmd+K` or by focusing a search input in the TopBar. Users type to fuzzy-search nodes by ID and navigate directly to any cluster root.

## Scope

- Search navigable cluster root nodes only (nodes where `parentId` is `undefined`)
- Fields, owned schemas, enum values, and other child nodes are excluded for now
- No backend changes — all filtering/matching runs in-browser against the already-fetched `nodes` array

## TopBar Search Trigger

A real `<input>` element sits on the right side of the TopBar (orange bar). Visual design:
- Slightly translucent/frosted appearance over the orange background
- Magnifying glass icon on the left inside the input
- Placeholder: `Search graph...`
- `⌘K` hint pill aligned to the right inside the input

Behaviour:
- `onFocus` (click or tab) immediately opens the modal, blurs the TopBar input, and moves focus to the modal input
- If the user has typed a character before `onFocus` fires, that value is carried across as the modal's initial query
- After modal closes, focus returns to the TopBar input

## Hotkey

`Ctrl+K` (Windows/Linux) and `Cmd+K` (Mac) registered on `document` via `useEffect` in `App`. Opens the modal with an empty query.

## Modal Overlay

- Fixed full-viewport backdrop: `rgba(0,0,0,0.4)`, short CSS fade-in transition
- Modal card: ~560px wide, centered horizontally, positioned in the upper-middle third of the viewport (Spotlight-style, not dead center)
- Rounded corners, subtle drop shadow, `--paper` background
- Top of card: full-width search `<input>`, autofocused, no individual border (card is the container)
- Below input: scrollable results list, max 8 rows visible before scrolling
- No query → empty results list (no results shown until user types)
- Query with no matches → "No results" empty state

Dismiss behaviour:
- `Escape` closes, returns focus to TopBar input
- Click on backdrop closes
- Navigating (Enter or click) closes

## Matching & Scoring

- **Search corpus:** `node.id` (full dot-path, e.g. `orders.DomainModel.order`), case-insensitive
- **Algorithm:** fuzzy subsequence — every character in the query must appear in order in the node ID
- **Score:** length of the longest consecutive run of matched characters (higher = better match); ties broken by shorter ID length
- **Pipeline:** filter to subsequence matches → sort descending by score → take top 50 → display top 8

## Result Rows

Each row:

```
[TemplateBadge]  [display name]                    [component – faded]
```

- `TemplateBadge`: uses `template.ui.colour` (falls back to `--ink-4`), same as nav tree
- Display name: `node.id.split('.').pop()` — last dot-segment, font-weight 500
- Component: `node.component`, right-aligned, `--ink-3` colour, smaller font
- Full `node.id` available as `title` tooltip on hover
- Selected row: `--paper-2` highlight background (or light accent tint)
- Hovered non-selected row: `--paper-2` background

## Keyboard Navigation

Inside the modal:
- `↓` / `↑` move selected index; wraps at top and bottom
- `Enter` navigates to selected result, closes modal
- `Escape` closes without navigating
- Mouse click on row navigates and closes
- First result (index 0) is pre-selected as soon as results appear

## File Structure

### New file: `web/search.jsx`

Exposes `window.CorumSearch = { SearchModal }`.

Contains:
- `fuzzyMatch(query, id)` — returns `{ score }` or `null`
- `searchNodes(nodes, templates, query)` — filters, scores, returns top 8
- `SearchModal({ nodes, templates, onNavigate, onClose })` — the modal component

### Changes to `web/index.html`

Add `<script type="text/babel" src="search.jsx"></script>` before `app.jsx`.

### Changes to `web/app.jsx`

- `App` gains:
  - `searchOpen` boolean state
  - `searchQuery` string state (carries value from TopBar input to modal)
  - `document` keydown listener (`Ctrl+K` / `Cmd+K`) → opens modal
  - `SearchModal` rendered conditionally at root level
- `TopBar` gains:
  - Search `<input>` on right side
  - `onFocus` handler opens modal, transfers value

No changes to `server.ts`, `nav.js`, `router.js`, or `primitives.jsx`.

## Out of Scope

- Field/child node search (deferred — requires walking parent chain and navigating to cluster root)
- Component-scoped filtering (e.g. `@orders` prefix)
- Grouping results by component
