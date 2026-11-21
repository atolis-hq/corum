# Host fonts verification — 2026-11-21

Compared Chromium screenshots at 1280 × 800 with `fixtures/sample-graph`
and `test/fixtures/plugins`. The baseline uses the original index HTML with
Google Fonts and Font Awesome 6.7.2 CDN stylesheets; the comparison uses the
local stylesheets. Both use the same running host and graph. Screenshots wait
for the page, plugin navigation and `document.fonts.ready` before capture.

| Screen | CDN baseline | Host assets |
| --- | --- | --- |
| Dashboard | [before](before-dashboard.png) | [after](after-dashboard.png) |
| Node `orders.DomainModel.order` | [before](before-node.png) | [after](after-node.png) |
| Graph | [before](before-graph.png) | [after](after-graph.png) |

Visual inspection found matching font faces, weights, icon glyphs, and layout
on all three screens. The browser regression test additionally blocks external
requests, loads every requested text weight, checks successful font responses,
and checks `fa-solid fa-otter` as a plugin compatibility probe.

`npm pack --json` on built baseline and changed trees measured:

| Bytes | Baseline | Changed | Increase |
| --- | ---: | ---: | ---: |
| Compressed tarball | 175131 | 640739 | 465608 |
| Unpacked package | 734637 | 1267101 | 532464 |

The package includes the three license notices and asset provenance README.
Comparison screenshots live under `project/` and are excluded from the npm
package by its existing `files` list. Full Unicode subsets are preserved;
only the requested text weights and the free-solid icon style are exposed.

Verification: `npm run build`, `npm test`, `npm run mcp:write-smoke`,
`node dist/src/bin/corum.js lint`, `CORUM_E2E_PORT=3015 npm run test:web`,
and `git diff --check`. No standalone formatter or source-lint script is
configured in this repository. MCP write smoke covers filesystem and local Git;
its optional remote Git case is skipped without `CORUM_GIT_REMOTE_URL`, as in CI.
