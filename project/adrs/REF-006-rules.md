# ADR-006-rules: Linter Rule Catalogue

**Status:** Reference — normative companion to ADR-006  
**Date:** 2026-04-12  
**Amended:** 2026-04-14 — S-series rules added (ADR-003d); S-series extended and V-series added for enum support (ADR-004b amendment); E-001 and E-008 updated  
**Derives from:** ADR-002, ADR-003b, ADR-003d, ADR-004, ADR-004b  
**Governed by:** ADR-006 (severity model, deployment contexts, extensibility)

Rules in this catalogue are derived directly from structural decisions in previous ADRs. No rule is invented here — each references the ADR that establishes the underlying constraint. Default severities follow the model in ADR-006: errors reflect structural invariants the tool depends on; warnings reflect quality and convention rules that teams may tighten via configuration.

---

## Startup Subset

These rules run in the MCP server on startup. Failures prevent the server from starting. All other rules run in CI and the local CLI only.

`F-005`, `F-007`, `T-001`, `T-002`, `T-006`, `T-007`, `T-008`, `T-010`, `E-001`, `E-002`, `R-001`, `S-004`, `S-005`, `S-006`, `V-001`

---

## File Format Rules (ADR-002)

**F-001 — Node ID format** `error`  
Every node ID declared in a cluster file must match `{component}.{node-type}.{node-name}[.{path}]`. The component and node-type segments must match the file's directory path. A mismatch indicates the file was moved without updating its declared ID.

**F-002 — Owned node ID prefix** `error`  
Every owned node ID (field, enum value, invariant, operation) must be prefixed with its root node's ID. A field `orders.domain-models.order.fields.customer-id` that does not begin with `orders.domain-models.order` is invalid.

**F-003 — Edge file alphabetical naming** `error`  
Within-component edge files must be named with the two node-type directories in alphabetical order. `api-endpoints--domain-models.yaml` is valid; `domain-models--api-endpoints.yaml` is not. Cross-component edge files must use alphabetical component order in the top-level `edges/` directory.

**F-004 — Node-type directory membership** `error`  
Every node-type directory name must correspond to a template name declared in one of the loaded packs (compared case-insensitively, with hyphens normalised). An unrecognised directory name indicates a missing or misconfigured pack.

**F-005 — YAML 1.2 compliance** `error`  
All files must parse as valid YAML 1.2. Files using YAML 1.1-only constructs (e.g. unquoted `NO` parsed as `false`, unquoted `yes`) are rejected.

**F-006 — Prohibited YAML constructs** `error`  
The `!!` explicit type tag syntax is prohibited in all graph files. Cross-file YAML anchors are prohibited. Within-file anchors are permitted.

**F-007 — Schema version present** `error`  
Every cluster file and edge file must declare `schema-version` at the top level. Files without a schema version cannot be validated.

**F-008 — Schema version compatibility** `error`  
The `schema-version` in a file must be compatible with the current tool version. Files written against an older major schema version are rejected; the migration CLI command must be run before they lint cleanly.

**F-009 — Valid state values** `error`  
`state` must be one of: `draft`, `proposed`, `agreed`, `future`, `removed`, `implemented`. Any other value is rejected.

**F-010 — Valid stability values** `error`  
`stability` must be one of: `unstable`, `stable`, `deprecated`. Any other value is rejected.

**F-011 — `fieldMappings` endpoint resolution** `error`  
`fromField` and `toField` values in `fieldMappings` blocks in edge files must resolve to field IDs declared in their respective cluster files. Unresolvable field references are errors.

**F-012 — No inline cross-node relationships** `error`  
Cluster files must not declare edges to other root nodes inline. All cross-node relationships must be in edge files. Type references within `properties` (e.g. a field's `objectRef` referencing a `DomainModel` node ID) are not edges and are not subject to this rule.

**F-013 — Component registry completeness** `warning`  
Every component directory under `components/` should be declared in `graph.yaml`. Undeclared component directories are loadable but flagged as unregistered.

---

## Reference Integrity Rules (ADR-002, ADR-003b)

**R-001 — Node ID uniqueness** `error`  
No two nodes across the entire graph repo may share the same fully qualified ID. Duplicates are errors regardless of which files they appear in.

**R-002 — Edge endpoint resolution (in-repo)** `error`  
Every `from` and `to` value in edge files must resolve to a node ID declared somewhere in the graph repo.

**R-003 — Edge endpoint resolution (cross-repo)** `warning`  
If a `from` or `to` value references a node in a different graph repo (identifiable by a repo-qualified ID format), the reference cannot be validated locally and is flagged as a warning.

**R-004 — Removed node isolation** `warning`  
A node with `state: removed` should have no outbound edges other than `renamed-from`. Outbound edges from removed nodes suggest stale relationships not cleaned up after removal.

**R-005 — Renamed-from directionality** `warning`  
A `renamed-from` edge should point from a node with a non-`removed` state to a node with `removed` state. A `removed` node as the source is suspicious and flagged.

---

## Template and Pack Rules (ADR-004)

**T-001 — Template resolution** `error`  
Every node's `template` value must resolve to a template name in one of the loaded packs.

**T-002 — Abstract template instantiation** `error`  
No node may declare an abstract template (one marked `abstract: true`) as its `template` value. Abstract templates cannot be instantiated directly.

**T-003 — Required property presence** `warning`  
A node's `properties` block must contain all properties declared as `required` in its template's JSON Schema. Missing required properties are warnings by default — a node may exist before all properties are populated. Promotable to error via linter configuration.

**T-004 — Property schema conformance** `warning`  
A node's `properties` values must conform to the types, formats, and constraints in the template's JSON Schema. Violations are warnings by default. Promotable to error.

**T-005 — Unknown properties** `warning`  
Properties in a node's `properties` block that are not declared in the template's JSON Schema are flagged as warnings. This supports forward compatibility when a node is written against a newer template than is currently loaded.

**T-006 — Field core template present** `error`  
The `Field` template marked `core: true` must be present across the loaded packs. This is the only hard dependency the tool has on a specific template name.

**T-007 — Template name uniqueness** `error`  
No two loaded packs may define a template with the same name. Conflicts must be resolved by renaming one of the templates before the packs can be loaded together.

**T-008 — `extends` reference resolution** `error`  
A template's `extends` value must reference a template present in the loaded packs. Unresolvable `extends` references prevent the pack from loading.

**T-009 — No circular extension chains** `error`  
Template `extends` chains must not form cycles. Template A extending B extending A is rejected at pack load time.

**T-010 — Child does not narrow parent** `error`  
A child template (via `extends`) may not remove required properties declared in the parent schema or narrow a parent property's type. Extension is strictly additive.

**T-011 — Pack `requires` satisfied** `error`  
If a loaded pack declares `requires`, all required packs must also be loaded. A pack loaded without its declared dependencies is a startup error.

**T-012 — Schema drift** `warning`  
If a node's `schemaVersion` is behind the current template version (detectable via the template's `version` field), the node is flagged as schema-drifted. Resolution is manual — the tool surfaces affected nodes but does not auto-migrate.

---

## Edge Constraint Rules (ADR-004b)

**E-001 — Core edge type vocabulary** `error`  
Every edge `type` value must be one of the ten core edge types: `triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`, `renamed-from`, `has-field`, `has-value`. Any other value is rejected.

**E-002 — `maps-to` structural check** `error`  
`maps-to` edges must connect two Field nodes. A `maps-to` edge where either endpoint is not a Field node is a hard error with no configurable relaxation.

**E-003 — Template edge declaration overlap** `error`  
Within a single template's `edges` declaration, a given edge type name must appear in exactly one of `supports`, `outgoing`, or `incoming`. Overlap across sections is rejected at pack load time.

**E-004 — Template edge declaration vocabulary** `error`  
All edge type names referenced in `edges.supports`, `edges.outgoing`, or `edges.incoming` in a template must be from the ten-type core vocabulary. References to unknown type names are errors.

**E-005 — Outgoing constraint violation** `warning`  
If the source node's template declares `outgoing` or `supports`, the edge type must appear in one of them. Violation is a warning by default. Promotable to error via linter configuration.

**E-006 — Incoming constraint violation** `warning`  
If the target node's template declares `incoming` or `supports`, the edge type must appear in one of them. Violation is a warning by default. Promotable to error via linter configuration.

**E-007 — `renamed-from` cycle** `error`  
A `renamed-from` chain must not form a cycle. A → renamed-from → B → renamed-from → A is rejected.

**E-008 — Structural ownership edge in edge file** `error`  
`has-field` and `has-value` edges must not be declared in edge files. These edge types are structural ownership edges extracted automatically from cluster file structure. Explicit authoring of these types in edge files is always an error.

---

## Schema Reference Rules (ADR-003d)

These rules govern the `schemas` and `enums` blocks in APIEndpoint cluster files, local reference resolution, and the `scalarType`/`objectRef` field type model. All rules apply equally to the `schemas` block and the `enums` block unless stated otherwise.

**S-001 — Local name shadows global node ID** `warning`  
A key in a node file's `schemas` or `enums` block that matches a global node ID in the graph takes precedence over the global node (local-first resolution). The shadowing is flagged so authors can verify the collision is intentional. Promotable to error.

**S-002 — Unresolved schema or enum reference** `error`  
A value in `properties.request`, any entry in `properties.responses`, or any `objectRef` within `schemas` or `enums` block field definitions that resolves to neither a local schema name, a local enum name, nor a valid global node ID is an unresolvable reference. The error message must indicate which resolution step failed to aid diagnosis.

**S-003 — Local definition unused** `warning`  
A schema or enum defined in the `schemas` or `enums` block that is not referenced anywhere within the same file is unreachable. Promotable to error.

**S-004 — `objectRef` cycle in local definitions** `error`  
A cycle in `objectRef` references among local schemas and enums within the same file is rejected. Detected at load time; prevents server startup.

**S-005 — `scalarType` and `objectRef` both present on a field** `error`  
A field definition that declares both `scalarType` and `objectRef` is structurally invalid. Detected at load time; prevents server startup.

**S-006 — Field carries neither `scalarType` nor `objectRef`** `error`  
A field definition that declares neither `scalarType` nor `objectRef` has no resolvable type. Detected at load time; prevents server startup.

---

## Enum Value Rules (ADR-004b amendment)

**V-001 — EnumDefinition has at least one non-removed value** `error`  
An EnumDefinition with no EnumValue nodes, or where all EnumValue nodes have `state: removed`, is an empty enum and cannot be used as a field type. Detected at load time; prevents server startup.

**V-002 — EnumValue name convention** `warning`  
The `name` property of an EnumValue should follow SCREAMING_SNAKE_CASE convention (e.g. `PENDING`, `ORDER_PLACED`). Values that do not match this pattern are flagged. Promotable to error.

**V-003 — Duplicate enum value names within a definition** `error`  
Two EnumValue nodes within the same EnumDefinition must not share the same `name` string. Duplicate wire-format constants within one enum are always an error regardless of their keys in the `values` map.

---

## Rule Summary

| ID | Source | Default | Promotable | Startup subset |
|---|---|---|---|---|
| F-001 | ADR-002 | error | — | no |
| F-002 | ADR-002 | error | — | no |
| F-003 | ADR-002 | error | — | no |
| F-004 | ADR-002 | error | — | no |
| F-005 | ADR-002 | error | — | **yes** |
| F-006 | ADR-002 | error | — | no |
| F-007 | ADR-002 | error | — | **yes** |
| F-008 | ADR-002 | error | — | no |
| F-009 | ADR-002 | error | — | no |
| F-010 | ADR-002 | error | — | no |
| F-011 | ADR-002 | error | — | no |
| F-012 | ADR-002 | error | — | no |
| F-013 | ADR-002 | warning | error | no |
| R-001 | ADR-003b | error | — | **yes** |
| R-002 | ADR-003b | error | — | no |
| R-003 | ADR-003b | warning | error | no |
| R-004 | ADR-003b | warning | error | no |
| R-005 | ADR-003b | warning | error | no |
| T-001 | ADR-004 | error | — | **yes** |
| T-002 | ADR-004 | error | — | **yes** |
| T-003 | ADR-004 | warning | error | no |
| T-004 | ADR-004 | warning | error | no |
| T-005 | ADR-004 | warning | — | no |
| T-006 | ADR-004 | error | — | **yes** |
| T-007 | ADR-004 | error | — | **yes** |
| T-008 | ADR-004 | error | — | **yes** |
| T-009 | ADR-004 | error | — | no |
| T-010 | ADR-004 | error | — | no |
| T-011 | ADR-004 | error | — | **yes** |
| T-012 | ADR-004 | warning | error | no |
| E-001 | ADR-004b | error | — | **yes** |
| E-002 | ADR-004b | error | — | **yes** |
| E-003 | ADR-004b | error | — | no |
| E-004 | ADR-004b | error | — | no |
| E-005 | ADR-004b | warning | error | no |
| E-006 | ADR-004b | warning | error | no |
| E-007 | ADR-004b | error | — | no |
| E-008 | ADR-004b | error | — | no |
| S-001 | ADR-003d | warning | error | no |
| S-002 | ADR-003d | error | — | no |
| S-003 | ADR-003d | warning | error | no |
| S-004 | ADR-003d | error | — | **yes** |
| S-005 | ADR-003d | error | — | **yes** |
| S-006 | ADR-003d | error | — | **yes** |
| V-001 | ADR-004b | error | — | **yes** |
| V-002 | ADR-004b | warning | error | no |
| V-003 | ADR-004b | error | — | no |
