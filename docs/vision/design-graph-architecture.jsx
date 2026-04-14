import { useState } from "react";

const data = {
  understanding: {
    layers: [
      {
        name: "Schema Layer",
        icon: "⬡",
        description: "API & event schemas with field-level detail",
        examples: ["REST/GraphQL endpoints", "Kafka/SNS topic schemas", "Field types, constraints, versions"]
      },
      {
        name: "Domain Model Layer",
        icon: "◈",
        description: "Bounded contexts, entities, aggregates",
        examples: ["Field-level relationships (Order.customerId → Customer.id)", "Domain operations", "Trigger → Operation → Publication chains"]
      },
      {
        name: "Delivery Layer",
        icon: "◇",
        description: "Epics, stories, milestones linked to graph mutations",
        examples: ["Which stoADR-006-rules.mdry introduces a field", "Impact analysis across layers", "Dependency tracking forward & backward"]
      }
    ],
    crossCutting: [
      "API/event → domain operation triggers",
      "Domain operation → event publication",
      "Dual audience: humans + coding agents",
      "Impact analysis across all three layers"
    ]
  },
  approaches: [
    {
      id: "postgres-graph",
      name: "Current: Postgres as Graph DB",
      subtitle: "Nodes & edges in relational tables",
      color: "#4A90D9",
      accent: "#2563EB",
      bg: "#EFF6FF",
      pros: [
        "Flexible queries across all dimensions simultaneously",
        "ACID transactions — safe concurrent writes from agents",
        "Schema enforcement catches malformed specs",
        "Single source of truth — no sync issues",
        "Rich query: 'all fields introduced by epic X that touch domain Y'",
        "Mature tooling, backups, replication"
      ],
      cons: [
        "No native graph traversal (recursive CTEs get complex)",
        "Not human-readable — agents must go via API",
        "Version history requires explicit audit tables",
        "No built-in diffing or branching",
        "Harder to review spec changes in PRs"
      ],
      bestFor: "Systems where programmatic querying dominates and agent writes are frequent",
      agentExperience: "Good — structured API enforces contract, prevents malformed writes",
      humanExperience: "Poor raw, needs bespoke UI",
      scalability: "Excellent",
      rating: { overall: 3.5, agentUX: 4, humanUX: 2.5, impactAnalysis: 4, versionControl: 2 }
    },
    {
      id: "git-files",
      name: "Option A: Git + Structured Files",
      subtitle: "YAML/JSON files in a repo, server on top",
      color: "#059669",
      accent: "#047857",
      bg: "#ECFDF5",
      pros: [
        "Git IS your version history — branches, PRs, diffs for free",
        "Humans and agents both read/write naturally",
        "Obsidian or any editor for human authoring",
        "Spec changes are reviewable in PRs like code",
        "Works offline, no DB infra",
        "Markdown + frontmatter = readable specs"
      ],
      cons: [
        "Cross-file graph queries are expensive (parse all files)",
        "Impact analysis requires building an in-memory index",
        "No referential integrity — dangling references silently break",
        "Concurrent agent writes risk merge conflicts",
        "Schema validation is opt-in, not enforced",
        "Server must re-index on every change"
      ],
      bestFor: "Teams that want spec-as-code, PR-driven review, and Obsidian-style authoring",
      agentExperience: "Good — agents can read/write files naturally, but risk conflicts",
      humanExperience: "Excellent — especially with Obsidian graph view",
      scalability: "Moderate — index rebuild cost grows with repo size",
      rating: { overall: 3.5, agentUX: 3, humanUX: 5, impactAnalysis: 3, versionControl: 5 }
    },
    {
      id: "hybrid",
      name: "Option B: Git Source of Truth + Postgres Index",
      subtitle: "Files are canonical, DB is a queryable projection",
      color: "#7C3AED",
      accent: "#6D28D9",
      bg: "#F5F3FF",
      pros: [
        "Best of both: human-readable files + fast graph queries",
        "Git for versioning, history, PR review",
        "DB index rebuilt from files — always recoverable",
        "Impact analysis queries run against DB, not file scans",
        "Agents write files (or API writes files), DB syncs async",
        "Obsidian reads the files; UI queries the DB"
      ],
      cons: [
        "Two systems to maintain and keep in sync",
        "Sync pipeline is a failure mode (stale index)",
        "More infra complexity",
        "Agents must decide: write file directly or go via API?"
      ],
      bestFor: "Production-grade tools where both human and agent experience matter equally",
      agentExperience: "Excellent — structured API + file fallback",
      humanExperience: "Excellent — files + Obsidian + rich UI",
      scalability: "Excellent",
      rating: { overall: 4.5, agentUX: 4.5, humanUX: 4.5, impactAnalysis: 5, versionControl: 5 }
    },
    {
      id: "purpose-built-graph",
      name: "Option C: Native Graph DB",
      subtitle: "Neo4j or similar, purpose-built for graph traversal",
      color: "#DC2626",
      accent: "#B91C1C",
      bg: "#FEF2F2",
      pros: [
        "Cypher queries make impact analysis trivial",
        "MATCH (f:Field)<-[:INTRODUCED_BY]-(s:Story) is one line",
        "Native graph visualisation tools available",
        "Traversal performance far exceeds recursive SQL",
        "Schema-optional — easy to evolve your meta-model"
      ],
      cons: [
        "No built-in version control or branching",
        "Less familiar ops/tooling than Postgres",
        "Not human-readable at rest",
        "Neo4j licensing can be expensive at scale",
        "Harder to run locally for dev"
      ],
      bestFor: "If impact analysis and graph traversal are the dominant access patterns",
      agentExperience: "Good — Cypher is expressive but less familiar to LLMs than SQL",
      humanExperience: "Poor raw, needs UI layer",
      scalability: "Excellent for graph queries",
      rating: { overall: 3, agentUX: 3, humanUX: 2, impactAnalysis: 5, versionControl: 1 }
    }
  ],
  existingTools: [
    {
      name: "Backstage",
      vendor: "Spotify / CNCF",
      fit: "Partial",
      fitScore: 2,
      description: "Developer portal with a software catalog. Models services, APIs, teams, and ownership. Has a graph of dependencies but no field-level schema detail, no event publication chains, no delivery linkage.",
      couldAdapt: "Yes — plugin system is extensible. Could add schema nodes and delivery links as custom entity types. Significant build effort.",
      url: "backstage.io"
    },
    {
      name: "EventCatalog",
      vendor: "Open source",
      fit: "Partial",
      fitScore: 3,
      description: "Documents event-driven architectures — topics, schemas, producers, consumers. Markdown + git-native. Lacks domain model layer, field-level relationships, delivery linkage.",
      couldAdapt: "Strong candidate. Already does schema ↔ service mapping. Could extend with domain model and delivery layers.",
      url: "eventcatalog.dev"
    },
    {
      name: "Stoplight / Apicurio",
      vendor: "Commercial / Red Hat",
      fit: "Partial",
      fitScore: 2,
      description: "API design and governance tools. Excellent schema editing, OpenAPI-native. No event model, no domain model layer, no delivery linkage.",
      couldAdapt: "For the API schema layer only. Not a foundation for the full graph.",
      url: "stoplight.io"
    },
    {
      name: "Archi / C4 tools",
      vendor: "Various",
      fit: "Low",
      fitScore: 1,
      description: "Architecture modelling (ArchiMate/C4). Good for high-level system diagrams but no field-level schema detail, no event schemas, no delivery integration.",
      couldAdapt: "No — wrong abstraction level.",
      url: "archimatetool.com"
    },
    {
      name: "Notion / Linear graph",
      vendor: "Notion, Linear",
      fit: "Low",
      fitScore: 1,
      description: "Could model entities as database records and link them. No graph traversal, no schema awareness, not agent-friendly.",
      couldAdapt: "No — would be fighting the tool constantly.",
      url: ""
    },
    {
      name: "Obsidian + Dataview",
      vendor: "Obsidian",
      fit: "Moderate",
      fitScore: 3,
      description: "Obsidian's graph view + Dataview plugin can build a queryable knowledge graph from markdown files. Could represent your schema and domain nodes as linked notes with YAML frontmatter. No built-in schema enforcement or server API.",
      couldAdapt: "Good for the human authoring layer in Option B. Pair with a server that indexes the vault.",
      url: "obsidian.md"
    },
    {
      name: "Buf / Protobuf Schema Registry",
      vendor: "Buf Technologies",
      fit: "Low-Partial",
      fitScore: 2,
      description: "Schema registry and breaking change detection for Protobuf/gRPC. Excellent schema versioning and compatibility. No domain model, no delivery linkage.",
      couldAdapt: "Useful as a schema source-of-truth to import from, not as the core graph.",
      url: "buf.build"
    },
    {
      name: "Confluent Schema Registry",
      vendor: "Confluent",
      fit: "Low-Partial",
      fitScore: 2,
      description: "Manages Avro/JSON Schema/Protobuf schemas for Kafka. Excellent for event schema versioning. No domain layer, no delivery layer, no API schema.",
      couldAdapt: "Same as Buf — import source, not the graph core.",
      url: "confluent.io"
    }
  ],
  recommendation: {
    choice: "Option B: Git + Postgres Hybrid",
    rationale: [
      "Files are the canonical source — humans, agents, and Obsidian all read/write them",
      "Git gives you branching, PR review, and full history for free",
      "Postgres index makes impact analysis fast and expressive without recursive file scanning",
      "EventCatalog could replace or seed your event schema layer, reducing build scope",
      "Your existing Postgres graph becomes the index layer, not the source of truth — lower stakes if it gets corrupted"
    ],
    agentStrategy: "Agents write spec files (YAML/Markdown) via a thin API wrapper that validates, commits, and triggers re-index. Agents query via structured API backed by Postgres — never raw file scans."
  }
};

const RatingBar = ({ value, max = 5, color }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div style={{
      flex: 1, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden"
    }}>
      <div style={{
        width: `${(value / max) * 100}%`,
        height: "100%",
        background: color,
        borderRadius: 3,
        transition: "width 0.6s ease"
      }} />
    </div>
    <span style={{ fontSize: 11, color: "#6b7280", minWidth: 24, textAlign: "right" }}>
      {value}/{max}
    </span>
  </div>
);

const FitBadge = ({ fit }) => {
  const colors = {
    "High": { bg: "#dcfce7", text: "#15803d" },
    "Moderate": { bg: "#fef9c3", text: "#854d0e" },
    "Partial": { bg: "#dbeafe", text: "#1d4ed8" },
    "Low": { bg: "#fee2e2", text: "#b91c1c" },
    "Low-Partial": { bg: "#fce7f3", text: "#9d174d" }
  };
  const c = colors[fit] || colors["Low"];
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
      background: c.bg, color: c.text, letterSpacing: "0.04em"
    }}>{fit}</span>
  );
};

export default function DesignGraphAnalysis() {
  const [tab, setTab] = useState("understand");
  const [selectedApproach, setSelectedApproach] = useState(null);

  const tabs = [
    { id: "understand", label: "What You're Building" },
    { id: "approaches", label: "4 Approaches" },
    { id: "compare", label: "Comparison" },
    { id: "existing", label: "Existing Tools" },
    { id: "recommendation", label: "Recommendation" }
  ];

  const ratingKeys = [
    { key: "overall", label: "Overall" },
    { key: "agentUX", label: "Agent UX" },
    { key: "humanUX", label: "Human UX" },
    { key: "impactAnalysis", label: "Impact Analysis" },
    { key: "versionControl", label: "Version Control" }
  ];

  return (
    <div style={{
      fontFamily: "'Georgia', 'Times New Roman', serif",
      background: "#0f1117",
      minHeight: "100vh",
      color: "#e2e8f0",
      padding: 0
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #0f1117 0%, #1a1f2e 50%, #0f1117 100%)",
        borderBottom: "1px solid #2d3748",
        padding: "32px 40px 0"
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{
            fontSize: 11, letterSpacing: "0.2em", color: "#64748b",
            textTransform: "uppercase", marginBottom: 8, fontFamily: "monospace"
          }}>
            Architecture Analysis
          </div>
          <h1 style={{
            fontSize: 32, fontWeight: 400, margin: "0 0 4px",
            color: "#f1f5f9", letterSpacing: "-0.02em"
          }}>
            Design Graph Tool
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 28px" }}>
            Schema · Domain · Delivery — build approach evaluation
          </p>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #2d3748" }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "10px 20px", fontSize: 13,
                color: tab === t.id ? "#f1f5f9" : "#64748b",
                borderBottom: tab === t.id ? "2px solid #818cf8" : "2px solid transparent",
                marginBottom: -1, transition: "all 0.15s",
                fontFamily: "inherit"
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 40px" }}>

        {/* UNDERSTAND TAB */}
        {tab === "understand" && (
          <div>
            <p style={{ fontSize: 15, color: "#94a3b8", lineHeight: 1.7, marginBottom: 32, maxWidth: 680 }}>
              A collaborative specification tool that models a software system as a <em>graph</em> across three interlocking layers, readable and writable by both humans and coding agents.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 32 }}>
              {data.understanding.layers.map(layer => (
                <div key={layer.name} style={{
                  background: "#1a1f2e", border: "1px solid #2d3748",
                  borderRadius: 12, padding: 24
                }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>{layer.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", marginBottom: 6 }}>
                    {layer.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16, lineHeight: 1.6 }}>
                    {layer.description}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {layer.examples.map(ex => (
                      <div key={ex} style={{
                        fontSize: 11, color: "#818cf8",
                        fontFamily: "monospace", lineHeight: 1.5
                      }}>
                        → {ex}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              background: "#1a1f2e", border: "1px solid #2d3748",
              borderRadius: 12, padding: 24
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", marginBottom: 16 }}>
                Cross-cutting concerns
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {data.understanding.crossCutting.map(c => (
                  <div key={c} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 14px", background: "#0f1117",
                    borderRadius: 8, border: "1px solid #2d3748"
                  }}>
                    <div style={{ color: "#818cf8", fontSize: 14, marginTop: 1 }}>◆</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{c}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{
              marginTop: 24, padding: "16px 20px",
              background: "rgba(129, 140, 248, 0.08)",
              border: "1px solid rgba(129, 140, 248, 0.2)",
              borderRadius: 10, fontSize: 13, color: "#94a3b8", lineHeight: 1.7
            }}>
              <strong style={{ color: "#818cf8" }}>Key insight:</strong> This is fundamentally a <em>multi-dimensional graph</em> where nodes are schemas, fields, domain entities, operations, events, and delivery items — and edges encode trigger, publication, introduces, depends-on, and maps-to relationships. The dual-audience requirement (humans + agents) is the hardest design constraint.
            </div>
          </div>
        )}

        {/* APPROACHES TAB */}
        {tab === "approaches" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {data.approaches.map(a => (
              <div key={a.id} style={{
                background: "#1a1f2e", border: `1px solid ${selectedApproach === a.id ? a.color : "#2d3748"}`,
                borderRadius: 12, overflow: "hidden",
                cursor: "pointer", transition: "border-color 0.2s"
              }} onClick={() => setSelectedApproach(selectedApproach === a.id ? null : a.id)}>
                <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: a.color, flexShrink: 0
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9" }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{a.subtitle}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {selectedApproach === a.id ? "▲ collapse" : "▼ expand"}
                  </div>
                </div>

                {selectedApproach === a.id && (
                  <div style={{ padding: "0 24px 24px", borderTop: "1px solid #2d3748" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#4ade80", letterSpacing: "0.1em", marginBottom: 10, textTransform: "uppercase" }}>
                          Strengths
                        </div>
                        {a.pros.map(p => (
                          <div key={p} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <span style={{ color: "#4ade80", fontSize: 12, flexShrink: 0, marginTop: 1 }}>+</span>
                            <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{p}</span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#f87171", letterSpacing: "0.1em", marginBottom: 10, textTransform: "uppercase" }}>
                          Weaknesses
                        </div>
                        {a.cons.map(c => (
                          <div key={c} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <span style={{ color: "#f87171", fontSize: 12, flexShrink: 0, marginTop: 1 }}>−</span>
                            <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 20 }}>
                      {[
                        { label: "Best For", value: a.bestFor },
                        { label: "Agent Experience", value: a.agentExperience },
                        { label: "Human Experience", value: a.humanExperience }
                      ].map(item => (
                        <div key={item.label} style={{
                          padding: "12px 14px", background: "#0f1117",
                          borderRadius: 8, border: "1px solid #2d3748"
                        }}>
                          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                            {item.label}
                          </div>
                          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                        Ratings
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {ratingKeys.map(rk => (
                          <div key={rk.key} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "#64748b" }}>{rk.label}</span>
                            <RatingBar value={a.rating[rk.key]} color={a.color} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* COMPARE TAB */}
        {tab === "compare" && (
          <div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "12px 16px", textAlign: "left", color: "#64748b", fontWeight: 500, borderBottom: "1px solid #2d3748", width: 160 }}>Dimension</th>
                    {data.approaches.map(a => (
                      <th key={a.id} style={{ padding: "12px 16px", textAlign: "left", color: a.color, fontWeight: 600, borderBottom: "1px solid #2d3748" }}>
                        <div style={{ fontSize: 11 }}>{a.name.replace(/^(Current: |Option [A-C]: )/, "")}</div>
                        <div style={{ fontSize: 10, color: "#64748b", fontWeight: 400, marginTop: 2 }}>{a.subtitle}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ratingKeys.map((rk, i) => (
                    <tr key={rk.key} style={{ background: i % 2 === 0 ? "#0f1117" : "transparent" }}>
                      <td style={{ padding: "12px 16px", color: "#64748b", fontWeight: 500 }}>{rk.label}</td>
                      {data.approaches.map(a => (
                        <td key={a.id} style={{ padding: "12px 16px" }}>
                          <RatingBar value={a.rating[rk.key]} color={a.color} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {[
                    { label: "Agent writes", values: ["API only", "Files or API", "Files via API → DB sync", "API only"] },
                    { label: "Human authoring", values: ["Bespoke UI required", "Obsidian / any editor", "Obsidian + UI", "Bespoke UI required"] },
                    { label: "Branching", values: ["Manual", "Git native", "Git native", "Manual"] },
                    { label: "PR reviews", values: ["No", "Yes", "Yes", "No"] },
                    { label: "Impact analysis", values: ["Recursive CTEs", "In-memory index", "DB queries", "Cypher traversal"] },
                    { label: "Infra complexity", values: ["Low", "Low", "Medium", "Medium"] },
                    { label: "Recovery if corrupted", values: ["Backup restore", "Git history", "Rebuild from Git", "Backup restore"] }
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: (ratingKeys.length + i) % 2 === 0 ? "#0f1117" : "transparent" }}>
                      <td style={{ padding: "12px 16px", color: "#64748b", fontWeight: 500 }}>{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} style={{ padding: "12px 16px", fontSize: 12, color: "#94a3b8" }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{
              marginTop: 24, padding: "16px 20px",
              background: "rgba(129, 140, 248, 0.08)",
              border: "1px solid rgba(129, 140, 248, 0.2)",
              borderRadius: 10, fontSize: 13, color: "#94a3b8", lineHeight: 1.7
            }}>
              <strong style={{ color: "#818cf8" }}>Key observation:</strong> Your current Postgres approach has the best raw query power but the worst version control story. The hybrid (Option B) gives you Postgres query power <em>and</em> Git versioning, at the cost of a sync layer. Given that agents are first-class citizens and you need PR-reviewable spec changes, the hybrid is the natural evolution of your current approach.
            </div>
          </div>
        )}

        {/* EXISTING TOOLS TAB */}
        {tab === "existing" && (
          <div>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 24, lineHeight: 1.7 }}>
              No existing tool covers all three layers (schema, domain, delivery) with field-level detail and agent-friendliness. Several cover parts well and could inform or seed specific layers.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {data.existingTools.map(tool => (
                <div key={tool.name} style={{
                  background: "#1a1f2e", border: "1px solid #2d3748",
                  borderRadius: 10, padding: "18px 22px",
                  display: "grid", gridTemplateColumns: "200px 1fr", gap: 20
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
                      {tool.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>{tool.vendor}</div>
                    <FitBadge fit={tool.fit} />
                    <div style={{ marginTop: 12 }}>
                      {[1, 2, 3, 4, 5].map(star => (
                        <span key={star} style={{
                          fontSize: 12,
                          color: star <= tool.fitScore ? "#fbbf24" : "#374151"
                        }}>★</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, marginBottom: 10 }}>
                      {tool.description}
                    </div>
                    <div style={{ fontSize: 11, color: "#818cf8", lineHeight: 1.6 }}>
                      <strong style={{ color: "#64748b" }}>Adapt?</strong> {tool.couldAdapt}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RECOMMENDATION TAB */}
        {tab === "recommendation" && (
          <div>
            <div style={{
              background: "linear-gradient(135deg, rgba(124, 58, 237, 0.15) 0%, rgba(129, 140, 248, 0.08) 100%)",
              border: "1px solid rgba(124, 58, 237, 0.3)",
              borderRadius: 14, padding: 28, marginBottom: 28
            }}>
              <div style={{ fontSize: 11, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>
                Recommended approach
              </div>
              <div style={{ fontSize: 22, fontWeight: 400, color: "#f1f5f9", marginBottom: 6 }}>
                {data.recommendation.choice}
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>
                Git as canonical source of truth, Postgres as a queryable projection — the natural evolution of your current architecture.
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
                Why this approach
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.recommendation.rationale.map((r, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 14, padding: "12px 16px",
                    background: "#1a1f2e", borderRadius: 8, border: "1px solid #2d3748"
                  }}>
                    <div style={{ color: "#7C3AED", fontSize: 14, flexShrink: 0, marginTop: 1 }}>◆</div>
                    <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>{r}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{
              padding: "18px 22px", background: "#1a1f2e",
              border: "1px solid #2d3748", borderRadius: 10, marginBottom: 24
            }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
                Agent interaction strategy
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>
                {data.recommendation.agentStrategy}
              </div>
            </div>

            <div style={{
              padding: "18px 22px", background: "#1a1f2e",
              border: "1px solid #2d3748", borderRadius: 10, marginBottom: 24
            }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
                Suggested file structure
              </div>
              <pre style={{
                fontFamily: "monospace", fontSize: 12, color: "#818cf8",
                background: "#0f1117", padding: 16, borderRadius: 8,
                overflow: "auto", lineHeight: 1.8, margin: 0
              }}>{`/specs
  /schemas
    /events
      order-placed.yaml       # schema + field defs + producers/consumers
    /apis
      orders-api.yaml         # OpenAPI fragment + domain operation triggers
  /domains
    /order
      order.yaml              # entity fields + relationships
      order-service.yaml      # operations + event publications
  /delivery
    /epic-checkout-v2
      epic.yaml               # links to introduced nodes/edges
      story-123.yaml
/index
  graph.db                    # Postgres or SQLite — rebuilt from /specs
  SCHEMA.md                   # meta-model documentation for agents`}
              </pre>
            </div>

            <div style={{
              padding: "16px 20px",
              background: "rgba(74, 222, 128, 0.06)",
              border: "1px solid rgba(74, 222, 128, 0.2)",
              borderRadius: 10, fontSize: 13, color: "#94a3b8", lineHeight: 1.7
            }}>
              <strong style={{ color: "#4ade80" }}>Watch:</strong> EventCatalog is worth a close look before building the event schema layer from scratch. It already handles event ↔ service mapping in a git-native way and has a growing plugin ecosystem. You might adopt its file conventions and extend them with domain and delivery nodes, rather than inventing your own schema from scratch.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
