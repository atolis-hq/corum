# 03 — Extensibility: Packs, Adapters, Plugins

**Status:** Draft v0.1
**Last updated:** 2026-04-16
**Relates to:** [ADR-004](../adr/ADR-004-template-pack-format.md), [ADR-004b](../adr/ADR-004b-edge-type-vocabulary-and-constraints.md), [REF-specification-format-support](../adr/REF-specification-format-support.md), [PDR-003](../pdr/PDR-003-template-packs-and-plugin-architecture.md)

---

## 1. The extensibility surface

The Corum engine has no hardcoded node types, no built-in knowledge of any spec format, and no bundled UI for any particular concept. Everything that varies between teams or ecosystems is expressed through one of four extension points:

| Extension point | Owned by | Distribution | Implementation layer |
|---|---|---|---|
| **Template pack** | `@corum/template-core` | `.corum/packs/*`, local path, or npm package | Domain |
| **Spec adapter** | `@corum/schema` (`src/ports/adapters.ts`) | npm package, typically re-exported by a pack | Adapters |
| **Output plugin** | `@corum/schema` (`src/ports/adapters.ts`) | npm package | Adapters |
| **View plugin (web)** | Future web-side registry | npm package | Interface |

The engine depends on none of these concretely. It depends on their interfaces only.

---

## 2. Template packs

### 2.1 What a pack contains

Defined in [ADR-004](../adr/ADR-004-template-pack-format.md). A pack is a directory with:

```
pack-name/
  pack.yaml                    # manifest — name, version, requires, templates list
  templates/
    <TemplateName>.yaml        # one file per template
  edge-types.yaml              # reserved for custom edge types (future)
  components/                  # reserved for purpose-built UI (future)
```

Each template YAML is a JSON Schema for the `properties` block plus metadata (description, UI hints, edge participation).
Core templates may also declare a reserved `coreRole` value such as `field`, `enum-definition`, or `enum-value`. The engine may depend on those roles for graph invariants, but it still loads the template from YAML and does not depend on the template name.

### 2.2 Built-in vs. third-party

Built-in packs (`core`, `rest`, `messaging`, `domain`, etc.) live in this repo under `.corum/packs/*` as plain pack directories - **nothing about them is special-cased by the engine**. They are loaded by the same path-resolver that loads a team's `my-extensions` pack. The CLI default `graph.yaml` points to these paths when scaffolding a graph repo.

### 2.3 Loading

1. `graph.yaml` declares `templatePacks: [{ name, version, path? }]`.
2. `@corum/template-core` resolves each entry - by explicit path first, then by package resolution for third-party packs.
3. All packs are loaded, then `extends` chains are resolved across the full loaded set.
4. Template name collisions are a hard error — no silent precedence.
5. The resolved, merged template set becomes read-only for the session.

### 2.4 Extension inside a pack

Teams create new templates by adding `templates/MyThing.yaml` to a pack. Specialisations declare `extends: ParentTemplate`. The child's `properties` JSON Schema is merged into the parent's via `allOf`; `description`, `ui`, and `edges` sections in the child replace the parent's.

The linter enforces that a child does not remove parent required properties or reference an undeclared parent.

### 2.5 Edge participation — declared, not free-form

Each template declares which core edge types it may send and receive ([ADR-004b](../adr/ADR-004b-edge-type-vocabulary-and-constraints.md)):

```yaml
edges:
  outgoing: [calls, produces]
  incoming: [triggers]
  supports: [reads]                # bidirectional
```

These names come from the **fixed core edge vocabulary** — the engine rejects unknown edge types. Custom edge types are deferred ([PDR-003](../pdr/PDR-003-template-packs-and-plugin-architecture.md)).

---

## 3. Spec adapters

### 3.1 The decision: adapters, not standalone converters

A question the architecture had to answer early: should spec formats (OpenAPI, AsyncAPI, …) be handled by **pluggable adapters** registered with the engine, or by **standalone converters** — CLIs that transform a spec file into graph YAML files independently of the engine?

**Standalone converters lose too much.**

- **No graph awareness.** A converter that doesn't see the existing graph cannot match an extracted endpoint to an already-proposed node, cannot preserve a node's `state` progression from `proposed` → `agreed`, and cannot populate `extractedFrom` consistently across repeated runs.
- **No cross-format edges.** `maps-to` edges between an API request field and its `DomainModel` counterpart require reading both sides and reconciling. A single-format converter cannot do this.
- **Duplicated file-format code.** A converter that emits YAML must reimplement cluster-file layout, owned-node nesting, safe YAML emission, and round-trip stability — all of which `@corum/file-format` already does.
- **Broken MCP integration.** An agent that calls an `import openapi` MCP tool needs the result to arrive as proposed nodes in a single round trip, not as "go shell out to this other tool and then re-fetch." A standalone converter cannot serve the MCP write path cleanly.
- **Two-tool orchestration.** Users would glue the converter and the graph engine together with shell scripts and drift detection would see phantom changes.

**Adapters get the ergonomics anyway.** `corum import openapi <file>` and `corum export openapi --namespace orders` are CLI shortcuts that invoke the same registered adapter the MCP `import_spec` tool invokes. Nothing that a standalone converter would give you is lost — and you gain graph awareness, `maps-to` edge inference, and a single code path.

**Therefore:** every spec format is handled by an adapter implementing the `SpecAdapter` interface, registered with the engine at startup, and invoked uniformly through MCP tools and CLI commands.

### 3.2 The `SpecAdapter` interface

Declared in `@corum/schema/src/ports/adapters.ts`. Adapter packages depend only on `@corum/schema` — no application-layer imports required.

```ts
export interface SpecAdapter {
  /** Short lowercase identifier — 'openapi', 'asyncapi', 'graphql', 'typespec'. */
  readonly format: string;

  /** Human-readable display name. */
  readonly displayName: string;

  /** Spec version(s) this adapter supports. */
  readonly supportedVersions: string[];

  /** Template pack this adapter binds to. The pack must be loaded for the adapter to run. */
  readonly requiresPack: string;

  /** Quick structural check — can this adapter plausibly handle the given source? */
  canRead(source: SpecSource): Promise<boolean>;

  /**
   * Read a spec file and produce a candidate graph fragment.
   * The engine reconciles the fragment against the existing graph — the adapter
   * does not write to the graph directly.
   */
  read(source: SpecSource, ctx: AdapterContext): Promise<CandidateGraph>;

  /**
   * Emit a spec file from a set of nodes.
   * The engine selects which nodes to export (typically `state: agreed`) and
   * passes them in; the adapter shapes the output.
   */
  write(input: WriteInput, ctx: AdapterContext): Promise<SpecOutput>;
}

export interface SpecSource {
  kind: 'file' | 'url' | 'buffer';
  path?: string;
  url?: string;
  buffer?: Buffer;
  /** Optional origin info propagated to `extractedFrom`. */
  origin?: string;
}

export interface AdapterContext {
  /** The loaded template pack set — adapters may inspect which templates exist. */
  readonly packs: LoadedPack[];
  /** The active namespace being imported into, if scoped. */
  readonly namespace?: string;
  /** Read-only access to the current graph for reconciliation hints.
   *  Declared as a structural interface here so adapters don't depend on @corum/graph. */
  readonly graph: GraphQueryFacade;
  /** Diagnostics surface — adapters raise warnings/errors rather than throwing. */
  emit(diagnostic: AdapterDiagnostic): void;
}

/** Minimal read-only graph surface needed by adapters during reconciliation.
 *  @corum/graph's GraphService implements this structurally. */
export interface GraphQueryFacade {
  listClusters(namespace?: string): Promise<Node[]>;
  getCluster(id: NodeId): Promise<Node | undefined>;
  getTemplate(name: string): Promise<Template | undefined>;
}

export interface CandidateGraph {
  nodes: CandidateNode[];
  edges: CandidateEdge[];
  /** Ambiguous mappings — things the adapter can't decide alone. */
  questions: AdapterQuestion[];
}

export interface CandidateNode {
  id: NodeId;               // deterministic from source
  template: string;
  component: string;
  properties: Record<string, unknown>;
  ownedChildren?: CandidateNode[];
  extractedFrom: string;
  /** If the adapter recognises this is an update to an existing node. */
  replacesId?: NodeId;
}

export interface CandidateEdge {
  from: NodeId;
  to: NodeId;
  type: EdgeType;
  notes?: string;
}

export interface WriteInput {
  /** Nodes to export — engine-selected, typically all `agreed` of a given template. */
  nodes: Node[];
  edges: Edge[];
  /** The target the adapter should emit into — a file path or registry ref. */
  target: SpecTarget;
}
```

### 3.3 What the engine does with a `CandidateGraph`

The adapter is deliberately dumb about graph state. The engine does the reconciliation:

1. Each candidate node's ID is compared against the current graph.
2. If no match: proposed new node. Cluster file written at the expected path, state `proposed`.
3. If matched and properties identical: no-op.
4. If matched and properties differ: diff recorded as drift; existing state preserved; `extractedFrom` updated. A thread may be opened with the proposed changes depending on config.
5. Candidate `maps-to` edges between fields where both endpoints exist are inserted with `state: proposed`.
6. `AdapterQuestion`s surface in the MCP response and CLI output for human or agent review.

This is where most of the "cleverness" of the import pipeline lives, not in the adapter.

### 3.4 Adapter packaging

Each adapter is a standalone package (`@corum/adapter-openapi`) that depends only on `@corum/schema` (for `SpecAdapter`, `CandidateGraph`, and domain types). No application-layer imports. Built-in spec-aligned packs live under `.corum/packs`; package installation concerns belong to adapters and CLI distribution, not to the pack YAML itself.

The MCP server and CLI discover adapters via adapter registration. A loaded pack may name the adapter it is commonly paired with, but the pack remains data and does not import adapter code:

```yaml
# .corum/packs/rest/pack.yaml
name: rest
version: "1.0.0"
templates: [APIEndpoint]
adapter:
  package: "@corum/adapter-openapi"
  export: "OpenApiAdapter"
```

### 3.5 The TypeSpec opportunity

[REF-typespec-integration-opportunities](../adr/REF-typespec-integration-opportunities.md) notes TypeSpec as a higher-fidelity alternative to OpenAPI for extraction. The adapter interface supports this directly - `@corum/adapter-typespec` is another package implementing `SpecAdapter`, paired with its own pack or with the built-in `.corum/packs/rest` templates. No engine change needed.

---

## 4. Output plugins

An output plugin is a write-only variant of a spec adapter. Some formats are export-only (e.g. Markdown docs, Mermaid diagrams, a Confluence page). They implement a subset of `SpecAdapter`, declared alongside it in `@corum/schema/src/ports/adapters.ts`:

```ts
export interface OutputPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly requiresPack?: string;
  write(input: WriteInput, ctx: AdapterContext): Promise<SpecOutput>;
}
```

Registered the same way adapters are. CLI: `corum export <plugin-id> <scope>`.

Example candidates:

- `@corum/output-mermaid` — render a component as a Mermaid diagram.
- `@corum/output-markdown` — generate per-component documentation.
- `@corum/output-typespec` — emit TypeSpec from agreed API endpoint nodes (doubles as a future input via the same adapter).

---

## 5. View plugins (web — future)

Deferred until the React UI is built. [PDR-006](../pdr/PDR-006-human-review-and-editing-experience.md) describes a perspective-per-node-type model: each node type has a custom view/editor that knows how to display it meaningfully. Until the web ADR lands, the `ui:` hints in each template drive a generic renderer.

The expected shape:

```ts
export interface ViewPlugin {
  id: string;
  /** Template names this plugin can render. */
  supportsTemplates: string[];
  /** A React component (lazily loaded). */
  component: () => Promise<{ default: ComponentType<ViewProps> }>;
}
```

Registration via pack `components/` directory + a `view-plugins.ts` manifest. Deferred ADR.

---

## 6. What is not pluggable (by design)

- **The logical data model and core semantic roles.** `Node`, `Edge`, `Field`, the universal node properties, the state and stability enums are structural invariants of the engine. Packs extend the model, but reserved `coreRole` contracts such as `field` are fixed because graph rules depend on them.
- **The core edge vocabulary.** `maps-to`, `triggers`, `produces`, `reads`, `calls`, `implements`, `derived-from`, `renamed-from` are fixed in v1 ([ADR-004b](../adr/ADR-004b-edge-type-vocabulary-and-constraints.md)).
- **The file format.** Cluster files, edge files, `graph.yaml` are defined by [ADR-002](../adr/ADR-002-graph-file-format-and-cluster-boundaries.md). The format version is bumped through migration, not overridden by plugins.
- **The storage model.** Git-as-canonical-store + SQLite-as-cache is fixed for v1. Alternative stores are a hosted-tier concern.
- **The MCP tool surface shape.** Tool signatures and response shapes come from [ADR-005](../adr/ADR-005-mcp-interface-design.md) and the [catalogue](../adr/REF-mcp-tool-catalogue.md). Adapters do not extend the MCP surface directly — their capabilities are exposed through the generic `import_spec` / `export_spec` tools.

This constraint is intentional. It keeps the core engine small, auditable, and free of feature drift driven by any single integration.

---

## 7. Testing extensions

Each extension point has a dedicated test harness in the repo:

- **Template packs** - a `test/packs.ts` harness loads every pack under `.corum/packs/`, resolves `extends`, meta-schema-validates, and asserts that the minimal examples in each pack load without errors. Runs in CI on every PR.
- **Adapters** — a contract test suite in `packages/adapter-openapi/test/contract.ts` (and similarly for each adapter) that any `SpecAdapter` implementation can import and run against its own implementation. The suite is co-located with the first adapter and exported as a shared test helper. Covers: `canRead` behaviour on the happy path and rejected sources, idempotent `read` (running twice produces the same `CandidateGraph`), `write` round-trip where applicable, `AdapterContext.emit` usage for every warning.
- **Output plugins** — same shape as adapters, write-only half.
- **End-to-end import → graph → export** tests in `test/integration/` use real fixture OpenAPI files to verify that extraction + reconciliation produces the expected cluster files on disk.

---

## 8. Third-party extension story

A team wanting to ship a custom pack or adapter:

1. Create an npm package following the pack directory convention or adapter package convention.
2. Publish to npm (private or public).
3. Declare the pack in their graph repo's `graph.yaml`.
4. The `@corum/cli` resolves, loads, and validates the pack at startup.

No recompile of the engine is required. This is the adoption path that keeps the ecosystem extensible without forking.

---

## Related

- [01 — Architecture Overview](01-architecture-overview.md)
- [02 — Packages and Folder Structure](02-packages-and-folder-structure.md)
- [04 — Libraries, Tooling and Testing](04-libraries-tooling-and-testing.md)
- [ADR-004 Template Pack Format](../adr/ADR-004-template-pack-format.md)
- [REF Specification Format Support](../adr/REF-specification-format-support.md)
