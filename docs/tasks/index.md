# Task Index

## Existing Features — Priority Order

| Priority | Feature | File | Summary |
|----------|---------|------|---------|
| 3 | Linter | [linter.md](linter.md) | Validate templates, nodes, and edges; detect broken edges |
| 4 | Rename & Deletion | [renaminganddeletion.md](renaminganddeletion.md) | Rename nodes without losing linkage; renamed-from tracking across branches |
| 5 | User Journeys | [userjourneys.md](userjourneys.md) | Event modelling swimlanes; journey steps; relationship timelines |
| 6 | BDD Pack | [bdd.md](bdd.md) | Feature/scenario/Given-When-Then nodes linked to graph nodes |
| 7 | Edit Mode | [editmode.md](editmode.md) | UI for creating, editing, and deleting nodes |
| 8 | Search | [search.md](search.md) | Text search across nodes in MCP, API, and UI |
| 9 | Components Page | [componentspage.md](componentspage.md) | List components grouped by type; table or card layout |
| 10 | Graph Visualiser | [graphvisualiser.md](graphvisualiser.md) | Visual navigation: lineage, component map, relationship views |
| 11 | Unmapped Fields & Unlinked Nodes | [unmappedfields.md](unmappedfields.md) | Report fields with no maps-to edges and nodes with no relationships; highlights lineage gaps |
| 12 | Node Review Workflow | [nodereviewworkflow.md](nodereviewworkflow.md) | Review queue for agent-proposed nodes; state transitions; bulk approve/reject |
| 13 | Agent Skills | [agentskills.md](agentskills.md) | Installable skill making MCP usage highly effective; process guidance |
| 14 | GitHub Actions Template | [githubactionstemplate.md](githubactionstemplate.md) | CI step to lint graph and template YAML on PR |
| 15 | Importers | [importers.md](importers.md) | Import from OpenAPI, AsyncAPI, JSON Schema to bootstrap graph |
| 16 | Dashboard | [dashboard.md](dashboard.md) | Branch diff vs main; pending nodes; open discussions |
| 17 | Custom UI | [customui.md](customui.md) | Pack-provided UI overrides for cards and pages; configured per node template |
| 18 | Semantic Matching | [semanticmatching.md](semanticmatching.md) | Identify semantically similar fields across branches and services |
| 19 | Delivery View | [deliveryview.md](deliveryview.md) | Annotate nodes with epics/stories/milestones; Jira sync |
| 20 | Collaboration | [collaboration.md](collaboration.md) | Hosted comment threads on nodes; notifications; paid tier |

---

## Suggested Features

Gaps identified from PDRs and vision — not yet captured as tasks.

| Feature | Summary | Why High Value |
|---------|---------|----------------|
| **Code Extraction (Derived Layer)** | CI-triggered auto-extraction from codebases (OpenAPI spec, TypeScript types) to populate the derived layer via derived branches | Core to the AI-extracted/human-reviewed workflow; without it the design layer has no ground truth anchor |
| **Drift Detection** | Surface divergence between design intent and derived reality; show which nodes are stale, implemented, or missing | The primary mechanism keeping the graph honest; prerequisite for meaningful agent reasoning |
| **Impact Analysis** | Given a proposed field or node change, return all downstream nodes/edges affected across all services | Agents need this before designing; humans need it for governance; PDR-004 defines it as a first-class query |
| **Thread Primitives** | Implement the PDR-002 thread model: `discussion`, `instruction`, `question`, `reasoning-trace` as first-class graph nodes | Enables structured human↔agent communication; reasoning traces give future agents persistent design rationale |
| **Conflict Detection** | Warn when two in-flight design branches modify the same node or field; works without a central server | PDR-002 requirement; prevents agents and teams silently producing incompatible designs |
| **Node Review Workflow** | Review queue surfacing agent-proposed nodes for human sign-off; manage `draft → proposed → agreed` transitions | Makes human oversight practical at scale; PDR-006 defines this experience |
| **Multi-repo Composition** | Load graph from multiple git repos simultaneously; cross-service lineage without a central server | Tier 2 in PDR-002; unlocks the core cross-service value for teams with multiple services |
| **Extraction Adapter Interface** | Plugin model for extractors (TypeScript, Java, OpenAPI, AsyncAPI) that produce derived branches | Required to scale extraction beyond a single language; PDR-007 defines the derived branch contract |
| **Merge Gate** | Pre-merge validation enforcing graph integrity: no silent deletes, rename records, scope constraints | PDR-007 defines this; structural integrity enforcement rather than runtime rules |
| **Pack Marketplace / Registry** | Discover, share, and install community template packs | Lowers adoption cost; accelerates domain modelling for common patterns (REST, messaging, DDD) |
