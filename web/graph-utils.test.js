// run with: node web/graph-utils.test.js

function getDisplayName(nodeId) {
  return nodeId.split('.').pop();
}

function buildComponentMap(nodes, edges) {
  const componentCounts = new Map();
  for (const node of nodes) {
    componentCounts.set(node.component, (componentCounts.get(node.component) ?? 0) + 1);
  }

  const componentNodes = [...componentCounts.entries()].map(([component, count]) => ({
    id: component,
    component,
    count,
  }));

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const compEdgeMap = new Map();
  for (const edge of edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (fromNode.component === toNode.component) continue;
    const key = `${fromNode.component}__${toNode.component}`;
    if (!compEdgeMap.has(key)) compEdgeMap.set(key, { from: fromNode.component, to: toNode.component, types: new Set() });
    compEdgeMap.get(key).types.add(edge.type);
  }

  const componentEdges = [...compEdgeMap.entries()].map(([key, entry]) => ({
    id: key,
    from: entry.from,
    to: entry.to,
    types: [...entry.types],
  }));

  return { nodes: componentNodes, edges: componentEdges };
}

function buildFocusGraph(focalNodeId, nodes, edges, depth) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set([focalNodeId]);
  const queue = [{ id: focalNodeId, d: 0 }];

  while (queue.length > 0) {
    const { id, d } = queue.shift();
    if (d >= depth) continue;
    for (const edge of edges) {
      let neighborId = null;
      if (edge.from === id) neighborId = edge.to;
      else if (edge.to === id) neighborId = edge.from;
      if (!neighborId || visited.has(neighborId) || !nodeById.has(neighborId)) continue;
      visited.add(neighborId);
      queue.push({ id: neighborId, d: d + 1 });
    }
  }

  return {
    nodes: [...visited].map(id => nodeById.get(id)).filter(Boolean),
    edges: edges.filter(e => visited.has(e.from) && visited.has(e.to)),
  };
}

function applyEdgeTypeFilter(edges, visibleTypes) {
  return edges.filter(e => visibleTypes.has(e.type));
}

let passed = 0, failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}`); failed++; }
}

const nodes = [
  { id: 'orders.DomainModel.order',        template: 'DomainModel', component: 'orders',   state: 'agreed',    stability: 'stable' },
  { id: 'orders.RestAPI.ordersApi',         template: 'RestAPI',     component: 'orders',   state: 'agreed',    stability: 'stable' },
  { id: 'payments.DomainModel.payment',     template: 'DomainModel', component: 'payments', state: 'proposed',  stability: 'unstable' },
  { id: 'payments.RestAPI.paymentsApi',     template: 'RestAPI',     component: 'payments', state: 'proposed',  stability: 'unstable' },
];

const edges = [
  { id: 'e1', from: 'orders.RestAPI.ordersApi',     to: 'orders.DomainModel.order',    type: 'reads' },
  { id: 'e2', from: 'orders.RestAPI.ordersApi',     to: 'payments.RestAPI.paymentsApi', type: 'calls' },
  { id: 'e3', from: 'payments.RestAPI.paymentsApi', to: 'payments.DomainModel.payment', type: 'reads' },
];

// getDisplayName
assert(getDisplayName('orders.DomainModel.order') === 'order', 'getDisplayName returns last segment');
assert(getDisplayName('payments.RestAPI.paymentsApi') === 'paymentsApi', 'getDisplayName handles nested id');

// buildComponentMap
const cm = buildComponentMap(nodes, edges);
assert(cm.nodes.length === 2, 'buildComponentMap: one node per component');
assert(cm.nodes.every(n => typeof n.count === 'number' && n.count > 0), 'buildComponentMap: nodes have count');
const cmOrders = cm.nodes.find(n => n.id === 'orders');
assert(cmOrders?.count === 2, 'buildComponentMap: orders has 2 nodes');
assert(cm.edges.length === 1, 'buildComponentMap: one cross-component edge');
assert(cm.edges[0].from === 'orders' && cm.edges[0].to === 'payments', 'buildComponentMap: edge direction correct');
assert(cm.edges[0].types.includes('calls'), 'buildComponentMap: edge types collected');
const sameCmEdges = buildComponentMap(nodes, [{ id: 'x', from: 'orders.DomainModel.order', to: 'orders.RestAPI.ordersApi', type: 'reads' }]);
assert(sameCmEdges.edges.length === 0, 'buildComponentMap: intra-component edges excluded');

// buildFocusGraph - depth 1
const focus1 = buildFocusGraph('orders.RestAPI.ordersApi', nodes, edges, 1);
assert(focus1.nodes.some(n => n.id === 'orders.RestAPI.ordersApi'), 'buildFocusGraph depth=1: includes focal node');
assert(focus1.nodes.some(n => n.id === 'orders.DomainModel.order'), 'buildFocusGraph depth=1: includes 1-hop neighbour (via reads)');
assert(focus1.nodes.some(n => n.id === 'payments.RestAPI.paymentsApi'), 'buildFocusGraph depth=1: includes 1-hop neighbour (via calls)');
assert(!focus1.nodes.some(n => n.id === 'payments.DomainModel.payment'), 'buildFocusGraph depth=1: excludes 2-hop neighbour');
assert(focus1.edges.length === 2, 'buildFocusGraph depth=1: includes only edges within visible nodes');

// buildFocusGraph - depth Infinity
const focusAll = buildFocusGraph('orders.RestAPI.ordersApi', nodes, edges, Infinity);
assert(focusAll.nodes.length === 4, 'buildFocusGraph depth=Infinity: includes all reachable nodes');
assert(focusAll.edges.length === 3, 'buildFocusGraph depth=Infinity: includes all reachable edges');

// applyEdgeTypeFilter
const filtered = applyEdgeTypeFilter(edges, new Set(['reads']));
assert(filtered.length === 2, 'applyEdgeTypeFilter: keeps only matching type');
assert(filtered.every(e => e.type === 'reads'), 'applyEdgeTypeFilter: all results have correct type');
const none = applyEdgeTypeFilter(edges, new Set([]));
assert(none.length === 0, 'applyEdgeTypeFilter: empty set returns nothing');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
