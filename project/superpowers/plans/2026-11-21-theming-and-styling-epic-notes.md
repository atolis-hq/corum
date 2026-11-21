# Theming and styling epic: handover notes

Status: not started. This is a handover, not a design. It records what is already known so the work can be picked up later. No extra research or design was done when writing it. Related: `project/adrs/ADR-010-ui-plugin-architecture.md`, `project/superpowers/plans/2026-11-20-ui-plugins-followup-issues.md`.

## Intent (from the product owner)

- The UI will support user-selectable **themes** (light and dark, plus specific colour themes) and **alternative layouts**. This is a fundamental part of the interface, so it needs a deliberate contract, not ad-hoc styles.
- Everything should be driven by **tokenized CSS** that themes and layouts can hook into or extend.
- Hard-coded colours should be pulled into the tokenized stylesheets.
- Plugins should adopt the **standard styling and DOM structure** so the global stylesheet styles them without the plugin changing. Plugins are **not forced** to use any SDK component; reusable components are an optional convenience that emits the standard markup.
- Colours for **edge types and kinds are defined in packs** and that is intended: pack-level colour coding stays. Template-supplied colours (`ui.colour`) must keep working in every theme.
- A **style guide** (panels, tokens and states in one place) is wanted, so plugin authors and designers have a single reference.
- A **theme switcher** is needed in the UI: there is none today.

## What we already know (measured 2026-11-21)

- Light and dark themes already exist, switched by `[data-theme="light"]` / `body[data-theme="dark"]` in `web/style.css`, with 29 CSS custom properties (surfaces such as `--paper`, `--paper-2`, `--paper-3`; text `--ink` to `--ink-4`; `--rule`, `--rule-2`; `--accent`, `--accent-2`, `--accent-ink`; `--ok`, `--warn`; `--radius`).
- `web/style.css` uses `var(--...)` about 264 times but still contains about 28 hard-coded hex colours.
- JavaScript contains about 44 hard-coded hex colours: `web/builtin/graph/constants.js` (24), `web/app.jsx` (12), `web/sdk/schema-rows.js` (5), `web/builtin/graph/toolbar.js` (2), `web/builtin/graph/rf-builders.js` (1). The kind palette in `web/graph-utils.js` (`KIND_PALETTE`) is also hard-coded.
- Edge-type styling is duplicated: `EDGE_TYPE_STYLES` in `web/app.jsx` and `EDGE_STYLES` / `EDGE_PILL_STYLES` in `web/builtin/graph/constants.js`.
- Plugins already rely on global host classes by convention (`card`, `card-head`, `label-xs`, `meta-strip`, and the SDK node-link classes `quick-links`, `quick-link`, `open-in*`). Nothing documents or tests them.
- No theme switcher exists in the UI.
- The plugin system gives a natural home for a style guide (a built-in plugin page) and possibly for themes (a manifest contribution), but neither was decided.

## Fixes and work that need to happen

1. **Token audit and extraction.** Move every hard-coded hex colour (CSS and JS) behind tokens. Keep pack-defined edge-type, kind and template colours as data; make sure they render acceptably in every theme (contrast, tints).
2. **Single definition of edge-type styling** (removing the app.jsx / Graph duplication), driven by tokens plus pack data.
3. **Document the tokens and standard markup** as the plugin styling contract, and add a test that fails when a documented token or class is removed or renamed.
4. **Theme switcher** in the UI (persisted choice), and the mechanism for adding more themes than light and dark.
5. **Alternative layouts** selectable on the shell.
6. **Style guide page** rendering every token, panel, tag, table, menu and state in the current theme; usable as a visual-regression target.
7. **Optional SDK layout components** (`Card`, `PageHeader`, `MetaStrip`, ...) that emit the standard markup, if still wanted after the contract exists.
8. **Guard rail:** a ratchet test (see `test/architecture.test.ts` once it lands) that counts hard-coded hex colours in JS and only allows the number to go down, so the work cannot regress while it is in progress.

## Open questions (not yet decided)

- Token naming scheme (semantic names such as surface, text, accent, state, edge types) and versioning of the contract.
- Where themes live and how they are contributed (plugin manifest contribution type, pack content, or core files), and whether a theme is chosen per user or per graph.
- How alternative layouts are selected and what they may change.
- Whether kind colours (currently a hashed fixed palette for kinds without a pack colour) should become pack-defined everywhere or stay a fallback palette; confirm how pack colours are declared today before designing.
- Whether the style guide is a host route or a built-in plugin.

## Suggested first step

Write ADR-011 (tokens, markup conventions, themes and layouts) before building, using the questions above, then do the token audit (item 1) behind the ratchet test.
