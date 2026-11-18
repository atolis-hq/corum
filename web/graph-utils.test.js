// run with: node web/graph-utils.test.js
const graphUtils = require('./graph-utils.js');
const { buildNamespaceMap, applyEdgeTypeFilter, collectEdgeTypes, getDisplayName } = graphUtils;

(async () => {
  let passed = 0, failed = 0;
  function assert(condition, name) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.error(`  ✗ ${name}`); failed++; }
  }

  const nodes = [
    { id: 'orders.DomainModel.order', template: 'DomainModel', namespace: 'orders', state: 'agreed', stability: 'stable' },
    { id: 'orders.RestAPI.ordersApi', template: 'RestAPI', namespace: 'orders', state: 'agreed', stability: 'stable' },
    { id: 'payments.DomainModel.payment', template: 'DomainModel', namespace: 'payments', state: 'proposed', stability: 'unstable' },
    { id: 'payments.RestAPI.paymentsApi', template: 'RestAPI', namespace: 'payments', state: 'proposed', stability: 'unstable' },
  ];

  const edges = [
    { id: 'e1', from: 'orders.RestAPI.ordersApi', to: 'orders.DomainModel.order', type: 'reads' },
    { id: 'e2', from: 'orders.RestAPI.ordersApi', to: 'payments.RestAPI.paymentsApi', type: 'calls' },
    { id: 'e3', from: 'payments.RestAPI.paymentsApi', to: 'payments.DomainModel.payment', type: 'reads' },
  ];

  assert(graphUtils.buildFocusGraph === undefined, 'buildFocusGraph export removed');
  assert(getDisplayName('orders.DomainModel.order') === 'order', 'getDisplayName returns last segment');
  assert(getDisplayName('payments.RestAPI.paymentsApi') === 'paymentsApi', 'getDisplayName handles nested id');

  const cm = buildNamespaceMap(nodes, edges);
  assert(cm.nodes.length === 2, 'buildNamespaceMap: one node per component');
  assert(cm.nodes.every(n => typeof n.count === 'number' && n.count > 0), 'buildNamespaceMap: nodes have count');
  const cmOrders = cm.nodes.find(n => n.id === 'orders');
  assert(cmOrders?.count === 2, 'buildNamespaceMap: orders has 2 nodes');
  assert(cm.edges.length === 1, 'buildNamespaceMap: one cross-component edge');
  assert(cm.edges[0].from === 'orders' && cm.edges[0].to === 'payments', 'buildNamespaceMap: edge direction correct');
  assert(cm.edges[0].types.includes('calls'), 'buildNamespaceMap: edge types collected');
  const sameCmEdges = buildNamespaceMap(nodes, [{ id: 'x', from: 'orders.DomainModel.order', to: 'orders.RestAPI.ordersApi', type: 'reads' }]);
  assert(sameCmEdges.edges.length === 0, 'buildNamespaceMap: intra-component edges excluded');

  const filtered = applyEdgeTypeFilter(edges, new Set(['reads']));
  assert(filtered.length === 2, 'applyEdgeTypeFilter: keeps only matching type');
  assert(filtered.every(e => e.type === 'reads'), 'applyEdgeTypeFilter: all results have correct type');
  const none = applyEdgeTypeFilter(edges, new Set([]));
  assert(none.length === 0, 'applyEdgeTypeFilter: empty set returns nothing');

  const focusOnlyEdges = [{ id: 'e4', from: 'orders.DomainModel.order', to: 'payments.DomainModel.payment', type: 'precedes' }];
  assert(
    JSON.stringify(collectEdgeTypes(edges, focusOnlyEdges)) === JSON.stringify(['calls', 'precedes', 'reads']),
    'collectEdgeTypes: includes types that exist only in focus data',
  );

  const { computeConnectedComponents, filterThreadScope, filterOwnerScope } = graphUtils;

  const ccAll = computeConnectedComponents(nodes, edges);
  assert(ccAll.length === 1, 'computeConnectedComponents: fully linked graph is one component');
  const ccSplit = computeConnectedComponents(nodes, [edges[0], edges[2]]);
  assert(ccSplit.length === 2, 'computeConnectedComponents: removing bridge edge splits components');
  const ccIsolated = computeConnectedComponents([...nodes, { id: 'lone.Node.x', template: 'X', namespace: 'lone' }], edges);
  assert(ccIsolated.some(c => c.length === 1 && c[0] === 'lone.Node.x'), 'computeConnectedComponents: isolated node is own component');
  const ccMerged = computeConnectedComponents(nodes, [edges[0], edges[2]], [{ from: 'orders.DomainModel.order', to: 'payments.DomainModel.payment' }]);
  assert(ccMerged.length === 1, 'computeConnectedComponents: extraLinks merge components');

  const splitEdges = [edges[0], edges[2]];
  const scoped = filterThreadScope(nodes, splitEdges, { edgeType: 'reads', fromTemplate: 'RestAPI', toTemplate: null });
  assert(scoped.threadCount === 2 && scoped.matchCount === 2, 'filterThreadScope: both threads have RestAPI reads');
  const scopedNone = filterThreadScope(nodes, splitEdges, { edgeType: 'calls', fromTemplate: null, toTemplate: null });
  assert(scopedNone.matchCount === 0 && scopedNone.nodeIds.size === 0, 'filterThreadScope: no matching threads yields empty set');
  const scopedTo = filterThreadScope(nodes, splitEdges, { edgeType: 'reads', fromTemplate: null, toTemplate: 'DomainModel' });
  assert(scopedTo.nodeIds.has('orders.RestAPI.ordersApi'), 'filterThreadScope: matching thread includes all its nodes');

  const aggNodes = [
    { id: 'a.T.agg', template: 'T', parentId: null },
    { id: 'a.T.agg.ops.one', template: 'Op', parentId: 'a.T.agg' },
    { id: 'a.T.agg.ops.two', template: 'Op', parentId: 'a.T.agg' },
    { id: 'a.T.other', template: 'T', parentId: null },
    { id: 'a.T.unrelated', template: 'T', parentId: null },
  ];
  const aggEdges = [
    { id: 'ae1', from: 'a.T.agg.ops.one', to: 'a.T.other', type: 'reads' },
    { id: 'ae2', from: 'a.T.unrelated', to: 'a.T.other', type: 'reads' },
    { id: 'ae3', from: 'a.T.reader', to: 'a.T.agg', type: 'reads' },
  ];
  const aggScope = filterOwnerScope([...aggNodes, { id: 'a.T.reader', template: 'T', parentId: null }], aggEdges, 'a.T.agg');
  assert(aggScope.has('a.T.agg.ops.one') && aggScope.has('a.T.agg.ops.two'), 'filterOwnerScope: keeps members');
  assert(aggScope.has('a.T.agg'), 'filterOwnerScope: keeps the owner node itself');
  assert(aggScope.has('a.T.other'), 'filterOwnerScope: keeps direct neighbours');
  assert(aggScope.has('a.T.reader'), 'filterOwnerScope: keeps neighbours of the owner node');
  assert(!aggScope.has('a.T.unrelated'), 'filterOwnerScope: drops unrelated nodes');

  // Kind filtering and colouring
  const { filterByKind, collectKinds, kindColour } = graphUtils;
  const kNodes = [
    { id: 'orders.A.a', namespace: 'orders', kind: 'component' },
    { id: 'orders.A.b', namespace: 'orders' },
    { id: 'signup.J.j', namespace: 'signup', kind: 'journey' },
  ];
  const kEdges = [
    { id: 'k1', from: 'orders.A.a', to: 'orders.A.b', type: 'reads' },
    { id: 'k2', from: 'signup.J.j', to: 'orders.A.a', type: 'calls' },
  ];
  assert(JSON.stringify(collectKinds(kNodes)) === JSON.stringify(['component', 'journey']), 'collectKinds: distinct sorted kinds, default component');
  const fc = filterByKind(kNodes, kEdges, 'component');
  assert(fc.nodes.length === 2 && fc.edges.length === 1, 'filterByKind: component keeps only component nodes and internal edges');
  const fj = filterByKind(kNodes, kEdges, 'journey');
  assert(fj.nodes.length === 1 && fj.edges.length === 0, 'filterByKind: journey keeps journey namespace only');
  assert(filterByKind(kNodes, kEdges, 'all').nodes.length === 3, 'filterByKind: all keeps everything');
  assert(filterByKind(kNodes, kEdges, 'mystery').nodes.length === 0, 'filterByKind: unrecognised kind matches exactly');
  assert(kindColour('journey') === kindColour('journey') && kindColour('journey') !== kindColour('component'), 'kindColour: stable and distinct from component');
  const { resolveKindFilter } = graphUtils;
  assert(resolveKindFilter(null, kNodes) === 'component', 'resolveKindFilter: defaults to component when present');
  assert(resolveKindFilter(null, [{ id: 's.J.j', namespace: 's', kind: 'journey' }]) === 'all', 'resolveKindFilter: falls back to all when no component namespace');
  assert(resolveKindFilter(null, [{ id: 's.J.j', namespace: 's', kind: 'mystery' }]) === 'all', 'resolveKindFilter: falls back to all for unknown-only kinds');
  assert(resolveKindFilter('journey', kNodes) === 'journey', 'resolveKindFilter: explicit choice wins');
  const km = buildNamespaceMap(kNodes, kEdges);
  assert(km.nodes.find(n => n.id === 'signup')?.kind === 'journey', 'buildNamespaceMap: carries kind');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
