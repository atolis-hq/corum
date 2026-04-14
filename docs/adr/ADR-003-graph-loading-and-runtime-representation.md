# ADR-003: Graph Loading and Runtime Representation

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-001 (Storage and Interaction Architecture), ADR-002 (Graph File Format and Cluster Boundaries)  
**Related:** ADR-005 (MCP Tool Surface), ADR-007 (Hosted Commercial Tier)

---

## Context and Problem Statement

ADR-001 established that the MCP server builds an in-memory graph from YAML files in the Git repository and serves it to agents and CLI consumers. ADR-002 defined the file format. This ADR decides **how the graph is loaded and represented at runtime**.

The central design constraints are:

1. **Fields and owned nodes are first-class at runtime.** ADR-002 clusters owned nodes (fields, enum values, invariants, operations) into parent cluster files for readability. At runtime, every node must be independently addressable, queryable, and traversable regardless of how it is grouped in files.

2. **Multi-branch projection is a core capability.** The tool's primary differentiating value is branch-aware provenance of in-flight changes. This requires the runtime representation to hold a merged view of multiple open branches simultaneously — not just a single branch — and to detect where branches conflict. A design that only supports a single branch view fails the core objective.

3. **Git is the source of truth, not a database.** The runtime representation is derived from files. It is rebuilt or updated incrementally via Git fetch. No persistent database exists in v1.

4. **Query performance must support agent interaction latency.** Agents calling MCP tools expect near-instant responses. Lineage traversal, template-based filtering, and drift detection must all complete in milliseconds for graph sizes realistic in v1 (hundreds to low thousands of nodes).

5. **The MCP server may be deployed as a Docker container.** ADR-001 established the MCP server as a local process requiring no hosted infrastructure. Docker is a valid packaging model for this — Docker Desktop with the MCP Toolkit provides first-class support for containerised MCP servers with Claude Desktop, Cursor, and other clients, with one-click setup and automatic credential handling. A Docker-packaged MCP server is still a local process in operational terms: it starts on demand, requires no cloud infrastructure, and stops when the session ends. This changes the distribution constraint for options that require a JVM or a separate server process — if the MCP server ships as a Docker image, co-locating those dependencies inside the container is operationally acceptable, though it increases image size and startup time. Native binary options remain preferable where available.

---

## Prior Art and Ecosystem Context

Several existing tools solve adjacent problems and inform this decision. Understanding where they stop is as important as understanding what they do.

**yaml-graph** (nextmetaphor/yaml-graph) is a Go CLI that loads YAML-defined nodes and relationships into Neo4j Community Edition via Docker, validates definitions, and generates reports via Go templates. It validates the core YAML-in-Git-loaded-into-Neo4j pattern. It has no templates, no branch awareness, no MCP interface, no field-level lineage, and no design-time intent — it is a batch documentation tool. Notably it ships Neo4j inside Docker under Apache 2.0 for the tool itself, establishing a precedent for this packaging approach.

**YAMLtecture** (UnitVectorY-Labs) is a Go CLI that generates Mermaid diagrams from YAML nodes and links. Even thinner than yaml-graph — no graph database, no query layer, output only. Useful as confirmation that YAML-in-Git is a natural fit for architecture tooling.

**Structurizr** is the closest existing tool at the architecture level: DSL as source of truth, multiple views generated from one model, Git-backed, AI-queryable via MCP. Its differentiation is C4 model compliance. Its ceiling is the box-and-arrow level — it is deliberately silent on schemas, field-level lineage, and domain models. Your tool starts where Structurizr stops.

**EventCatalog** is the closest existing tool at the service/event level: extracts from schema registries, adds human context, visualises producer/consumer relationships, exposes via MCP. It solves the documentation problem for event-driven architectures. It has no branch awareness, no in-flight design state, no field-level lineage across domain model boundaries, no drift detection between API schemas and domain models, and requires hosted deployment. It is a direct competitor for the documentation use case; your differentiation is the design-time and in-flight capability.

**TypeSpec** (microsoft/typespec) is a higher-level API definition language — TypeScript-inspired, open source, MIT licensed — that compiles to OpenAPI 3, JSON Schema, Protobuf, and client/server stubs simultaneously. It is not a competitor; it operates at the API contract definition layer and has no concept of domain models, events, field-level lineage across service boundaries, or branch-aware design state. The relationship is complementary across three dimensions: (1) **extraction source** — TypeSpec files are a higher-fidelity extraction source than compiled OpenAPI YAML because they preserve model structure, named types, and decorators that survive the design intent that inlining and `$ref` resolution destroys; (2) **output target** — the graph could emit TypeSpec from agreed API endpoint nodes as an output plugin (per PDR-003), allowing teams to go from agreed design graph → TypeSpec → OpenAPI → code; (3) **drift detection source** — a team's TypeSpec files can be compared against design graph nodes to surface implementation drift, the same as code extraction but with richer structured input. TypeSpec warrants a dedicated section in the extraction pipeline ADR and as an output plugin in the template pack roadmap.

**OpenLineage / Marquez** is the data engineering community's solution to field-level lineage — tracking how columns flow through data pipeline transformations. The conceptual parallel is striking: Marquez tracks how a column in a source table flows through jobs to a reporting table; your tool tracks how a field in an API request maps to a field in a domain model. The problems are structurally identical. However, the primitives are fundamentally different — Marquez's core entities are Job, Run, and Dataset (operational, runtime-derived); yours are Node, Edge, and Context (design-time, intent-based). Adopting Marquez would require bending its model beyond recognition. The value is in studying its design patterns, particularly the **OpenLineage column-level lineage specification** which formalises field-to-field mapping as a structured facet — worth reading before finalising the `fieldMappings` format in ADR-002.

---

## The Multi-Branch Problem

This is the hardest constraint and the one most likely to disqualify options. The MCP server must be able to answer:

- "What nodes exist on `main`?"
- "What nodes are proposed on `feat/order-refund`?"
- "What nodes are in-flight across all open branches?"
- "Do `feat/order-refund` and `feat/payment-gateway` both modify the same node in incompatible ways?"

This requires the runtime to hold graph state for multiple refs simultaneously and be able to compute overlaps, diffs, and conflicts across them. Options that cannot support this natively require significant bespoke implementation on top.

---

## Options Considered

### Option A: Bespoke in-memory model (adjacency map)

Build a custom typed graph structure in memory: a map of node ID to node object, a map of edge ID to edge object, and adjacency indexes (edges-by-from, edges-by-to). Multi-branch support via a `BranchOverlay` structure per open branch, merged onto the primary graph on query.

**Pros:**
- Zero dependencies — no embedded database to bundle, version, or operate
- Full control over the data model — exactly what is needed, nothing more
- Trivially testable without database state
- Memory footprint is minimal for realistic graph sizes
- Multi-branch overlay is straightforward to implement — each branch overlay is a partial map of node IDs to their branch-state versions, merged onto primary at query time

**Cons:**
- No query language — all graph traversal must be implemented from first principles
- Recursive traversal (lineage chains, reachability queries) must be hand-written and carefully bounded
- No persistence between MCP sessions — rebuilt from Git on each start (mitigated by incremental Git cache from ADR-001)
- No existing ecosystem for graph algorithms (shortest path, cycle detection, connected components)

**Effort:** Low to start, but graph algorithm implementation compounds over time

---

### Option B: Embedded graph database — TinkerGraph (Apache TinkerPop)

TinkerGraph is an in-memory graph database that implements the TinkerPop Gremlin graph traversal API. It runs embedded in the MCP server process with no external dependencies.

**Pros:**
- Gremlin traversal language is expressive and well-suited to lineage queries
- TinkerPop is a mature, widely-used graph standard with broad language support
- Graph algorithms (cycle detection, path finding) are available via the TinkerPop ecosystem
- The embedded model means no external service — starts and stops with the MCP server

**Cons:**
- TinkerGraph is Java/JVM — embedding it in a Node.js or Python MCP server requires a bridge (e.g. gremlin-javascript client to a local Gremlin server); if the MCP server ships as a Docker image this is contained within the image, but increases image size and cold start time
- Multi-branch support is not native — branches must be modelled as graph properties or subgraphs, requiring the same bespoke overlay logic needed in other options
- Gremlin syntax is unfamiliar to most engineers; maintenance overhead is higher than SQL or plain code
- TinkerGraph has no persistence — the graph is lost when the process exits, requiring a full rebuild on next start (no incremental Git cache benefit)

**Effort:** Medium to implement; the JVM bridge and Gremlin learning curve are the main costs

---

### Option C: Embedded graph database — Memgraph or similar in-process graph DB

Memgraph is an in-memory graph database with a Cypher query interface. It has an embedded/library mode targeting exactly this use case.

**Pros:**
- Cypher is more familiar than Gremlin to engineers who know Neo4j
- Native graph traversal performance
- In-memory model — no disk persistence required
- Cypher's `MATCH` patterns make lineage queries concise and readable

**Cons:**
- Memgraph embedded is less mature than its server mode — documentation and community support are thinner for the embedded path
- Multi-branch support is not native — same overlay problem as TinkerGraph
- Adds a compiled binary dependency; manageable inside a Docker image but adds image weight
- Cypher is still less familiar than plain code or SQL to most backend engineers
- Memgraph is BSL-licensed (Business Source License) — free for non-production use, requires a commercial license for production deployments above a threshold; terms need verification before committing

**Effort:** Medium; maturity and licensing risk are the primary concerns

---

### Option D: SQLite as a temporary query layer

Parse YAML files into a SQLite database on startup. Use SQL with recursive CTEs for graph traversal. SQLite runs in-process with no external service.

**Pros:**
- SQL is universally understood — no specialist query language
- SQLite is the most widely distributed embedded database in the world; bundling is trivial
- Recursive CTEs handle lineage traversal to the depths required (5-10 hops)
- The relational schema maps naturally to the logical model (nodes table, edges table, fields table)
- Multi-branch support via a `branch_overlays` table and view logic — more verbose than a graph DB but tractable
- Schema migrations are straightforward with SQLite
- The SQLite file can be persisted as the local cache (ADR-001) — rebuilt from Git diff, not from scratch, on subsequent starts

**Cons:**
- Graph traversal queries with recursive CTEs are verbose compared to Cypher or Gremlin
- At very deep traversal (10+ hops) or very large graphs, recursive CTE performance degrades
- The relational model does not naturally express multi-hop path queries — they require careful CTE construction
- Multi-branch queries require non-trivial view or CTE logic to produce merged branch projections

**Effort:** Medium; SQL expertise is widely available, reducing maintenance risk

---

### Option E: RDF triple store — Oxigraph (embedded)

Oxigraph is an embedded RDF triple store written in Rust with Python and JavaScript bindings. It supports SPARQL for querying.

**Pros:**
- RDF is a genuine graph standard — every relationship is a first-class triple
- SPARQL is a W3C standard query language with rich path expression support
- Oxigraph runs fully embedded with no external service

**Cons:**
- SPARQL is deeply unfamiliar to most engineers — significant learning curve
- RDF's triple-based model requires remodelling the node/edge/field structure into subject-predicate-object triples — a non-trivial translation
- Multi-branch support is not native
- The RDF/semantic web ecosystem, while mature, is not part of mainstream engineering practice
- Adds a compiled Rust binary dependency

**Effort:** High; the unfamiliarity of both the model and the query language creates long-term maintenance risk

### Option F: Neo4j — containerised server via Docker

Neo4j is the most widely deployed graph database and uses Cypher as its query language. It has no viable embedded mode for Node.js or TypeScript — the JavaScript driver requires a running Neo4j server connected via the Bolt protocol. In a Docker packaging model, Neo4j can be co-located as a sidecar service within the same Docker Compose setup as the MCP server, making it operationally viable as a local-only dependency. The yaml-graph project validates this pattern — it ships Neo4j Community Edition inside a Docker image under Apache 2.0 for the tool itself.

**Licensing clarification:** Neo4j Community Edition is licensed under **GPLv3** — not AGPL. The Commons Clause restriction that caused the federal litigation applies to the Enterprise Edition only. GPLv3 is a copyleft licence: if you distribute software that incorporates or links against GPLv3 code, you must make your source code available under a compatible licence. For an open source tool, this is satisfied by the tool itself being open source. For a closed-source commercial hosted tier, this becomes more complex — Neo4j has historically used legal pressure to push users toward commercial licences for production deployments, and active litigation (Neo4j v. Suhy, currently before the Ninth Circuit) means the legal landscape remains unsettled. The safe conclusion: GPLv3 Community Edition is usable for an open source local tool; the commercial hosted tier requires either a commercial Neo4j licence or a different database.

**Pros:**
- Cypher is the most readable and expressive graph query language evaluated — lineage traversal is concise and intuitive compared to recursive CTEs: `MATCH (api)-[:maps-to*1..10]->(field)` vs. a multi-level recursive CTE
- Native index-free adjacency provides genuine traversal performance advantages at scale — each node stores direct pointers to its neighbours, eliminating index scans for graph traversal
- Mature ecosystem, production-quality JavaScript driver, extensive documentation
- Docker packaging validated by prior art (yaml-graph) — Neo4j inside Docker alongside the tool is a known working pattern
- Could provide query language consistency between local (Community Edition) and hosted tier (AuraDB) if a commercial licence is obtained

**Cons:**
- No embedded mode for Node.js/TypeScript — always requires a separate running server process, even inside Docker
- GPLv3 licensing is compatible with open source local use, but creates legal complexity for the commercial hosted tier — the litigation precedent makes this a meaningful risk to manage
- Multi-branch support is not native — the same overlay model must be built on top regardless
- Docker startup time is non-trivial due to JVM initialisation — cold start on an on-demand local tool is a user experience cost
- Docker Desktop required for the packaging model to work — not universal among developers

**Where Neo4j's advantages activate vs. SQLite:**
The Cypher readability advantage is real but primarily a developer experience benefit — it does not deliver capabilities that SQLite cannot provide at v1 scale. The index-free adjacency performance advantage activates at graph sizes well beyond what v1 will reach (hundreds of thousands of nodes with deep traversal). The honest assessment: Neo4j earns its complexity at the hosted commercial tier with large multi-organisation graphs. For a local tool with hundreds to low thousands of nodes, SQLite's recursive CTEs are adequate and the simplicity advantage is decisive.

**Verdict:** The open source local use case is legally viable with Neo4j Community Edition (as yaml-graph demonstrates). The Cypher advantage is genuine but does not justify the startup cost, Docker dependency, and hosted tier licensing complexity at v1 scale. Revisit when the hosted tier becomes the primary product.

**Effort:** Medium to implement; Docker dependency, JVM startup cost, and hosted tier licensing are the operational constraints

---

**Chosen option: Option D — SQLite as a temporary query layer, with Option A as the fallback**

### Rationale

**SQLite is the pragmatic choice for v1.** It is universally understood, trivially distributed, and already earmarked as the local cache technology in ADR-001. Using it as the query layer unifies the cache and the runtime representation — the same SQLite file serves both purposes. There is no cold start: the cache is loaded once, updated incrementally via Git diff, and queried directly by the MCP server throughout a session.

**The multi-branch problem is tractable in SQL.** A `branch_nodes` overlay table stores node state per branch ref. A `branch_edges` overlay table does the same for edges. A merged view — "the graph as it exists across main plus all open branches" — is a UNION query with conflict detection via self-join. This is not elegant, but it is implementable, testable, and understandable by any engineer who knows SQL. The logic is explicit rather than hidden in a graph database's internals.

**Neo4j was evaluated seriously. Its advantages are real but activate at the wrong scale for v1.** The previous characterisation of Neo4j's licensing was imprecise: Community Edition is GPLv3, not AGPL with a Commons Clause. GPLv3 is compatible with an open source local tool — the yaml-graph project demonstrates this pattern working. The genuine concerns are: (a) the hosted commercial tier requires either an open source licence for that tier or a commercial Neo4j licence; (b) Neo4j's active litigation history makes the GPLv3 boundary a practical as well as legal risk to manage; (c) Cypher's readability advantage, while genuine, is a developer experience benefit rather than a capability gap — SQLite with well-designed recursive CTEs and views covers the traversal depths v1 requires; (d) Neo4j's index-free adjacency performance advantage activates at graph sizes well beyond v1's realistic scale. The right time to revisit Neo4j is when the hosted commercial tier becomes the primary product, at which point its Cypher consistency across local and hosted tiers and its native graph performance at scale both become more compelling.

**Docker packaging changes the distribution constraint but not the capability trade-offs.** Docker Desktop with the MCP Toolkit provides first-class support for containerised MCP servers. This means Neo4j inside Docker is operationally viable — yaml-graph validates this pattern. But Docker changes distribution, not capability: neither TinkerGraph, Memgraph, Oxigraph, nor Neo4j gains native multi-branch support or eliminates the need for the same bespoke overlay logic from running inside a container. SQLite's advantage — a single embedded file, no separate process, universal familiarity, no Docker dependency — is not diminished by Docker availability.

**Option A (bespoke model) remains viable as a fallback.** If SQLite proves to add unnecessary complexity, a plain in-memory adjacency map can replace it with no change to the MCP tool surface. The data model is identical — the persistence layer changes, not the logical structure.

### Multi-branch projection model

The MCP server maintains a SQLite database with the following structure for multi-branch support:

**Primary graph tables:** `nodes`, `edges`, `fields`, `field_mappings` — populated from the `main` branch (or configured default ref) on startup.

**Branch overlay tables:** `branch_nodes`, `branch_edges` — one row per node/edge per branch that differs from `main`. On any write to a branch, the changed node or edge is upserted into the overlay table with its branch ref.

**Merged view:** A SQL view (or CTE at query time) that unions the primary graph with all branch overlays, applying branch-specific values where they exist. Conflict detection is a query that finds the same node ID with different values across two or more branch overlay rows.

```sql
-- Conceptual merged view across main + all open branches
SELECT 
  COALESCE(bo.node_id, n.id) as node_id,
  COALESCE(bo.branch_ref, 'main') as branch_ref,
  COALESCE(bo.state, n.state) as state,
  COALESCE(bo.properties, n.properties) as properties,
  COUNT(*) OVER (PARTITION BY COALESCE(bo.node_id, n.id)) as branch_count
FROM nodes n
LEFT JOIN branch_nodes bo ON bo.node_id = n.id
-- branch_count > 1 means this node has in-flight versions on multiple branches
```

**In-flight detection:** Any node with `branch_count > 1` is in-flight across multiple branches. Any node where the `main` version and a branch overlay version differ is a candidate for drift or conflict review.

This model starts with one branch overlay (v1) and extends naturally to multiple by adding rows to the overlay tables. The MCP server fetches open branches from the Git remote on startup and builds overlays for each.

### Starting point for v1

V1 implements the primary graph (main branch) and a single branch overlay. The data model and query structure are designed for multiple overlays from day one — adding support for multiple open branches in a subsequent iteration requires adding Git fetches and overlay rows, not redesigning the model.

---

## Runtime Loading Process

1. **Startup:** MCP server starts, points at locally cloned graph repo
2. **Primary graph build:** Fetch main branch, parse all cluster files and edge files, load into SQLite `nodes`, `edges`, `fields`, `field_mappings` tables
3. **Branch overlay build:** Fetch all open remote branches, run `git diff --name-only main <branch-sha>` per branch, parse only changed files, load into `branch_nodes` and `branch_edges` tables
4. **Refresh cycle:** On configurable interval or on `sync` tool call, re-fetch and apply incremental diffs via Git SHA comparison
5. **Write path:** MCP mutation tool calls write YAML files, commit, push, then upsert into the relevant SQLite table immediately — no full reload required

---

## Consequences

**What becomes easier:**
- Multi-branch graph projection is a first-class query from day one, not a later addition
- The SQLite file is the ADR-001 local cache — one technology serves both purposes
- SQL is universally understood — any engineer can inspect, debug, or extend the query layer
- Conflict detection across open branches is a SQL query, not a bespoke algorithm
- The data model can be inspected directly with any SQLite client during development

**What becomes harder:**
- Deep recursive traversal (10+ hops) requires careful CTE depth management
- The branch overlay model adds table complexity that must be well-documented for future engineers
- Multi-branch conflict resolution logic in SQL is verbose — readability requires careful view and CTE naming

**What is newly possible:**
- An agent can ask "which nodes are in-flight across all open branches and which of those conflict?" — answered by a single query against the merged view
- The SQLite file can be inspected as a debugging artefact when MCP server behaviour is unexpected
- The hosted commercial tier (ADR-007) replaces SQLite with Postgres using an identical schema — no data model redesign required

---

## Detailed Data Model

The detailed SQLite schema — including all tables, indexes, views, and CTE patterns for common queries — is deferred to implementation. The logical entities are:

- `nodes` — one row per root node; `properties` as JSON
- `fields` — one row per field/enum value/invariant/operation; foreign key to parent node
- `edges` — one row per edge between root nodes
- `field_mappings` — one row per field mapping on an edge
- `branch_nodes` — overlay of node state per open branch ref
- `branch_edges` — overlay of edge state per open branch ref
- `components` — one row per component directory

Indexes are maintained on: node ID, node template, node state, node stability, edge from-node, edge to-node, branch ref.

---

## Related

- ADR-001: Storage and interaction architecture — establishes Git fetch as the data source and SQLite as the local cache
- ADR-002: Graph file format — defines the cluster files and edge files parsed into this runtime model
- ADR-004: Template pack format — defines the template types that constrain node `template` values
- ADR-005: MCP tool surface — the query patterns this model must support efficiently
- ADR-007: Hosted commercial tier — replaces SQLite with Postgres using an identical logical schema; revisit Neo4j at this stage
- PDR-001: Tool scope and node taxonomy — state and stability models represented in this schema

**Prior art references:**
- yaml-graph (nextmetaphor/yaml-graph) — validates the YAML-in-Git-loaded-into-Neo4j-via-Docker pattern; Apache 2.0 licensed tool with GPLv3 Neo4j Community Edition
- YAMLtecture (UnitVectorY-Labs/YAMLtecture) — validates YAML-in-Git for architecture tooling at the diagramming layer
- Structurizr — DSL-as-source-of-truth architecture tool; validates MCP as the agent interface; operates at C4 level, not field/schema level
- EventCatalog — direct competitor for the documentation use case; validates YAML-in-Git, MCP, and Git CI integration; no design-time or branch-aware capability
- OpenLineage column-level lineage specification — read before finalising the `fieldMappings` format in ADR-002; formalises field-to-field mappings as a structured facet
- Marquez — OpenLineage reference implementation; not adoptable (wrong primitives and infrastructure model) but valuable as design pattern reference for lineage event modelling
