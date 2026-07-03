> **Design done:** see [../superpowers/specs/2026-07-03-node-identity-and-mcp-write-tools-design.md](../superpowers/specs/2026-07-03-node-identity-and-mcp-write-tools-design.md) — covers rename semantics, trails, the default-branch threshold, cross-branch alias resolution, and soft/hard deletes. Implementation notes for the hard parts in §14.

we need to be able to rename nodes without losing the linkage.

Ideally we can track this in main branch and other branches which have the old name will be matched. 

On branches as well if a field is renamed it should match to main / other branches. a rename should show visually.