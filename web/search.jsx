/* Search modal: fuzzy match utilities and SearchModal component. */

const { useState, useEffect, useRef } = React;
const { TemplateBadge, Icon } = window.CorumPrimitives;

function fuzzyMatch(query, id) {
  if (!query) return { score: 0 };
  const q = query.toLowerCase();
  const s = id.toLowerCase();
  let qi = 0, run = 0, maxRun = 0;
  for (let i = 0; i < s.length; i++) {
    if (qi >= q.length) break;
    if (s[i] === q[qi]) { qi++; run++; if (run > maxRun) maxRun = run; }
    else { run = 0; }
  }
  return qi === q.length ? { score: maxRun } : null;
}

function searchNodes(nodes, templates, query) {
  if (!query || !query.trim()) return [];
  const templateMap = new Map(templates.map(t => [t.name, t]));
  const results = [];
  for (const node of nodes) {
    if (node.parentId) continue;
    const match = fuzzyMatch(query.trim(), node.id);
    if (!match) continue;
    results.push({ node, template: templateMap.get(node.template), score: match.score });
  }
  results.sort((a, b) => b.score - a.score || a.node.id.length - b.node.id.length);
  return results.slice(0, 8);
}

function SearchModal({ nodes, templates, onNavigate, onClose }) {
  return null; // implemented in Task 2
}

window.CorumSearch = { SearchModal };
