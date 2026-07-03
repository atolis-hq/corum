> **Design done:** see [../superpowers/specs/2026-07-03-node-identity-and-mcp-write-tools-design.md](../superpowers/specs/2026-07-03-node-identity-and-mcp-write-tools-design.md) — session-based mutation engine (`src/mutate/`), full tool surface incl. `apply_cluster`, autosave per source type, and rename/delete semantics shared with the identity design. Implementation notes in §14.

currently the mcp is read only. we need to add tools for writing
 - create components
 - create nodes / valid against templates
 - create fields
 - edit nodes and fields
 - remove nodes, and fields, clear orphan edges
 - add edges
 - remove edges
 - edit edges.

 the changes should be possible to do in memory and or persist (to file or git when thats enabled)

 Also review the tool surface to ensure its in a useful format.