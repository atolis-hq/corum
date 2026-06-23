# Component Name Replacements Design

**Date:** 2026-06-23  
**Status:** Approved

## Problem

When importing from multiple sources (OpenAPI and AsyncAPI), the same logical component can be extracted with different names depending on the source convention. For example, `order-shipping` from a hyphenated URI segment and `ordershipping` from a concatenated topic/event name. These become different node ID prefixes in the graph, breaking cross-adapter linking.

## Solution

A global `componentNameReplacements` list in `ImportConfig` that maps raw extracted component names to canonical ones. Replacements are applied immediately after extraction in each adapter, before any node ID is constructed.

## Config Shape

```yaml
componentNameReplacements:
  - from: ordershipping
    to: order-shipping

imports:
  - adapter: openapi
    spec: order-shipping.openapi.yaml
    componentMapping: ...
  - adapter: asyncapi
    spec: order-shipping.asyncapi.yaml
    componentMapping: ...
```

- Exact-match only, case-sensitive
- Array of `{ from, to }` objects (not a map) to allow future extension (e.g., `type: regex`)
- Intended to cover only the specific mismatches that need fixing — unmatched entries are silently ignored
- No convention-based normalization (leave for later)

## TypeScript Types

`src/import/config.ts`:

```ts
export interface ComponentNameReplacement {
  from: string
  to: string
}

export interface ImportConfig {
  componentNameReplacements?: ComponentNameReplacement[]
  imports: ImportEntry[]
}

export function applyComponentNameReplacements(
  name: string,
  replacements: ComponentNameReplacement[],
): string {
  return replacements.find(r => r.from === name)?.to ?? name
}
```

## Threading

`AdapterContext` in `src/adapters/index.ts` carries the replacements to both adapters:

```ts
export interface AdapterContext {
  packConfig: AdapterPackConfig
  templates: Map<string, Template>
  componentNameReplacements: ComponentNameReplacement[]
}
```

`runner.ts` populates it:

```ts
const result = await adapter.import(resolvedEntry, {
  packConfig,
  templates: graph.templates,
  componentNameReplacements: config.componentNameReplacements ?? [],
})
```

## Application Points

`applyComponentNameReplacements()` is called right after the raw component name is extracted, before any node ID is constructed.

**OpenAPI mapper** (`src/adapters/openapi/mapper.ts`):
- After `deriveComponent()` in the operations loop (~line 149)
- After `deriveComponent()` in `deriveComponentForSchema()` (~line 568)

**AsyncAPI mapper** (`src/adapters/asyncapi/mapper.ts`):
- After `extractValue()` for `componentMapping` in the schema component walk (~line 260)
- After `extractValue()` for `componentMapping` in the operations loop (~line 328)

## Validation

`loadImportConfig` validates that each replacement entry has non-empty `from` and `to` strings, using the same `Invalid import config` error pattern already in place.

## Future Extensions

- Per-adapter overrides: merge entry-level replacements over context-level ones
- Regex matching: add optional `type: 'regex'` field to `ComponentNameReplacement`
- Convention-based normalization: separate `componentNameNormalization` config key

## Out of Scope

- Post-processing node IDs after mapping (fragile, rejected)
- Unused replacement warnings (replacements are partial by design)
- Convention-based normalization (deferred)
