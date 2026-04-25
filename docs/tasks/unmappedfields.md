show all unmapped fields and unlinked nodes in the graph.

- unmapped fields: fields that have no maps-to edge connecting them to a field on another node
- unlinked nodes: nodes that have no edges at all (structural edges like has-field don't count)

surface these in the ui, mcp, and api. useful as a coverage prompt — highlights where lineage mapping or explicit relationships are still needed.

could be shown as a dashboard widget, a filter in the graph view, or a dedicated report.