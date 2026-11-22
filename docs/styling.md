# Styling

The styling contract is [ADR-011](../project/adrs/ADR-011-design-tokens-themes-and-layouts.md). This page
documents the parts plugin and pack authors rely on. Every token below is also tracked by
`test/architecture.test.ts` and `test/css-tokens.test.ts`.

## Rules

- Scripts contain no colour literals, and no inline visual properties (colour, background, border, font, shadow,
  opacity). Use a class from `web/style.css` or assign a custom property (`--*`). Layout-dynamic values such as
  `width`, `transform` or `gap` may stay inline. Both rules are enforced at zero by the architecture test.
- Use the semantic tokens (`var(--background)`, `var(--foreground)`, `var(--border)`, `var(--accent)`, ...).

## Pack colours

Packs define colours as data: `ui.colour` on templates and `colour` on edge types. A colour is a `#rrggbb` string,
or `{ light: "#rrggbb", dark: "#rrggbb" }` which is chosen by the active theme's colour scheme (CSS `light-dark()`).

The host writes one custom property per pack colour (`--pack-node-<template>`, `--pack-edge-<type>`,
`--pack-edge-dash-<type>`) into a single `<style id="corum-pack-colours">` element. Components do not read them
directly. They use the SDK helpers, which return custom-property bags for `style`:

| Helper | Returns | Pair with class |
|--------|---------|-----------------|
| `templateColourStyle(...templates)` | `--node-colour` | `node-coloured` |
| `edgeTypeStyle(type)` | `--edge-colour`, `--edge-dash` | `edge-coloured` |
| `kindColour(kind)` | a `var(--kind-N)` reference for `--node-colour` | `node-coloured` |

`edgeTypeStyle` is the single edge-type styling definition: tags, pills and Graph strokes all use it.

### Derived tokens

Given `--node-colour` and a `node-coloured` element (or `--edge-colour` and `edge-coloured`), the stylesheet derives,
with `color-mix(in srgb, ...)` against surface tokens:

| Token | Derivation | Use |
|-------|------------|-----|
| `--node-tint` / `--edge-tint` | colour 14% over `--card` | background |
| `--node-border` / `--edge-border` | colour 70% with `--foreground` | border |
| `--node-on-tint` / `--edge-on-tint` | colour 45% with `--foreground` | text on the tint |

`test/pack-colour-contrast.test.ts` evaluates these exact expressions for every pack colour in the repo's packs,
in the light and dark themes: text on the tint must reach 4.5:1 and borders 3:1 (WCAG 1.4.11). If one colour cannot
meet both, give it a `{ light, dark }` pair.

### Kind colours

Kinds map to `--kind-1` to `--kind-8` (defined by every theme). `component` is always `--kind-1`; any other kind is
`--kind-(2 + hash(kind) % 7)`. `--edge-default` colours edge types that declare no colour.

## Token changes in contract version 2

Documented since version 2 (`--corum-tokens-version: 2`):

- Added: `--edge-default`, `--kind-1` to `--kind-8` (theme tokens); `--node-colour`, `--edge-colour`, `--node-tint`,
  `--node-border`, `--node-on-tint`, `--edge-tint`, `--edge-border`, `--edge-on-tint` (host-derived, per element).
- Removed (breaking): `--edge-triggers`, `--edge-triggers-soft`, `--edge-produces`, `--edge-produces-soft`,
  `--edge-calls`, `--edge-calls-soft`, `--edge-implements`, `--edge-implements-soft`, `--edge-reads`,
  `--edge-reads-soft`. Migration: edge-type colours now come from pack data. Replace
  `var(--edge-<type>)` / `var(--edge-<type>-soft)` with `var(--edge-on-tint)` / `var(--edge-tint)` on an element that
  has the `edge-coloured` class and `style={edgeTypeStyle(type)}`.
- SDK: `edgeTypeStyle` and `templateColourStyle` added; `TemplateBadge` takes `template` instead of `colour`.
