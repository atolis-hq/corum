# Vision: Graph-Based Contract Intelligence Platform

> **Status:** Draft v0.1  
> **Last updated:** April 2026  
> **Author:** Derived from founding design sessions

---

## The Problem

Distributed software systems composed of APIs, events, and domain models are designed and delivered by multiple teams simultaneously. The design artifacts — domain models, API specs, event schemas, delivery plans — live in disconnected tools, follow inconsistent conventions, and lack explicit relationships between them.

As a result:

- The **lineage** between a business concept and its expression across APIs, events, and persistence is invisible
- Teams **design in isolation**, unaware of what other teams are proposing or building simultaneously
- The connection between **design intent and delivery units** is weak, making impact analysis manual and unreliable
- **Design review and rationale** are scattered across Confluence comments, Slack threads, and PR discussions — detached from the artifacts they concern and invisible to future readers
- Keeping humans coordinated around this context is **expensive and fragile**
- In an AI-augmented delivery model, **agents lack the shared structured context** needed to operate safely across service and team boundaries

This is not a tooling gap in any single layer. OpenAPI handles API schemas. AsyncAPI handles event schemas. Jira handles delivery. Confluence handles documentation. The gap is the **connective tissue between them** — the lineage, the cross-team awareness, and the unified queryable model that makes the whole coherent.

---

## The Core Insight

The contracts between services — APIs, events, and the fields within them — are the **fundamental unit of coordination** in a distributed system. Not the code. Not the documentation. The contracts.

Everything else is an implementation detail of one service. Contracts are what one team promises another. What one agent needs to know about another agent's domain. The shared language of the system.

A second insight: in an AI-augmented delivery world, the coordination problem does not reduce — it **accelerates**. Agents can produce conflicting designs in minutes rather than the days it takes humans. Without a shared structured model of system intent, cross-service agent work is unreliable and expensive to correct.

---

## What We're Building

A **contract intelligence layer** for distributed systems — a living, queryable graph of what the system is, what it's becoming, and how that maps to delivery — usable by both humans and AI agents.

### The three layers

**Schema layer**  
APIs and events as first-class typed nodes with field-level detail. Based on OpenAPI and AsyncAPI as canonical formats, extended with semantic metadata.

**Domain layer**  
The business concepts that APIs and events express — entities, aggregates, operations, policies, rules. The semantic context that makes contracts meaningful. Explicit field-level relationships across service boundaries.

**Delivery layer**  
Epics, stories, milestones linked to the graph nodes and edges they introduce or modify. Enabling impact analysis: what does changing this field affect, what stories depend on it, what is in flight that touches this domain.

### The cross-cutting capability

**Branch-aware in-flight visibility** — every node and edge carries provenance: which branch introduced it, which repo owns it, what delivery item it belongs to. The global graph is a composition of main state plus all in-flight branches, queryable simultaneously. An agent or human can ask "what is being proposed across all teams that touches this domain" and get a reliable answer.

**Design review as a graph workflow** — comments and discussions attach directly to nodes and edges, not to documents or PRs. A stakeholder can comment on a specific field's name, type, or nullability. That discussion is part of the field's history, survives branch operations, and is readable by agents as design rationale. This replaces the Confluence pattern of commenting on domain model tables — but the discussion travels with the artifact rather than living in a separate tool.

---

## Who It's For

**Primary:** AI agents operating across service boundaries in an agent-augmented delivery model. The graph is their shared working memory — the structured context they need to design safely without producing conflicts.

**Secondary:** Human engineers, architects, and delivery leads who need cross-team awareness, impact analysis, and design coordination without expensive synchronous collaboration.

**The adoption strategy:** Main state is derived automatically from code. Agents maintain branch state as part of their design workflow. Human discipline is not required for the graph to stay current.

---

## What It Is Not

- Not a replacement for Git — Git remains the versioning and history layer
- Not a documentation tool — documentation is a projection from the graph, not the source
- Not a diagramming tool — diagrams are generated views, not authored artifacts
- Not a project management tool — delivery metadata links to existing tools, not replaces them
- Not an API design tool — it consumes OpenAPI and AsyncAPI, it does not replace them

---

## The Value in an Agent-Augmented World

When agents are the primary designers and implementers across a distributed system, the graph becomes essential infrastructure rather than a useful aid:

- Agents query before designing — understanding what exists, what's proposed, what conflicts
- Agents register their proposals — making in-flight intent visible to other agents and humans
- Conflicts are detected before code is written — not after PRs are opened
- Acceptance criteria are derived from the graph — command → operation → state change → events published
- Human oversight is focused — reviewing agent designs against a structured model, not reading code

The organisations that have this infrastructure will be able to operate agents across service boundaries safely and at scale. Those that do not will find cross-service agent work expensive, unreliable, and difficult to govern.

---

## Success Looks Like

- An agent starting work on a new feature queries the graph and immediately understands the relevant domain concepts, existing contracts, and in-flight proposals from other teams
- A field change in one service surfaces its downstream impact across all dependent services automatically
- A new engineer understands how `OrderPlaced` flows through the system by querying the graph — not by reading code or asking people
- Two agents working on different services are warned before they produce incompatible designs
- A delivery lead can see exactly which stories introduce which field dependencies and what the critical path is
- A stakeholder comments on a field definition, the owning team is notified, the discussion is resolved, and the change is applied — all without leaving the tool or losing the rationale
- An agent asked "why is this field a string not a UUID" queries the comment history on that node and finds the discussion that settled it

---

## Open Questions (as of v0.1)

1. Canonical ID strategy — how stable node identity is maintained across branches, renames, and refactoring
2. Cross-repo relationship ownership — which repo or layer owns edges that span service boundaries
3. Write frequency policy — how often agent design changes become Git commits vs live only in the database
4. Code extraction reliability — how reliably main state can be derived from code across different languages and frameworks
5. Schema format — whether to extend AsyncAPI/OpenAPI or define a custom graph schema format
