// run with: node web/graph-utils.test.js
const { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName } = require('./graph-utils.js');

(async () => {

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

  // buildFocusGraph - depth Infinity directed lineage (no sideways crawl)
  // ordersApi → order and ordersApi → paymentsApi → payment
  // Focusing on payment: upstream = {paymentsApi, ordersApi}, downstream = {}
  // order must NOT appear — it's downstream of ordersApi but not in payment's lineage
  const focusPayment = buildFocusGraph('payments.DomainModel.payment', nodes, edges, Infinity);
  assert(focusPayment.nodes.length === 3, 'buildFocusGraph depth=Infinity directed: excludes sideways nodes');
  assert(!focusPayment.nodes.some(n => n.id === 'orders.DomainModel.order'), 'buildFocusGraph depth=Infinity directed: sibling branch excluded');
  assert(focusPayment.nodes.some(n => n.id === 'orders.RestAPI.ordersApi'), 'buildFocusGraph depth=Infinity directed: upstream root included');

  // buildFocusGraph - directed BFS + parentId traversal (upstream pass only)
  // op --produces--> event  (op is upstream of event)
  // op.parentId = agg
  // agg --reads--> tgt      (tgt is sideways — downstream of agg only)
  //
  // From event, upstream directed BFS: event ← op (d=1) ← agg (d=2 via parentId).
  // tgt must NOT appear at any depth: only reachable via a downstream edge from agg,
  // which the upstream pass never follows.
  const parentNodes = [
    { id: 'b.Event.e',                       template: 'DomainEvent',     component: 'b', state: 'agreed', stability: 'stable', parentId: null },
    { id: 'z.DomainModel.root',              template: 'DomainModel',     component: 'z', state: 'agreed', stability: 'stable', parentId: null },
    { id: 'a.DomainModel.agg',               template: 'DomainModel',     component: 'a', state: 'agreed', stability: 'stable', parentId: null },
    { id: 'a.DomainModel.agg.operations.op', template: 'DomainOperation', component: 'a', state: 'agreed', stability: 'stable', parentId: 'a.DomainModel.agg' },
    { id: 'c.DomainModel.tgt',               template: 'DomainModel',     component: 'c', state: 'agreed', stability: 'stable', parentId: null },
  ];
  const parentEdges = [
    { id: 'p1', from: 'a.DomainModel.agg.operations.op', to: 'b.Event.e',        type: 'produces' },
    { id: 'p0', from: 'z.DomainModel.root',              to: 'a.DomainModel.agg', type: 'reads'    },
    { id: 'p2', from: 'a.DomainModel.agg',               to: 'c.DomainModel.tgt', type: 'reads'    },
  ];
  const fp1 = buildFocusGraph('b.Event.e', parentNodes, parentEdges, 1);
  assert(fp1.nodes.some(n => n.id === 'a.DomainModel.agg.operations.op'), 'parentId: depth=1 includes producing op (upstream)');
  assert(!fp1.nodes.some(n => n.id === 'a.DomainModel.agg'), 'parentId: depth=1 does not yet include aggregate');
  const fp2 = buildFocusGraph('b.Event.e', parentNodes, parentEdges, 2);
  assert(!fp2.nodes.some(n => n.id === 'a.DomainModel.agg'), 'parentId: depth=2 prunes aggregate when it has no surviving semantic edge');
  assert(!fp2.nodes.some(n => n.id === 'c.DomainModel.tgt'), 'parentId: depth=2 excludes sideways tgt');
  const fp3 = buildFocusGraph('b.Event.e', parentNodes, parentEdges, 3);
  assert(fp3.nodes.some(n => n.id === 'z.DomainModel.root'), 'parentId: depth=3 still uses aggregate traversal to reach upstream root');
  assert(!fp3.nodes.some(n => n.id === 'c.DomainModel.tgt'), 'parentId: depth=3 still excludes sideways tgt (directed)');

  // buildFocusGraph - Infinity keeps the same upstream parentId traversal
  const fpInf = buildFocusGraph('b.Event.e', parentNodes, parentEdges, Infinity);
  assert(fpInf.nodes.some(n => n.id === 'a.DomainModel.agg.operations.op'), 'parentId: Infinity follows semantic edges to op');
  assert(fpInf.nodes.some(n => n.id === 'z.DomainModel.root'), 'parentId: Infinity climbs through parent aggregate to upstream root');
  assert(fpInf.nodes.some(n => n.id === 'a.DomainModel.agg'), 'parentId: Infinity keeps aggregate once it participates in a surviving semantic edge');
  assert(!fpInf.nodes.some(n => n.id === 'c.DomainModel.tgt'), 'parentId: Infinity still excludes aggregate sideways connections');

  // buildFocusGraph - climbed parent without a surviving semantic edge is pruned
  const orphanParentNodes = [
    { id: 'payruns.DomainEvent.finalised',                          template: 'DomainEvent',     component: 'payruns', state: 'agreed', stability: 'stable', parentId: null },
    { id: 'payruns.DomainModel.PayRunAggregate',                    template: 'DomainModel',     component: 'payruns', state: 'agreed', stability: 'stable', parentId: null },
    { id: 'payruns.DomainModel.PayRunAggregate.operations.Finalise', template: 'DomainOperation', component: 'payruns', state: 'agreed', stability: 'stable', parentId: 'payruns.DomainModel.PayRunAggregate' },
  ];
  const orphanParentEdges = [
    { id: 'o1', from: 'payruns.DomainModel.PayRunAggregate.operations.Finalise', to: 'payruns.DomainEvent.finalised', type: 'produces' },
  ];
  const orphanParentFocus = buildFocusGraph('payruns.DomainEvent.finalised', orphanParentNodes, orphanParentEdges, 2);
  assert(orphanParentFocus.nodes.some(n => n.id === 'payruns.DomainModel.PayRunAggregate.operations.Finalise'), 'prune orphan parent: producing op remains visible');
  assert(!orphanParentFocus.nodes.some(n => n.id === 'payruns.DomainModel.PayRunAggregate'), 'prune orphan parent: aggregate without surviving edge is omitted');
  assert(orphanParentFocus.edges.length === 1, 'prune orphan parent: semantic edge remains intact');

  // applyEdgeTypeFilter
  const filtered = applyEdgeTypeFilter(edges, new Set(['reads']));
  assert(filtered.length === 2, 'applyEdgeTypeFilter: keeps only matching type');
  assert(filtered.every(e => e.type === 'reads'), 'applyEdgeTypeFilter: all results have correct type');
  const none = applyEdgeTypeFilter(edges, new Set([]));
  assert(none.length === 0, 'applyEdgeTypeFilter: empty set returns nothing');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
