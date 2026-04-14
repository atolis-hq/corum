# ADR-006b: Linter Implementation Approach

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-006 (Linter and Validator — architecture decisions)  
**See also:** ADR-006-rules.md — the rule catalogue this implementation must enforce

---

## Context and Problem Statement

ADR-006 decided that the linter runs in two primary contexts (CI and local CLI), uses a default-warning/opt-in-error severity model, and has a fixed rule set in v1 with pack-defined validator extensibility deferred. This ADR decides **how to implement it** — specifically whether to build from scratch or leverage existing open source tooling, and if so which.

The rule catalogue (ADR-006-rules.md) contains 37 rules across four categories. These rules split cleanly into two structurally different classes:

**Class 1 — Within-file rules (~60%):** Format checks, schema conformance, enum validation, pattern matching. These operate on a single parsed YAML file in isolation.

**Class 2 — Cross-file referential integrity rules (~40%):** Node ID uniqueness, edge endpoint resolution, field mapping resolution. These require all graph files to be loaded and indexed before any single rule can be evaluated.

No existing tool handles both classes without custom code. The decision is how much custom code to write, and what to use for the parts that can be delegated.

---

## Ecosystem Survey

### File-level linting tools

**yamllint** (Python, MIT) — validates YAML syntax and cosmetic style: indentation, key repetition, line length, truthy value handling. Directly covers F-005 and F-006. Has no awareness of content structure, schema, or cross-file references.

**Spectral** (Stoplight, Apache 2.0) — a JSON/YAML linter that operates on parsed documents using JSONPath selectors and a custom function model. Rules are expressed in a YAML/JSON ruleset file; complex rules use JavaScript/TypeScript custom functions. Ships with OpenAPI and AsyncAPI rulesets out of the box. Has a VS Code extension, CI integrations, and a JavaScript API for programmatic use. Actively maintained. The most relevant existing tool for within-file structural validation.

**vacuum** (quobix, MIT) — a Go implementation compatible with Spectral's ruleset format. Significantly faster than Spectral for large file volumes. Produces identical rule output. Has no OpenAPI/AsyncAPI rulesets of its own — relies on Spectral's format. Useful if Spectral performance becomes a concern at scale.

### Schema validation libraries

**ajv** (Node.js, MIT) — the JSON Schema validator used by Spectral internally. Can be used directly to validate parsed YAML objects against JSON Schema. This handles T-003 and T-004 (template property schema conformance) natively.

**Zod** (TypeScript, MIT) — TypeScript-first schema declaration and validation. Good for programmatic validation of parsed YAML structures with strong type inference.

### Graph constraint tools

**SHACL / pySHACL** (W3C standard / Python, Apache 2.0) — SHACL (Shapes Constraint Language) is a W3C standard for validating RDF graphs against a shapes graph. A SHACL processor takes a unified data graph and a shapes graph as input and returns structured validation results with severity levels. pySHACL is a pure Python implementation. SHACL natively handles: property constraints (type, cardinality, pattern), value set enumeration, referential integrity (every edge endpoint must resolve to a node in the graph), and graph-traversal constraints. SHACL-SPARQL extends this with arbitrary SPARQL-based constraints. The conversion cost is: YAML cluster files must be parsed and mapped to RDF triples before SHACL can validate them. This is essentially the same graph loader the MCP server already builds — outputting RDF instead of SQLite.

**ReGraph** (Python, MIT) — a library for property graph schema validation using homomorphism. More research-oriented than production-ready. Superseded by SHACL for practical use cases.

---

## Options Considered

### Option A: Build entirely from scratch

Write a custom YAML parser pipeline, rules engine, severity model, error formatter, local CLI, and CI integration.

**Pros:** Full control; no external dependencies; implementation language matches the MCP server stack  
**Cons:** Rebuilds solved problems — YAML parsing, JSONPath targeting, JSON Schema validation, severity models, CI output formats, VS Code integration are all solved by existing tools; large initial investment before any rules run; ongoing maintenance burden  
**Effort:** Large  
**Verdict:** Unjustifiable given the quality of available tooling

---

### Option B: Spectral for within-file rules + custom code for cross-file rules

Use Spectral as the within-file validation engine. Write a separate custom layer that loads the graph into memory, builds a node index, and runs cross-file integrity checks — outputting results in the same format as Spectral.

**Pros:** Spectral eliminates the within-file rules engine entirely; Spectral rulesets are familiar to the target audience (OpenAPI/AsyncAPI teams); VS Code extension gives real-time feedback; CI integrations are pre-built  
**Cons:** Two separate toolchains internally — Spectral for within-file, custom code for cross-file; error output format must be unified across both; the custom cross-file layer is still a meaningful build  
**Effort:** Medium — Spectral setup + custom cross-file layer  
**Verdict:** Viable but the two-toolchain split adds operational complexity

---

### Option C: Merge all YAML first, then Spectral against the merged document

A pre-processing step loads all cluster and edge files, merges them into a single unified JSON document (indexed by node ID), and runs Spectral against that document with a custom ruleset. Cross-file rules become within-document rules — edge endpoint resolution is a JSONPath lookup against the merged node index.

**Pros:** One tool (Spectral) handles almost all rules; cross-file referential integrity becomes achievable via Spectral custom functions with access to the full document; no two-toolchain split  
**Cons:** Error location degrades — Spectral reports positions within the merged document, not within the original source files; provenance metadata (which file each node came from) must be embedded in the merged document to produce actionable error messages; file system rules (F-003 alphabetical naming, F-004 directory membership) must still run pre-merge; the merge step itself is custom code  
**Effort:** Medium — merge step + Spectral ruleset  
**Verdict:** Clever but the error location degradation is a real usability problem

---

### Option D: Spectral with stateful custom functions

Spectral's JavaScript API allows custom functions to be stateful. A custom function initialised before Spectral runs can hold the full graph index as shared state. Each per-file Spectral run passes cross-file context to rules via the shared state. Referential integrity rules operate against the shared index while Spectral handles file-level targeting and error location.

**Pros:** One tool; preserves file-level error location (Spectral reports errors against the original file); cross-file context available to all rules; leverages Spectral's CI integrations and VS Code extension  
**Cons:** Abuses Spectral's extension model — shared mutable state across rules is not the intended design; may break with Spectral version updates; requires understanding Spectral's internal execution model  
**Effort:** Medium — requires deep Spectral integration knowledge  
**Verdict:** Fragile dependency on Spectral internals

---

### Option E: YAML → RDF conversion + SHACL shapes

Parse all graph YAML files into RDF triples (reusing the graph loader the MCP server already builds), then validate the unified RDF graph against SHACL shapes. SHACL natively handles property constraints, referential integrity, cardinality, and custom SPARQL-based constraints.

**Pros:** SHACL is a W3C standard purpose-built for graph constraint validation; referential integrity is a first-class native capability; shapes are declarative and auditable; pySHACL is mature and actively maintained; the graph loader is shared with the MCP server, reducing duplicate code  
**Cons:** Requires converting your property graph model to RDF — a meaningful mapping exercise; SHACL operates on RDF semantics (triples, IRIs) which are more complex than your YAML model; SHACL shapes are written in Turtle/RDF, which is less familiar than YAML/JSON rulesets; file system rules (naming conventions, directory structure) are not expressible in SHACL; the conversion layer between YAML and RDF is custom code; Python runtime required (MCP server may be TypeScript)  
**Effort:** Medium-high — RDF conversion + SHACL shapes authoring  
**Verdict:** The most theoretically complete solution but conversion overhead and the RDF/SHACL learning curve are real costs; worth revisiting if the graph is ever exposed as a knowledge graph (the RDF representation would then have value beyond linting)

---

### Option F: Layered — yamllint + Spectral + thin custom referential integrity layer (selected)

Three components with a clean separation of concerns:

1. **yamllint** handles YAML syntax validation (F-005, F-006). Runs first, fast, catches parse errors before anything else runs.

2. **Spectral** with a custom graph ruleset handles all within-file structural rules — ID format (F-001, F-002), naming conventions (F-003, F-004), schema version checks (F-007, F-008), state/stability enum validation (F-009, F-010), template resolution (T-001, T-002), JSON Schema property conformance (T-003, T-004) via the built-in `schema` function backed by ajv, edge type vocabulary (E-001, E-002, E-003, E-004). The graph ruleset is a versioned Spectral ruleset that ships with the tool.

3. **A thin custom graph integrity layer** loads all graph files into memory (reusing the same graph loader the MCP server uses), builds a node and field index, and runs the cross-file referential integrity checks: R-001 (node ID uniqueness), R-002/R-003 (edge endpoint resolution), F-010/F-011 (field mapping resolution). This layer outputs results in the same SARIF format as Spectral, so CI sees a unified result.

**Pros:**
- yamllint and Spectral are mature, tested tools that eliminate the bulk of the implementation work
- Spectral's ruleset format is familiar to the target audience; the graph ruleset ships as a community contribution point
- The custom integrity layer is thin — it does one job (load graph, check references) using code that the MCP server already needs
- Error location is precise: yamllint reports YAML errors with line/column; Spectral reports structural errors against the original source file; the integrity layer reports at file level with node ID in the message
- SARIF output is the CI standard — GitHub, GitLab, and Azure DevOps all render SARIF annotations natively
- yamllint + Spectral give VS Code real-time feedback without additional tooling
- When the tool adds OpenAPI and AsyncAPI spec file support, Spectral's native OpenAPI/AsyncAPI rulesets apply immediately — no additional work

**Cons:**
- Three components to install and version together — managed by packaging them as a single `graph lint` CLI command
- The Spectral ruleset must be kept in sync with the rule catalogue as rules evolve
- The custom integrity layer, while thin, is still custom code with tests

**Effort:** Low-medium — Spectral ruleset authoring + thin integrity layer  
**Verdict:** Best balance of leverage, precision, familiarity, and maintainability

---

## Decision

**Chosen option: Option F — yamllint + Spectral + thin custom referential integrity layer**

---

## Implementation Architecture

```
graph lint
    │
    ├── 1. yamllint
    │       Input: all *.yaml files in the graph repo
    │       Rules: F-005, F-006
    │       Output: SARIF (errors block further steps)
    │
    ├── 2. Spectral (custom graph ruleset)
    │       Input: all cluster and edge files
    │       Ruleset: .graph-spectral.yaml (ships with the tool)
    │       Rules: F-001–F-004, F-007–F-012, T-001–T-012, E-001–E-004
    │       Backend: ajv for JSON Schema validation (T-003, T-004)
    │       Output: SARIF (errors and warnings)
    │
    └── 3. Graph integrity layer (custom, TypeScript)
            Input: all cluster and edge files (parsed via graph loader)
            Rules: R-001–R-005, F-010, F-011
            Output: SARIF (merged with Spectral output)
```

The three steps run in sequence. yamllint failures abort subsequent steps — there is no point running Spectral against a file that does not parse. The SARIF outputs from steps 2 and 3 are merged before CI annotation.

The graph loader used in step 3 is the same loader used by the MCP server to build its SQLite cache. It is a shared library dependency, not a separate implementation. This means linter correctness tests and MCP server tests share the same graph loading logic.

---

## Spectral Ruleset

The graph Spectral ruleset (`.graph-spectral.yaml`) ships as part of the tool and is versioned alongside the rule catalogue. It is a standard Spectral ruleset file — teams can inspect and extend it using Spectral's normal extension mechanism.

Example rules from the ruleset:

```yaml
# .graph-spectral.yaml
extends: []

rules:
  graph-node-id-format:
    description: "Node ID must match {component}.{node-type}.{node-name} format"
    message: "Node ID '{{value}}' does not match required format"
    given: "$.id"
    severity: error
    then:
      function: pattern
      functionOptions:
        match: "^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$"

  graph-state-valid:
    description: "State must be a valid value"
    given: "$.state"
    severity: error
    then:
      function: enumeration
      functionOptions:
        values: [draft, proposed, agreed, future, removed, implemented]

  graph-template-properties:
    description: "Node properties must conform to template JSON Schema"
    given: "$.properties"
    severity: warn
    then:
      function: schema
      functionOptions:
        schema:
          $ref: "./schemas/{{template}}.json"  # resolved per-file by custom function

  graph-edge-type-valid:
    description: "Edge type must be from core vocabulary"
    given: "$.edges[*].type"
    severity: error
    then:
      function: enumeration
      functionOptions:
        values: [triggers, produces, reads, calls, implements, maps-to, derived-from, renamed-from]
```

---

## Output Format

All three steps produce SARIF (Static Analysis Results Interchange Format). SARIF is the CI standard — GitHub Actions, GitLab, and Azure DevOps all render SARIF output as inline PR annotations without additional configuration.

```json
{
  "version": "2.1.0",
  "runs": [{
    "tool": { "driver": { "name": "graph-lint" } },
    "results": [{
      "ruleId": "R-001",
      "level": "error",
      "message": { "text": "Duplicate node ID: orders.domain-models.order (also declared in components/orders/domain-models/order-v2.yaml)" },
      "locations": [{
        "physicalLocation": {
          "artifactLocation": { "uri": "components/orders/domain-models/order.yaml" },
          "region": { "startLine": 3 }
        }
      }]
    }]
  }]
}
```

---

## Packaging

The three components are packaged behind a single `graph lint` CLI command. Teams do not invoke yamllint or Spectral directly — the CLI orchestrates them. This means:

- Version pinning for yamllint and Spectral is managed by the tool, not by each team
- The CI integration is a single command: `graph lint --format sarif`
- The local developer experience is a single command: `graph lint`
- The MCP server startup subset runs the graph integrity layer only (step 3) — it does not invoke yamllint or Spectral on startup

---

## Future: Pack-defined Validators

ADR-006 noted that pack-defined validators are the planned future extension model. Under Option F, this maps naturally: a pack ships an additional Spectral ruleset file that extends the base graph ruleset. The `graph lint` CLI discovers and loads pack-provided rulesets automatically. This is Option C from ADR-006's extensibility options — pack-defined validators via Spectral ruleset extensions — and requires no architectural change to the implementation chosen here.

---

## Consequences

**What becomes easier:**
- The bulk of the rule implementation is declarative Spectral ruleset authoring — no custom rules engine to build or maintain
- Spectral's VS Code extension gives engineers real-time linting feedback without additional tooling
- OpenAPI and AsyncAPI spec files in the graph repo are lintable by Spectral's built-in rulesets immediately
- The graph loader is shared between the linter and MCP server — one implementation, tested once
- SARIF output requires no custom CI integration work

**What becomes harder:**
- Three components require coordinated versioning in the `graph lint` package
- The Spectral ruleset must be kept in sync with the rule catalogue as rules evolve

**What is newly possible:**
- Community teams can contribute graph ruleset extensions via Spectral's standard extension mechanism
- The `graph lint` CLI accepts custom ruleset overrides, enabling teams to add organisation-specific rules without modifying the tool
- When OpenAPI and AsyncAPI spec files are stored in the graph repo, `graph lint` can validate them against Spectral's native rulesets in the same run

---

## Related

- ADR-006: Linter and Validator — architecture decisions this implementation serves
- ADR-006-rules.md — the rule catalogue implemented by this toolchain
- ADR-001: Storage and interaction architecture — the graph repo structure the linter validates
- ADR-003: Graph loading and runtime representation — the graph loader shared between linter and MCP server
