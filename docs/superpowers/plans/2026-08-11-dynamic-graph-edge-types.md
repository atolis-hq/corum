# Dynamic Graph Edge Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every visible edge type declared by installed packs in the graph UI, with new types enabled by default.

**Architecture:** The existing `/api/graph` response already filters structural and hidden edges from the graph engine. The client will derive its edge-type controls from that response instead of a static built-in list. Preference persistence will move from a visible-type allowlist to a hidden-type denylist, preserving prior choices for the legacy built-ins while allowing future custom types to appear automatically.

**Tech Stack:** TypeScript/Express, React JSX, Node.js built-in test runner.

---

### Task 1: Prove custom graph edges reach the web response

**Files:**
- Modify: `test/web.test.ts`

- [x] **Step 1: Write the failing test**

Add a `GET /api/graph` assertion using a pack-declared `precedes` edge type and expect that edge in the response.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: the new test fails until the test graph contains the pack declaration and explicit edge.

- [x] **Step 3: Add only the test fixture setup needed for the endpoint assertion**

Extend the test graph fixture with the custom edge type and explicit edge; do not add server-side type allowlists.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test`

Expected: the endpoint includes the custom visible edge and excludes structural edges.

### Task 2: Derive graph controls from response edge types

**Files:**
- Modify: `web/graph.jsx`
- Modify: `test/web.test.ts`

- [x] **Step 1: Write failing static UI assertions**

Assert that the graph UI derives available types from `graphData.edges`, passes them to the toolbar, and has no `ALL_EDGE_TYPES` constant.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: source assertions fail because the static edge list remains.

- [x] **Step 3: Implement dynamic type discovery**

Compute the sorted unique types in `GraphView`, use them for toolbar pills and scope options, and keep existing built-in colours plus the neutral fallback for unknown types.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test`

Expected: the static assertions pass and the full suite remains green.

### Task 3: Make new edge types visible despite saved preferences

**Files:**
- Modify: `web/graph.jsx`
- Modify: `test/web.test.ts`

- [x] **Step 1: Write failing static UI assertions**

Assert that the stored preference uses `hiddenTypes`, and that legacy visible preferences only migrate known built-in edge types.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: source assertions fail because persisted state is a visible allowlist.

- [x] **Step 3: Implement the versioned hidden-type preference**

Read a version-2 `{ hiddenTypes }` preference; migrate the legacy array by hiding only legacy built-ins omitted from that array. Build the visible set from the current response types minus hidden types and persist toggles in the version-2 form.

- [x] **Step 4: Run full verification**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Commit and open a pull request**

Commit the implementation, push `fix/graph-custom-edge-types`, and create a PR describing the dynamic discovery and preference migration.
