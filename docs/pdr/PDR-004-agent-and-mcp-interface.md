# PDR-004: Agent and MCP Interface

**Status:** Accepted  
**Date:** 2026-04-12  
**Decider:** Product Owner

---

## Problem Statement

The tool's primary workflow is AI-extracted, human-reviewed. Agents are the primary authors of graph content — extracting from codebases, enriching nodes, mapping lineage, and supporting humans during design and delivery. The tool needs to define:

1. What can agents do, and is there anything they cannot do?
2. What graph information do agents need access to, and in what form?
3. How do agents communicate uncertainty or requests to humans?
4. How does the agent interface relate to the two-layer model (design vs. derived)?

---

## Context

PDR-001 established that the graph has two layers: a **design layer** (intent, agent and human authored) and a **derived layer** (reality, extracted from merged code, read-only). Node states (`draft`, `proposed`, `agreed`, `future`, `implemented`) signal where a node sits in the design process. State is a signal — the tool does not enforce behaviour based on it.

PDR-002 established four thread types for human-agent communication: `discussion`, `instruction`, `question`, and `reasoning-trace`. Threads are a first-class graph primitive, not a side channel.

PDR-003 established that templates contain an `agent` metadata section describing the node type's purpose for agent context, and which properties are agent-writable.

The tool exposes its graph to agents via an MCP server. MCP is the transport; this PDR defines what the interface exposes and what agents can do with it, not how MCP itself is implemented.

The tool is intended to become a **specialised centralised brain** — a shared working memory for agents and humans coordinating across services and features. For this to work, agents must be able to read rich context and write freely within the design layer. The safety model is not an approval gate on the graph — it is that the derived layer is always rebuilt from merged code, and proposals only become real when implemented.

Agent autonomy, decision-making, ambiguity handling, and operational behaviour are outside the scope of this decision. The interface should make rich interaction possible; how agents use it is their concern.

---

## Options Considered

### Option A: Read-only agent interface
Agents can query the graph but cannot write to it. Humans author all graph changes via a UI or CLI. Agents use graph context to inform their work in the codebase.

- **Pros:** Simple; no risk of agent writes corrupting graph state; easy to reason about
- **Cons:** Eliminates the primary value proposition — agents as the main authors of graph content; extraction becomes a manual human task; the tool cannot scale without agent writes
- **Effort:** Low
- **Fit:** Poor — fundamentally contradicts the AI-extracted, human-reviewed workflow

---

### Option B: Constrained write interface with approval gates
Agents can propose changes that queue for human approval before becoming visible in the graph. No agent write takes effect without explicit human sign-off.

- **Pros:** Maximum human control; clear audit trail of what agents proposed vs. what humans approved
- **Cons:** Creates a parallel approval system on top of the code review process teams already have; slows the agent workflow significantly; human review becomes a bottleneck rather than a quality gate; contradicts the decision that proposals become real when implemented, not when approved in the graph
- **Effort:** Medium
- **Fit:** Poor — over-engineers the safety model

---

### Option C: Full read/write access to the design layer *(accepted)*
Agents have full read access to both layers and full write access to the design layer. The derived layer is read-only for everyone — agents and humans alike. The safety model is the two-layer architecture: agent writes only ever affect design layer state, and reality is always re-derived from merged code.

- **Pros:** Agents can work autonomously and at scale; no approval bottleneck; safety is architectural rather than procedural; consistent with how engineering teams already work (code review is the gate, not a graph approval step); enables the tool to function as a genuine shared brain
- **Cons:** Requires teams to trust that the derived layer accurately represents reality — extraction quality is load-bearing; design layer can contain incorrect or stale content, which must be surfaced via drift detection rather than prevented
- **Effort:** Medium — the interface must be well-designed to give agents the context they need to make good decisions
- **Fit:** Strong

---

## Decision

**Chosen option: Option C — full read/write access to the design layer**

### Layer access model

| Layer | Agent access | Human access |
|---|---|---|
| Design layer | Read and write | Read and write |
| Derived layer | Read only | Read only |

No approval gate exists between agent writes and graph visibility. Agent-created or modified nodes are immediately visible in the design layer at `proposed` state by default. The derived layer is rebuilt from code by the extraction process — neither agents nor humans write to it directly.

### Agent capability groups

**Read and query**

Agents can read any node or edge in either layer. Beyond individual node reads, the interface exposes higher-order queries agents need for reasoning:

- **Lineage queries** — given a node, return its full upstream and downstream lineage subgraph to a specified depth
- **Drift queries** — return all nodes where the design layer and derived layer diverge, optionally filtered by node type or state
- **Impact queries** — given a proposed change to a node or field, return all nodes and edges that would be affected
- **State queries** — return all nodes in a given state, optionally filtered by node type or branch context
- **Thread queries** — return all open threads targeting a node or its connected subgraph, filtered by thread type

**Write**

Agents can create, update, and delete nodes and edges in the design layer. This includes:

- Creating new nodes at `proposed` state (default) or `draft` state
- Updating node properties and state transitions
- Creating and updating edges including field-level lineage mappings
- Deleting design layer nodes and edges — the derived layer is unaffected

**Threads**

Agents can create and update threads on any node or edge:

- Create `question` threads to surface uncertainty to humans
- Create `reasoning-trace` threads to record decision context for future agent sessions
- Create `discussion` threads to participate in ongoing design conversations
- Update thread status to `actioned` when responding to `instruction` threads
- Read all open threads on any node, including `instruction` threads directed at the agent

### Context payload

When an agent reads a node, the interface returns a context payload containing:

- Node properties and current state
- Template definition for the node type, including the `agent` metadata section
- Direct edges and their types
- Open threads targeting the node, prioritised by type (`instruction` first, then `question`, then `discussion`)
- Design layer state and derived layer state where both exist, with drift flagged explicitly

The richness of context is intentional. Agents making design decisions need to understand not just a node's properties but its relationships, its design intent, and what questions or instructions are outstanding. Thin context produces lower quality agent reasoning.

### Agent identity

Writes and threads are attributed to the user identity running the tool — the developer who initiated the session. Agents act on behalf of that user and inherit their identity, consistent with how git attributes commits made by scripts or tools to the human who ran them.

An optional `agent-label` field can be attached to threads and writes to indicate which agent or tool produced them. This aids legibility when multiple agents run in the same session without introducing a separate identity model. For CI-based agents, the CI service account or bot user provides the identity — no special handling is required.

### The role of node state in the agent interface

Node state is exposed as a readable and writable property. Agents can set state when creating or updating nodes. The tool does not enforce agent behaviour based on state — an agent can write to an `agreed` node if it has reason to. State is a communication mechanism between agents and humans, not an access control mechanism.

The `implemented` state is the exception — it is set only by the extraction process and cannot be written by agents or humans directly.

---

## Consequences

**What becomes easier:**
- Agents can work at the speed and scale that makes the tool genuinely useful as a shared brain
- The safety model is architectural and does not require procedural overhead
- Agents have enough context to make well-reasoned design decisions without repeated back-and-forth
- Thread history gives future agent sessions the context they need without human re-explanation

**What becomes harder:**
- Extraction quality is load-bearing — if the derived layer does not accurately reflect the codebase, drift detection produces misleading signals
- The design layer can accumulate stale or incorrect content — drift detection and thread resolution are the mechanism for keeping it honest
- Reasoning traces and thread authorship are attributed to the running user — teams should use meaningful agent labels when multiple agents operate in the same session to keep context legible

**What is newly possible:**
- Agents can perform full impact analysis before proposing changes, reducing unintended consequences
- Reasoning traces create a persistent institutional memory that survives agent session boundaries
- The tool can surface the full picture of design intent, implementation reality, and outstanding questions in a single context payload

---

## Success Criteria

- An agent can read a node and receive its full context payload — properties, template metadata, lineage, open threads, and drift status — in a single interface call
- An agent can create a node, map its field-level lineage, and leave a reasoning trace in a single session without human intervention
- An agent responding to an `instruction` thread can mark it as `actioned` and the thread status updates immediately in the human-facing interface
- A lineage query for a node with ten hops of connected nodes completes in under two seconds
- An impact query correctly identifies all nodes affected by a field rename in a representative graph

---

## Follow-on Decisions Required

- **PDR-005:** Human review and editing experience — how node states, drift signals, and threads are surfaced to humans
- **ADR:** MCP server implementation — process model, transport, and session management
- **ADR:** Query interface design — the specific operations, parameters, and response shapes exposed via MCP
- **ADR:** Extraction process — how the derived layer is built, when it runs, and how conflicts between design and derived layers are detected

---

## Related

- PDR-001 — establishes the design/derived layer model, node states, semantic primitives, and semantic roles
- PDR-002 — establishes thread types and the tiered deployment model the MCP server operates within
- PDR-003 — establishes the template `agent` metadata section that forms part of the context payload
