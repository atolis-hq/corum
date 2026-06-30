// Verify fuzzy match algorithm — run with: node web/search-utils.test.js

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

let passed = 0, failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}`); failed++; }
}

// fuzzyMatch
assert(fuzzyMatch('ord', 'orders.DomainModel.order') !== null, 'matches subsequence');
assert(fuzzyMatch('xyz', 'orders.DomainModel.order') === null, 'rejects non-match');
assert(fuzzyMatch('ORD', 'orders.DomainModel.order') !== null, 'case insensitive');
assert(fuzzyMatch('', 'orders.DomainModel.order') !== null, 'empty query matches');
assert(fuzzyMatch('order', 'orders.DomainModel.order')?.score >= 5, 'consecutive run scores high');
assert(fuzzyMatch('o.o', 'orders.DomainModel.order')?.score === 1, 'non-consecutive scores low');

// searchNodes
const nodes = [
  { id: 'orders.DomainModel.order', template: 'DomainModel', component: 'orders' },
  { id: 'orders.RestAPI.OrdersApi', template: 'RestAPI', component: 'orders' },
  { id: 'payments.DomainModel.payment', template: 'DomainModel', component: 'payments' },
  { id: 'orders.DomainModel.order.schemas.OrderSchema', template: 'Schema', component: 'orders', parentId: 'orders.DomainModel.order' },
];
const templates = [{ name: 'DomainModel', ui: { colour: '#f00', displayName: 'Domain Model' } }];

const results = searchNodes(nodes, templates, 'order');
assert(results.length === 2, 'returns matched root nodes only');
assert(!results.some(r => r.node.parentId), 'excludes child nodes with parentId');
assert(results[0].node.id === 'orders.DomainModel.order', 'shorter-ID tie-break works');
assert(searchNodes(nodes, templates, '').length === 0, 'empty query returns nothing');
assert(searchNodes(nodes, templates, 'zzz').length === 0, 'no-match query returns nothing');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
