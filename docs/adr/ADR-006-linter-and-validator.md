# ADR-006: Linter and Validator

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-002 (Graph File Format), ADR-003b (Core Logical Data Model), ADR-004 (Template Pack Format), ADR-004b (Edge Type Vocabulary)  
**Related:** ADR-005 (MCP Interface Design)  
**See also:** ADR-006-rules.md — the complete rule catalogue derived from this decision

---

## Context and Problem Statement

The design graph stores its canonical state in YAML files in a Git repository. There is no database enforcing referential integrity at write time. The linter is that enforcement layer — it validates graph files against the rules established across all previous ADRs and surfaces violations before they are merged.

Three decisions need to be made:

1. **When does the linter run, and in how many deployment contexts?**
2. **What is the severity model — how do violations communicate urgency, and who controls it?**
3. **Are rules static or is the rule set itself extensible?**

The specific rules the linter enforces are catalogued in the accompanying reference document (ADR-006-rules.md), which is the normative source for rule IDs, descriptions, and default severities. This ADR decides the architecture those rules are built on.

---

## Decision Drivers

- **Mechanical enforcement only.** The linter validates what is deterministically checkable from files alone — ID format, reference resolution, schema conformance, naming conventions. It does not judge design quality or completeness. Those are human concerns.
- **Progressive adoption.** A team starting with the tool should not be immediately blocked by linter failures on a partial graph. The default configuration must allow a graph to be built incrementally without constant friction.
- **Consistent feedback across contexts.** Engineers running `graph lint` locally should see the same results as CI. Surprises in CI after a clean local run undermine trust in the tool.
- **Rules live close to the decisions that create them.** Each ADR that establishes a structural rule declares it explicitly. The rule catalogue collects those declarations; it does not invent new rules. This ensures traceability between architectural decisions and their enforcement.

---

## Decision 1: Deployment Contexts

### Option A: CI only

The linter runs exclusively in CI on PRs to the graph repo. No local tooling.

**Pros:** Simple to operate; no local installation required  
**Cons:** Feedback loop is slow — engineers discover violations only after pushing; encourages "push and see" rather than "lint before push"  
**Verdict:** Insufficient — CI-only feedback is too slow for a tool used heavily by agents and engineers making frequent changes

---

### Option B: CI and local CLI (selected)

The linter runs in two contexts:

- **CI:** Full rule set, run on every PR. Produces pass/fail status and inline PR annotations at the relevant file and line.
- **Local CLI (`graph lint`):** Same rule set, same output format as CI. Engineers and agents run this before pushing. No surprises in CI.

**Pros:** Fast local feedback; consistent with CI; agents can lint before committing  
**Cons:** Requires the linter to be installable locally — acceptable given the MCP server already requires local installation  
**Verdict:** Correct deployment model

---

### Option C: CI, local CLI, and MCP server inline

The MCP server also runs the full linter on every write operation, blocking the write if any rule fires at error severity.

**Pros:** Catches violations at the earliest possible moment  
**Cons:** Write-time linting adds latency to every agent operation; a misconfigured pack that causes a linter error would prevent the MCP server from writing anything; the full rule set is expensive to run per-write at scale  
**Verdict:** Partially adopted — the MCP server runs a lightweight startup subset to confirm the graph is loadable, but does not run the full rule set per-write. The startup subset is defined in ADR-006-rules.md.

---

### Decision: Option B with a startup subset from Option C

Two deployment contexts for the full rule set (CI and local CLI) plus a lightweight startup subset in the MCP server. The startup subset is the minimum rules needed to confirm the graph can be loaded and traversed — structural integrity only, no quality or convention rules.

---

## Decision 2: Severity Model

### Option A: Binary — pass or fail

All rules either pass or fail. A single failure blocks the PR. No warnings.

**Pros:** Simple; unambiguous  
**Cons:** A single missing optional property would block merge; incompatible with progressive adoption; new rules would need to be introduced carefully to avoid immediately blocking all existing graphs  
**Verdict:** Too blunt for a tool used on evolving, partially complete graphs

---

### Option B: Fixed severity per rule

Each rule has a fixed severity (error or warning) defined in the tool. Errors block merge; warnings annotate but do not block. Teams cannot change severity.

**Pros:** Consistent across all teams; no configuration required  
**Cons:** Cannot accommodate teams at different maturity levels — a mature team may want all warnings promoted to errors; a new team may want fewer blocking rules while they establish their graph  
**Verdict:** Insufficiently flexible

---

### Option C: Default severity with team-level overrides (selected)

Each rule has a default severity (error or warning) defined in ADR-006-rules.md. Teams may promote specific warning rules to errors in `graph.yaml`. Teams may not demote error rules to warnings — error rules reflect structural invariants the tool depends on.

```yaml
# graph.yaml
linter:
  rules:
    T-003: error    # Promote: required properties must always be present
    E-005: error    # Promote: outgoing edge constraints enforced strictly
  ignore:
    - "components/legacy/**"   # Exclude legacy path during migration
```

The `ignore` field accepts glob patterns relative to the graph repo root. This supports gradual adoption — teams can exclude parts of the graph they have not yet cleaned up without suppressing rules globally.

**Pros:** Default configuration is progressive-adoption-friendly; mature teams can opt into strict enforcement; ignore patterns support legacy graph migration  
**Cons:** Configuration adds surface area; teams must actively manage severity as their graph matures  
**Verdict:** Correct balance between strictness and flexibility

---

### Decision: Option C — default severity with team-level overrides

---

## Decision 3: Rule Set Extensibility

### Option A: Fixed rule set

The rule set is defined entirely by the tool. No custom rules.

**Pros:** Simple; no custom rule surface to maintain; the tool's behaviour is fully predictable  
**Cons:** Teams with specific conventions (e.g. all API endpoints must have a description, all agreed nodes must have a non-empty stability) cannot enforce them through the linter  
**Verdict:** Acceptable for v1 — custom rules are a future enhancement

---

### Option B: Custom rules via configuration

Teams declare additional rules in `graph.yaml` using a rule DSL or JSON Schema assertions.

**Pros:** Teams can encode their own conventions in the linter  
**Cons:** Requires designing and implementing a rule DSL; significant additional surface area; most teams' conventions can be expressed through template JSON Schema required fields rather than custom rules  
**Verdict:** Premature — template required properties already cover many convention-enforcement use cases; a custom rule DSL has no concrete v1 use case

---

### Option C: Custom rules via pack-defined validators (future)

Packs may declare validators — small scripts or JSON Schema assertions that run during linting. Teams install a pack and get its custom rules alongside its templates.

**Pros:** Extensibility aligns with the pack model; community packs can ship conventions alongside templates  
**Cons:** Requires a safe execution model for pack-defined scripts; out of scope for v1  
**Verdict:** The right long-term model; deferred

---

### Decision: Option A for v1 — fixed rule set; Option C noted as the planned extension point

The rule set in v1 is the set of rules derived from all previous ADRs, catalogued in ADR-006-rules.md. Custom rule extensibility via pack-defined validators is deferred to a future ADR.

---

## Consequences

**What becomes easier:**
- Referential integrity is enforced at CI time without a database — broken references and malformed files are caught before merging
- Progressive adoption is supported — default warnings guide teams without blocking them; error promotion is opt-in
- Agents can lint locally before committing, preventing CI surprises

**What becomes harder:**
- Teams must actively manage linter configuration as their graph matures — promoted rules and ignore patterns require maintenance
- The separation of startup subset (MCP server) from full rule set (CI/CLI) means some violations are only caught at CI time

**What is newly possible:**
- CI can enforce graph quality as rigorously as code quality
- The `ignore` pattern supports gradual adoption of existing graphs without requiring a clean starting state
- Future pack-defined validators extend the rule set in alignment with the pack model

---

## Related

- ADR-002: Graph file format — file format and naming rules collected in ADR-006-rules.md
- ADR-003b: Core logical data model — node and edge invariants collected in ADR-006-rules.md
- ADR-004: Template pack format — template schema compliance and pack integrity rules collected in ADR-006-rules.md
- ADR-004b: Edge type vocabulary — edge constraint rules collected in ADR-006-rules.md
- ADR-005: MCP interface design — MCP server runs startup subset defined in ADR-006-rules.md
