# Node Identity, Renames, Deletes, and MCP Write Tools — Design

**Date:** 2026-07-03
**Status:** Approved for planning
**Implements:** PDR-005 (soft deletes, first-class renames, materialised threshold), PDR-004 (agent write access to the design layer)
**Out of scope:** structural collision detection / semantic matching (PDR-005 §collision detection, task 18) — it consumes this identity model but is a separate design. Derived-layer extraction and code-level materialisation. Threads.

---

## 1. Context and goals

Node IDs encode identity as an ownership path (`orders.DomainModel.order.schemas.order.fields.id`). Renaming a node therefore changes its ID, every descendant ID, and every edge endpoint that references them. Today the MCP surface is read-only and there is no rename or delete operation; PDR-005 has decided the product semantics (soft deletes, first-class renames with trails, a materialisation threshold) and deferred the mechanism to this design. PDR-004 requires full agent write access to the design layer via MCP.

Two problems are solved together because the second depends on the first:

1. **Identity** — what a rename *is*, where its history lives, and how branches that still hold the old name are matched.
2. **Write surface** — how agents (and later the web UI) mutate the graph safely across all three source types (plain file system, local git, remote git).

Key existing machinery this design builds on rather than replaces:

- `src/writer/graph-writer.ts` — serialises the entire in-memory graph to canonical cluster YAML + edge files (`serializeGraph`), already used by importers. Writes are full regeneration to canonical form; there is no surgical YAML editing.
- `GraphSource.commit(branch, ContentMap, message, options)` — works for file sources (writes files), local git, and remote git (commit + immediate push with rollback on failure).
- `renamed-from` — already a core edge type: `category: lineage, hidden: true`.
- `src/reconcile/index.ts` — importer reconciliation, currently matches purely by ID.
- `removed` — already a node/edge state.

## 2. Identity model

**The dot-path ID remains the sole node identity.** No UUID or secondary identifier is introduced. Stability across renames comes from a recorded trail, not from the ID. (A stable-UID model was considered and rejected: it makes edges, YAML files, and git diffs opaque, and requires migrating every existing graph — destroying the human-readable git-native property for a benefit the trail already provides.)

## 3. Rename semantics

`rename(nodeId, newName, options?)` is a first-class mutation, never a property edit. It performs atomically, in the working session (§7):

1. **Validate** — `newName` must satisfy the ID segment grammar (`validateSegment`) and be unique among siblings (same parent + section, or same `component.Template.` prefix for roots).
2. **Rewrite the node ID** — last segment replaced with `newName`.
3. **Prefix-rewrite descendants** — every node whose ID starts `{oldId}.` gets the prefix replaced with `{newId}.`. `parentId` fields are rewritten likewise.
4. **Rewrite edges** — every edge with an endpoint equal to or prefixed by the old ID is endpoint-rewritten (edge IDs are recomputed as `{from}__{type}__{to}`). Structural edges may equivalently be regenerated; explicit edges keep their properties, state, and stability.
5. **Record the trail** (when the threshold applies, §4):
   - append the old **ID** to a `previousNames` property on the node (ordered list, oldest first);
   - create an explicit edge `{newId}__renamed-from__{oldId}`, `state: proposed`, `stability: unstable`.

Renaming a cluster root also changes the cluster file path (paths derive from root IDs). The writer's full-regeneration commit emits the new file and drops the old one; no special handling is needed beyond `replaceGraphContent`.

**Rename chains.** When `B → C` happens after `A → B`, step 4 rewrites the existing `B__renamed-from__A` edge's `from` endpoint to `C`. The node ends up with `previousNames: [A, B]` (chronology) and edges `C → B`, `C → A` (each old ID resolvable in one hop). Only the renamed node itself gets trail edges; descendants are covered by prefix resolution (§5), which avoids tombstone explosion when renaming a schema or component.

**Dangling `to` is intentional.** The old ID no longer resolves to a node. `renamed-from` is `hidden: true` bookkeeping; the linter exempts hidden edge types from broken-edge checks (§11). No tombstone node is created.

## 4. Trail threshold

PDR-005's "materialised" gate is interpreted for the current system as **default-branch presence**, computed at mutation time — no stored flag:

> A rename or delete records a trail iff the node's ID exists in the default branch's committed graph.

Rationale: the threshold's purpose today is cross-branch identity matching, and the default branch is the shared record other branches fork from. Code-level materialisation ("has this existed in a prod release?") is unknowable until the derived layer exists; when extraction lands, it can add its own signal, and breaking-change *severity* is already `stability`'s job.

Consequences:

- Nodes created on a branch and renamed before merge are free rewrites — correct, because breaking changes do not apply to unreleased work.
- In file mode the single `local` branch *is* the default, so committed nodes get trails on rename. `renamed-from` is hidden from summaries/lineage defaults, and hard delete (§6) allows purging, so local noise stays low.
- **Manual override**: `rename` and `delete` accept `record_trail: boolean` to force or suppress the trail (e.g. importing already-released code directly onto a branch).

## 5. Alias map and cross-branch resolution

At load time an **alias map** is built from `renamed-from` edges: `oldId → newId`. Resolution is longest-prefix: `resolveAlias(id)` returns the exact mapping if present, otherwise rewrites the longest aliased prefix (so descendants of a renamed schema resolve without their own trail edges), applied repeatedly until fixpoint (chains resolve in one hop by construction, but prefix chains may compose).

Consumers:

- **Branch overlay and `diff_branch`** — before matching nodes across branches, IDs from the comparison branch are resolved through the viewing branch's alias map. A branch still holding `customerEmail` overlays onto main's `emailAddress` instead of appearing as unrelated add+remove. When a branch *modifies* a node whose ID the default branch has renamed, the diff flags it explicitly: *"edits a retired name — rebase or apply the rename."*
- **Import reconciler** (§6a).
- **`get_lineage` / `get_linked_fields`** — edges referencing retired IDs (e.g. from not-yet-updated branches) resolve through the map rather than dangling.

## 6. Delete semantics

Two tiers, per PDR-005:

- **`delete(nodeId)` — soft delete.** Sets `state: removed` on the node and its owned subtree. Nodes, properties, and edges remain in YAML and queryable. This is the default when the trail threshold (§4) applies.
- **`delete(nodeId, purge: true)` — hard delete.** Removes the subtree from the graph and deletes every edge touching any removed ID (no orphan edges survive). A deliberate secondary action.
- **Unmaterialised nodes** (threshold not met, no override): soft tier is skipped — plain `delete` purges directly. Pure design work leaves no tombstones.
- **`record_trail` override**: as with rename, forces the threshold outcome — `true` soft-deletes an unmaterialised node; `false` lets plain `delete` purge a materialised one (equivalent to `purge: true`).

Deleting an edge is always hard (edges carry no subtree); `state: removed` remains available on edges via `update_edge` for teams that want soft-removed relationships.

### 6a. Import integration

The importer pipeline gains alias-awareness — without it, re-imports would silently undo renames:

1. **Resolve before diff.** Incoming node IDs are passed through the alias map before `diffNodes`. A spec still using `customerEmail` merges into the renamed `emailAddress` node; the name difference is reported as **intentional in-flight drift** (the rename record exists), not as add+remove.
2. **Preserve trails through merges.** `previousNames` joins `state`/`stability`/`notes` in the system-preserved property set in `mergeProperties`, so `derivation: determined` re-imports cannot erase rename history.
3. **Rename suggestion heuristic (warning only).** When a single re-import both removes X and adds Y under the same parent with the same template, the import report emits: *"possible rename — record it with rename_node."* No automatic action; renames stay explicit.

The inverse case — code renamed while the graph was not — remains delete+add on import (old node soft-removed, new node added), surfaced by the same heuristic.

## 7. Mutation engine and working session

A new **`src/mutate/`** module owns all graph mutations. MCP write tools and the future web edit mode are thin wrappers over it — no mutation logic lives in `src/mcp/`.

**Working session.** Mutations apply to an in-memory working graph loaded from a branch head, plus a change journal:

- `startSession(branch?, { create?, autosave? })` — loads the base graph from `branch` (default: the source's default branch). `create: true` forks a new branch from the default branch head (git sources only; file sources have a single branch and error on `create`).
- Every operation **validates before applying**: ID grammar, sibling uniqueness, template property schemas, and edge-type constraints, reusing the linter's primitives. An invalid mutation throws with diagnostics and leaves the working graph untouched — never half-mutated. Lint *warnings* are returned in the result, not thrown.
- Reads issued through the session (and MCP reads while a session is open) see the working state.
- The journal records each operation for `pending_changes`, default commit messages, and autosave checkpoint messages.

**The session is the transaction.** Per-operation validation, atomicity at commit, `discardSession()` aborts. No generic batch/apply-operations tool is added: `apply_cluster` (§8) covers the real bulk case, and a second encoding of every operation would double the validation and error surface. Revisit only if agent round-trip cost proves material.

**Persistence** goes through the existing seam: `serializeGraph(workingGraph)` → `GraphSource.commit(branch, contentMap, message, { replaceGraphContent: true, createBranchIfMissing })`.

**Autosave** (`autosave` toggle on session start):

| Source | Autosave off (default for git) | Autosave on |
|---|---|---|
| File (no git) | in-memory until `commit_changes` | **default on** — every mutation writes through to disk; `commit_changes` closes the session |
| Local git | in-memory until `commit_changes` (one logical change = one commit) | each mutation lands a WIP checkpoint commit (`corum-wip: <op summary>`) |
| Remote git | same as local git | same; WIP commits push immediately (existing behaviour) |

At `commit_changes(message)` with git autosave, the session's WIP run is **squashed into one final commit — guarded**: only when every commit since session start is a session-authored WIP (detected by the `corum-wip:` marker and recorded SHAs). If an external commit interleaved, history is not rewritten: the final commit lands on top, WIPs are preserved, and the result says so. Squash on a pushed remote branch implies force-push; the guard is what makes that acceptable, and design branches are expected to be single-writer. Autosave trades checkpoint durability for commit-level atomicity; the toggle documents this.

**Concurrency:** one working session per server process at a time. `start_changes` while a session is open with pending changes is an error (`discard_changes` first); with no pending changes it resets cleanly. Multi-session support is out of scope.

## 8. MCP tool surface

All write tools are additive; the existing read tools are unchanged (reads reflect the working session while one is open).

| Tool | Parameters | Behaviour |
|---|---|---|
| `start_changes` | `branch?`, `create?`, `autosave?` | Open/reset the working session (§7) |
| `apply_cluster` | `document`, `mode: merge\|replace` | Upsert a cluster-style nested document — the same shape as cluster YAML / `get_cluster` output. `merge` updates what is present and leaves the rest; `replace` makes the document authoritative for its owned sections — absent children are deleted via §6 semantics. A changed key is **never** treated as a rename: it is delete+add, and the response carries the §6a heuristic warning. |
| `create_node` | `parent_id?`, `section?`, cluster-style document | Create a root cluster or an owned child (with nested children in one call). Structural edges generate automatically. Defaults `state: proposed`, `stability: unstable`. |
| `update_node` | `id`, `properties?` (patch), `state?`, `stability?` | Property patch; `null` clears a key. Cannot change the name — that is `rename_node`. |
| `rename_node` | `id`, `new_name`, `record_trail?` | §3 |
| `delete_node` | `id`, `purge?`, `record_trail?` | §6 |
| `create_edge` | `from`, `to`, `type`, `state?`, `stability?`, `notes?`, `properties?` | Validated against edge-type constraints and endpoint existence |
| `update_edge` | `id`, patch fields | Endpoints and type are immutable (delete + create instead) |
| `delete_edge` | `id` | Hard removal |
| `pending_changes` | — | Journal + summary diff of working graph vs base |
| `discard_changes` | — | Abort the session |
| `commit_changes` | `message?` | Serialise + `GraphSource.commit`; default message summarises the journal. Squash-with-guard under git autosave (§7). |

Error shape: validation failures return the linter's diagnostic format (severity, message, nodeId) so agents can self-correct; warnings ride along on success responses.

## 9. Source-type matrix

| Capability | File (no git) | Local git | Remote git |
|---|---|---|---|
| Sessions + all mutations | ✓ | ✓ | ✓ |
| `start_changes(branch)` | only the single `local` branch | ✓ | ✓ |
| `create` branch | ✗ (error) | ✓ | ✓ (pushed on first commit) |
| Trail threshold basis | committed files of `local` | default branch head | `origin/<default>` head |
| Autosave | write-through (default on) | WIP commits | WIP commits (pushed) |
| Squash at commit | n/a | guarded ref rewrite | guarded force-push |

## 10. Validation and error handling

- Mutations validate synchronously and throw `MutationError` (new, mirrors `QueryError`) carrying `Diagnostic[]`. The working graph is never left partially mutated by a failed operation.
- `commit_changes` re-runs the full linter over the working graph before serialising; errors block the commit (warnings do not).
- Concurrent-write detection at commit: if the branch head moved since session start (and the moves are not session WIPs), the commit fails with a clear message — no merge is attempted. The session can be discarded and replayed.

## 11. Linter changes

- **Hidden-edge exemption**: edge types with `hidden: true` are exempt from broken-edge (unresolved endpoint) checks — their `to` may legitimately be a retired ID.
- **`previousNames`** is recognised as a system property on any node (list of valid node IDs, each expected to differ from the current ID).
- New rule: a `renamed-from` edge whose `from` does not exist is an error (the live end must resolve).

## 12. Testing

- **Mutation unit tests** — every operation: happy path, validation failure leaves graph untouched, defaults applied.
- **Rename cascade** — descendant prefix rewrite, `parentId` rewrite, structural + explicit edge rewrite, chain behaviour (`previousNames` order, edge re-pointing), root rename moving the cluster file, threshold on/off/override.
- **Round-trip invariant** — mutate → `serializeGraph` → reload → graphs structurally equal (extend the existing writer round-trip tests).
- **Alias resolution** — exact, prefix, chained; overlay/diff matching across a rename; "edits a retired name" flag.
- **Import-after-rename** — re-import of an unrenamed spec merges into the renamed node and reports in-flight drift; `previousNames` survives determined merges; delete+add heuristic fires.
- **Session/persistence** — commit via file, local git, remote git (existing git test harness); autosave write-through and WIP checkpoints; squash guard with and without interleaved external commits; head-moved conflict detection.
- **Linter** — hidden-edge exemption; live-end rule.
- **MCP end-to-end** — start → apply_cluster → rename → commit flow over stdio.

## 13. Future work (explicitly deferred)

- Structural collision detection / semantic matching across branches (consumes the alias map and trail data).
- Derived-layer extraction setting code-level materialisation and `implemented` state.
- Generic batch operation tool, if agent round-trip cost warrants it.
- Multi-session concurrency.
- Thread primitives (`discussion`, `question`, etc.) attached to rename/collision events.

## Decision log

| Decision | Choice |
|---|---|
| Scope | Identity + rename + delete + write tools; collision detection out |
| Identity | Path IDs remain sole identity; no UUIDs |
| Trail storage | Ordinary graph data: `previousNames` property + `renamed-from` edge with intentionally dangling `to`; no tombstones, no ledger file |
| Trail threshold | Default-branch presence, computed at mutation time; `record_trail` override; code-materialisation deferred |
| Persistence | Working session + explicit `commit_changes`; autosave toggle (file: write-through, default on; git: guarded WIP-squash) |
| Batching | No generic batch tool; `apply_cluster` covers bulk edits; session is the transaction |
| Renames in `apply_cluster`/imports | Never inferred — heuristic warning only; `rename_node` is the sole rename path |
