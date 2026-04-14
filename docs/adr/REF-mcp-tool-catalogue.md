# Reference: MCP Tool Catalogue

**Status:** Reference — not yet fully specified  
**Date:** 2026-04-12  
**Relates to:** ADR-005 (MCP Interface Design)  
**Note:** This document lists candidate tools and their intent. Signatures, response schemas, and error contracts are implementation concerns defined at build time, constrained by the decisions in ADR-005.

---

## Principles (from ADR-005)

- Responses are layered clusters — core cluster always returned, overlay summary always included, overlay detail on request
- Filters are expressed as a filter object, not typed parameters
- Branch scope is multi-branch — tools accept a `branches` list
- Analysis flags are pre-computed at refresh time; detail is fetched separately

---

## Graph Queries

**Get cluster**  
Fetch a single cluster by node ID. Returns the full cluster document with overlay summary. Core tool — agents use this most frequently.

**List clusters**  
Query clusters matching a filter object. Returns lightweight cluster summaries (root node properties only, no owned children) — agents call get cluster for full detail on specific results.

**Get lineage**  
Traverse edges from a starting node in a specified direction, to a specified depth. Returns the subgraph of nodes and edges reachable from the root.

**Get field lineage**  
Specialised lineage traversal following only `maps-to` and `derived-from` edges from a field node. Returns the chain of field-level correspondences across schema boundaries.

**Search**  
Natural language or keyword search over node names, descriptions, and template types. Returns ranked cluster summaries.

---

## Overlay Detail

**Get threads**  
Fetch full thread detail for a node or owned node. Includes body, history, and resolution status. Agents call this when the overlay summary shows open threads worth investigating.

**Get drift detail**  
Fetch the full drift report for a node — which properties differ, which fields are missing or added, what the derived layer contains. Agents call this when the overlay summary `drifting` flag is true.

**Get branch versions**  
Fetch the full cluster document for a node across specified branches. Agents call this when the overlay summary shows in-flight versions on other branches they need to inspect.

**Get branch conflicts**  
Fetch the conflict report for a node — which branches have incompatible versions and which specific properties conflict. Agents call this to understand what needs resolution before merging.

---

## Graph Mutations

**Create cluster**  
Create a new root node cluster file with its template-required properties.

**Update cluster**  
Update properties on an existing root node — flat properties, state, stability, description.

**Remove cluster**  
Soft-delete a node by transitioning state to `removed`. Never hard-deletes.

**Create edge**  
Create an edge between two nodes. Validated against the core edge type vocabulary.

**Remove edge**  
Hard-delete an edge. Edges have no historical identity worth preserving.

**Create field mapping**  
Convenience wrapper for creating a `maps-to` edge between two field nodes.

**Rename node**  
First-class rename — creates a `renamed-from` edge, transitions old node to `removed`, flags affected edges for review.

---

## Threads

**Create thread**  
Create a discussion, question, or reasoning-trace thread on a node, edge, or field. Agents may not create instruction threads.

**Resolve thread**  
Mark a thread as resolved with an optional resolution note.

---

## Branch and Sync

**Sync**  
Trigger an immediate Git fetch and incremental cache update. Agents call at session start to ensure current state.

**List branches**  
Return all open remote branches with their status relative to main — commits ahead/behind, conflict flag.

**Create branch**  
Create a new branch on the graph repo for in-flight design work.

---

## Utility

**Get template**  
Return the full resolved template definition for a given template name, including merged schema if `extends` is declared.

**Validate cluster**  
Validate a proposed cluster's properties against its template JSON Schema without writing. Agents use before committing a create or update.

**Get graph summary**  
High-level graph overview — components, node counts by template, open thread count, drift count, in-flight branch count. Agents use at session start to orient themselves.

---

## Session Start Pattern

The typical agent session start sequence:

1. `sync` — ensure current state
2. `get graph summary` — orient to the graph
3. `get threads` filtered to `instruction` type — check for pending human instructions
4. Begin work

---

## Candidate Future Tools

Tools not needed in v1 but worth tracking:

- **Accept drift** — mark a drift instance as intentional (design intentionally differs from code)
- **Propose merge** — suggest merging two in-flight branches that affect the same nodes
- **Get change impact** — given a proposed change to a node, return all nodes and edges that would be affected
- **Export cluster as TypeSpec** — output plugin; generate a TypeSpec file from an agreed API endpoint cluster (see REF-typespec-integration-opportunities)
- **Export component as OpenAPI** — output plugin; generate an OpenAPI spec from all agreed API endpoints in a namespace
