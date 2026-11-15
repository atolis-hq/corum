# PDR-008: Namespaces and Pack-Defined Kinds

**Status:** Accepted (items marked *Provisional* are recommendations awaiting confirmation on #112 and may change before implementation)
**Date:** 2026-11-15
**Decider:** Product Owner

---

## Problem Statement

Every node ID starts with a first segment that the tool and its docs call the *component* (`orders.DomainModel.order`). The grammar does not require it to be a software component, but everything else assumes it is: the on-disk folder is `components/`, the web UI groups and routes by component, and the API and MCP tools filter and report by component.

That blocks modelling things that are not components but live in their own right and reference components: user journeys, event models, initiatives. A journey is not part of a component. We want packs to introduce such things without engine changes, and Corum to stay architecture-first by default.

---

## Context

- PDR-001: the tool is methodology-agnostic; node types are template-defined.
- PDR-003: all node types are templates; view and output plugins target node types and are separate from the template pack.
- PDR-006: humans review through node-type-aware perspectives; plugins can add perspectives.
- ADR-002: IDs are explicit and declared in each file; folders are for human navigation only.
- ADR-004b: packs extend the edge type vocabulary through a declared file with a category. Kinds follow the same extension model.
- Ownership is the materialized `parentId` chain, not the ID prefix (#100, #120). The interchange adapter accepts explicit ownership (#121, #126). These make a short first segment safe as a namespace.
- There is no adoption yet, so no migration or backwards compatibility is required. Data and callers are fixed where they break.

---

## Options Considered

### Option A: Keep "component" as the universal top-level concept

Model journeys and event models as pseudo-components.

- **Pros:** No change.
- **Cons:** Wrong vocabulary in the UI and API; every non-component thing is mislabelled; no way for a plugin to recognise a journey.
- **Effort:** None
- **Fit:** Poor.

### Option B: Fixed set of top-level kinds in the engine

The engine ships `component`, `journey`, `event-model`, etc.

- **Pros:** Simple to implement.
- **Cons:** Contradicts PDR-001 and PDR-003 (no hardcoded node types, no methodology imposed); every new kind needs an engine release.
- **Effort:** Medium
- **Fit:** Poor.

### Option C: Namespaces with pack-defined kinds *(chosen)*

The first ID segment is a **namespace**. Each namespace has exactly one **kind**, a classification supplied by packs. Core ships one kind, `component`, which is the default. Plugins register for a kind.

- **Pros:** Engine stays methodology-agnostic; consistent with how packs already extend edge types; plugins have a clean extension point; existing graphs only need the folder rename.
- **Cons:** One more concept to explain; the UI must group by a data-driven kind.
- **Effort:** Medium
- **Fit:** Strong.

---

## Decision

**Chosen option: C, with the following decisions.**

### Decided

1. **Terminology.** *Namespace* is the generic engine-level term (code, API, docs, grammar) for the first ID segment. *Kind* classifies a namespace. *Component* remains the name of the default kind. ("Scope" was rejected: it collides with existing graph UI thread scoping, #56 and the extraction strategy. "Domain", "context" and "cluster" already have meanings in Corum.)
2. **One kind per namespace.** A namespace of kind `component` is a component; of kind `journey`, a journey. A second dimension is a tag, not a second kind. The kind classifies the namespace, not the templates it owns: a component namespace owns many templates.
3. **Default kind is `component`.** A namespace with no declaration is a `component`. Existing graphs need no declaration.
4. **The on-disk root folder is `nodes/`**, beside `edges/`. `components/` is dropped with no alias and no migration. Fixtures, the sample graph and the repo's own graph are updated by hand.
5. **Kinds are defined by packs**, in a pack file parallel to the edge type definitions. Core declares `component`.
6. **A namespace declares a non-default kind in its own folder** with a small standalone structured file. It does not depend on README or markdown support.
7. **Ownership comes only from `parentId`.** The ID prefix is a convention, never a correctness mechanism. Kind is never encoded in an ID.
8. **Engine behaviour does not depend on kind.** Kinds are classification and display metadata only. Template roles remain the only thing that drives engine behaviour.
9. **UI plugins subscribe to kinds.** A view plugin declares the kinds it handles. The core UI contains no knowledge of any kind other than the default.

### Provisional (recommended; confirm on #112 before implementation)

10. **Kind identifiers are free strings, matched exactly.** A kind id is a string that is valid as an ID segment (for example `event-model`). Packs declare the kind ids they provide, and packs and plugins match on the exact string. An unrecognised kind never breaks loading: it produces a lint warning, the namespace is still listed and groupable, and it falls back to generic display. Kinds are not required to correspond to a template. Tying a kind to a template (so that a namespace is validated against that template's properties) is deferred until namespaces need schema-validated properties. A kind may optionally list the templates it expects its namespaces to own; that is an advisory lint warning, never enforced by the loader. `component` is unrestricted.
11. **The namespace declaration is metadata, not a node, in the first version.** The file is `nodes/<namespace>/namespace.yaml` with `kind` and an optional `description`. This avoids a single-segment node ID and the grammar exception it would need. If namespaces later need edges, properties or a README, promote the declaration to a node and revisit.
12. **UI behaviour.**
    - Navigation groups by kind, with one section per kind labelled from the kind definition. Today's component navigation is the `component` section.
    - The existing component-level graph and the component pages are the views for the `component` kind and stay the default. They show only `component` namespaces unless a filter says otherwise.
    - The dashboard stays graph-wide and adds a breakdown by kind. Component-specific widgets keep their meaning.
    - Non-component kinds get a generic fallback view: the namespace's owned nodes and its inbound and outbound edges. Richer views come from plugins registered for the kind (for example an event model view).
    - Mixed-kind graphs colour nodes by kind and offer a per-kind filter.

---

## Consequences

**What becomes easier:**
- Introducing journeys, event models, initiatives and similar through a pack, without engine changes.
- Writing a UI plugin for one kind without touching the core web app.
- Cross-cutting relationships: a journey owns its own nodes and references component nodes through ordinary explicit edges. "Which models reference this component" is a normal inbound-edge query.

**What becomes harder:**
- One more concept to document. The generic term (namespace) differs from the default kind's label (component).
- The `component` field, query parameter, route and UI labels need reviewing for the generic concept. They may be renamed outright since compatibility is not a concern.
- The namespace-level graph and dashboard must handle mixed kinds.

**What is newly possible:**
- Packs shipping their own kinds, with plugins keyed on those kinds.
- A kind-aware lint (unknown kind, unexpected templates).

**Risks and guard rails:**
- Interchange documents must never let a namespace capture ordinary roots. Explicit ownership (#126) guards this.
- Namespace names must be unique in the graph. Duplicate declarations or a folder name that does not match its namespace are lint errors.
- Do not restrict root ID length.

---

## Success Criteria

- A graph with no declarations loads with every namespace as `component`, with no new warnings, and the UI looks as it does today apart from the folder and labels.
- A pack can add a kind, and a namespace of that kind appears as its own section in navigation with the pack's label.
- A plugin for a new kind can be installed and rendered without any change to the core UI.
- No engine code branches on a kind other than the default.

---

## Implementation outline

Tracked on #112 and split into independently deliverable pieces: namespace and kind loading with the declaration file and default; the `nodes/` rename; API and MCP exposure and kind filtering; web UI grouping and filtering by kind; and pack kind definitions with lint rules.
