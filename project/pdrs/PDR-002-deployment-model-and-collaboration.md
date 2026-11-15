# PDR-002: Adoption Model, Deployment Tiers, and Collaboration Experience

**Status:** Accepted  
**Date:** 2026-04-12  
**Decider:** Product Owner  

---

## Problem Statement

The tool needs a deployment and collaboration model that answers three product questions:

1. What infrastructure, if any, should a team need to stand up before getting value from the tool?
2. How does the experience scale from a single developer on one service to an organisation across many services?
3. How do humans and agents communicate about proposed changes — and does that communication need to be shared infrastructure, or can it be local?

---

## Context

The tool is intended to be open source. Requiring hosted infrastructure before delivering core value is a well-documented adoption barrier for developer tools. The successful pattern is: zero infrastructure delivers genuine value; infrastructure unlocks compounding value.

The primary workflow is AI-extracted, human-reviewed (established in PDR-001). Agents propose graph changes; humans review, correct, and approve. This is inherently asynchronous — true simultaneous real-time collaboration between multiple humans editing the same node is not the common case and not a requirement. Offline support is also not a requirement.

The critical collaboration requirement is: **at design or write time, an agent or human must have awareness of all other in-flight proposed changes** — not just changes that have been formally merged or published.

Discussion and feedback between humans and agents is a first-class requirement. Without a structured feedback loop, agent proposals accumulate without review and the graph drifts from intent.

---

## Options Considered

### Option A: Infrastructure-first
The tool requires a hosted server or database from the start. All graph state, conflict detection, and discussion threads live centrally.

- **Pros:** Authoritative conflict detection; shared discussion threads from day one; real-time awareness
- **Cons:** Significant adoption barrier; infrastructure cost and maintenance; teams must make a hosting decision before seeing any value
- **Effort:** High
- **Fit:** Poor as the primary model — fails the adoption requirement

---

### Option B: Local-only
The tool works entirely locally with no shared state. No awareness of others' in-flight changes.

- **Pros:** Zero infrastructure; trivial to adopt
- **Cons:** Fails the conflict awareness requirement; two agents or humans can work in ignorance of each other
- **Effort:** Low
- **Fit:** Poor — fails a critical requirement

---

### Option C: Tiered adoption model *(accepted)*
The tool delivers genuine, complete value with zero infrastructure. Additional infrastructure unlocks collaboration and organisational scale — but as an upgrade, not a prerequisite.

Each tier feels complete rather than crippled. Teams adopt at the tier that matches their current needs and scale up without migration friction.

- **Pros:** Removes the adoption barrier entirely; scales naturally; open source and commercial tiers align cleanly; no team is forced to make infrastructure decisions before seeing value
- **Cons:** Requires careful design to ensure tier boundaries are clean and upgrade paths are smooth
- **Effort:** Medium — tier boundaries must be designed intentionally
- **Fit:** Strong

---

## Decision

**Chosen option: Option C — tiered adoption model**

### Deployment tiers

**Tier 1 — Zero infrastructure**
A single developer or small team on a single service. No server, no database, no hosting decisions. The tool installs as a local process and works immediately against an existing codebase. Discussion threads are local to the machine.

*What you get:* extraction, lineage, drift detection, human review, local discussion threads, single agent workflow.

**Tier 2 — Multi-service, no new infrastructure**
A team working across multiple services or repositories. Leverages infrastructure the team already has — specifically their existing version control and CI setup. No dedicated server required. Cross-service lineage and drift detection become available.

*What you get:* everything in Tier 1, plus cross-service lineage and drift detection across all services in scope.

**Tier 3 — Hosted**
An organisation that needs shared discussion threads across machines and participants, agent identity management, persistent history, webhooks, or a hosted UI. A managed hosting option lowers the barrier here significantly.

*What you get:* everything in Tier 2, plus shared persistent discussion, agent coordination at scale, organisation-wide visibility.

Tiers 1 and 2 are complete products. Tier 3 is an upgrade, not a prerequisite. The data model and tool interface must be identical across all tiers — no migration required when moving between them.

### Collaboration and discussion model

Discussion and feedback is typed, not flat. A single comment model loses the ability to route instructions to agents, surface blocking questions to humans, or distinguish reasoning context from active conversation. Four interaction types are required:

| Type | Initiated by | Behaviour |
|---|---|---|
| `discussion` | Human or agent | Threaded conversation; no blocking; resolved by participants |
| `instruction` | Human | Directive for an agent to act on; appears in agent action queue |
| `question` | Agent | Blocks further agent writes to that node until a human responds |
| `reasoning-trace` | Agent | Read-only context explaining an agent decision; no action required |

In Tier 1 and 2, discussion threads are local to the machine. In Tier 3, threads are shared across all participants. The thread data model is identical across tiers.

### Conflict and awareness model

Conflict awareness must work at Tier 1 and 2 without a central server. The tool must be able to identify:

- Two in-flight changes that have both modified the same node or field
- A proposed change that breaks a contract another in-flight change depends on
- Field-level drift between an API schema and a domain model across different proposed changes

How this is achieved is an engineering decision — but the product requirement is that it works without requiring a central server.

---

## Consequences

**What becomes easier:**
- Any developer can adopt the tool with no infrastructure decision
- Teams scale from solo to organisational use without changing their workflow
- The open source and commercial story is clean — Tier 3 is the natural commercial offering

**What becomes harder:**
- Tier boundaries must be designed carefully — features that bleed across tiers create confusion
- Discussion threads being local by default means sharing them requires either Tier 3 or a deliberate team convention

**What is newly possible:**
- The tool works in restricted or air-gapped environments at Tier 1 and 2
- Tier 3 can be introduced as a hosted product without forking the codebase

---

## Success Criteria

- A developer can go from install to a populated graph with drift detection results in under ten minutes with no infrastructure setup
- An agent writing a proposed change sees a conflict warning if another in-flight change has modified the same node, without requiring a central server
- A human reviewer can leave an `instruction`-type thread and the agent acts on it in the next session without re-explaining context
- Moving from Tier 1 to Tier 3 requires no data migration and no change to the team's workflow

---

## Follow-on Decisions Required

- **PDR-003:** Template packs and plugin architecture — established
- **PDR-004:** Agent and MCP interface — established
- **PDR-005:** Deletions, renames, and semantic collision detection — established
- **PDR-006:** Human review and editing experience — established
- **PDR-007:** Extraction workflow — how and when the derived layer is populated
- **ADR:** Storage mechanism for graph state at each tier
- **ADR:** Storage mechanism for discussion threads at each tier
- **ADR:** Conflict detection approach at Tier 1 and 2 without a central server
- **ADR:** Multi-service contract registry design for Tier 2
- **ADR:** Tier 3 hosted layer — scope, timing, and upgrade path

---

## Related

- PDR-001 — node taxonomy, semantic primitives, and progressive enrichment model
- Vision and brief chat — AI-extracted / human-reviewed workflow and branch-aware provenance as core value
