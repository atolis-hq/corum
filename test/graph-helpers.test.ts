import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (...parts: string[]) => import(pathToFileURL(path.join(process.cwd(), 'web', ...parts)).href)
const {
  buildNamespaceMap, collectKinds, filterByKind, resolveKindFilter, applyEdgeTypeFilter, collectEdgeTypes,
  computeConnectedComponents, filterThreadScope, filterOwnerScope,
} = await load('builtin', 'graph', 'graph-helpers.js')
const { getDisplayName, kindColour } = await load('sdk', 'helpers.js')

const check = (condition: unknown, name: string) => it(name, () => assert.ok(condition))

describe('graph helpers and SDK display helpers', () => {


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

  check(getDisplayName('orders.DomainModel.order') === 'order', 'getDisplayName returns last segment');
  check(getDisplayName('payments.RestAPI.paymentsApi') === 'paymentsApi', 'getDisplayName handles nested id');

  const cm = buildNamespaceMap(nodes, edges);
  check(cm.nodes.length === 2, 'buildNamespaceMap: one node per component');
  check(cm.nodes.every((n: any) => typeof n.count === 'number' && n.count > 0), 'buildNamespaceMap: nodes have count');
  const cmOrders = cm.nodes.find((n: any) => n.id === 'orders');
  check(cmOrders?.count === 2, 'buildNamespaceMap: orders has 2 nodes');
  check(cm.edges.length === 1, 'buildNamespaceMap: one cross-component edge');
  check(cm.edges[0].from === 'orders' && cm.edges[0].to === 'payments', 'buildNamespaceMap: edge direction correct');
  check(cm.edges[0].types.includes('calls'), 'buildNamespaceMap: edge types collected');
  const sameCmEdges = buildNamespaceMap(nodes, [{ id: 'x', from: 'orders.DomainModel.order', to: 'orders.RestAPI.ordersApi', type: 'reads' }]);
  check(sameCmEdges.edges.length === 0, 'buildNamespaceMap: intra-component edges excluded');

  const filtered = applyEdgeTypeFilter(edges, new Set(['reads']));
  check(filtered.length === 2, 'applyEdgeTypeFilter: keeps only matching type');
  check(filtered.every((e: any) => e.type === 'reads'), 'applyEdgeTypeFilter: all results have correct type');
  const none = applyEdgeTypeFilter(edges, new Set([]));
  check(none.length === 0, 'applyEdgeTypeFilter: empty set returns nothing');

  const focusOnlyEdges = [{ id: 'e4', from: 'orders.DomainModel.order', to: 'payments.DomainModel.payment', type: 'precedes' }];
  check(
    JSON.stringify(collectEdgeTypes(edges, focusOnlyEdges)) === JSON.stringify(['calls', 'precedes', 'reads']),
    'collectEdgeTypes: includes types that exist only in focus data',
  );


  const ccAll = computeConnectedComponents(nodes, edges);
  check(ccAll.length === 1, 'computeConnectedComponents: fully linked graph is one component');
  const ccSplit = computeConnectedComponents(nodes, [edges[0], edges[2]]);
  check(ccSplit.length === 2, 'computeConnectedComponents: removing bridge edge splits components');
  const ccIsolated = computeConnectedComponents([...nodes, { id: 'lone.Node.x', template: 'X', namespace: 'lone' }], edges);
  check(ccIsolated.some((c: any) => c.length === 1 && c[0] === 'lone.Node.x'), 'computeConnectedComponents: isolated node is own component');
  const ccMerged = computeConnectedComponents(nodes, [edges[0], edges[2]], [{ from: 'orders.DomainModel.order', to: 'payments.DomainModel.payment' }]);
  check(ccMerged.length === 1, 'computeConnectedComponents: extraLinks merge components');

  const splitEdges = [edges[0], edges[2]];
  const scoped = filterThreadScope(nodes, splitEdges, { edgeType: 'reads', fromTemplate: 'RestAPI', toTemplate: null });
  check(scoped.threadCount === 2 && scoped.matchCount === 2, 'filterThreadScope: both threads have RestAPI reads');
  const scopedNone = filterThreadScope(nodes, splitEdges, { edgeType: 'calls', fromTemplate: null, toTemplate: null });
  check(scopedNone.matchCount === 0 && scopedNone.nodeIds.size === 0, 'filterThreadScope: no matching threads yields empty set');
  const scopedTo = filterThreadScope(nodes, splitEdges, { edgeType: 'reads', fromTemplate: null, toTemplate: 'DomainModel' });
  check(scopedTo.nodeIds.has('orders.RestAPI.ordersApi'), 'filterThreadScope: matching thread includes all its nodes');

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
  check(aggScope.has('a.T.agg.ops.one') && aggScope.has('a.T.agg.ops.two'), 'filterOwnerScope: keeps members');
  check(aggScope.has('a.T.agg'), 'filterOwnerScope: keeps the owner node itself');
  check(aggScope.has('a.T.other'), 'filterOwnerScope: keeps direct neighbours');
  check(aggScope.has('a.T.reader'), 'filterOwnerScope: keeps neighbours of the owner node');
  check(!aggScope.has('a.T.unrelated'), 'filterOwnerScope: drops unrelated nodes');

  // Kind filtering and colouring
  const kNodes = [
    { id: 'orders.A.a', namespace: 'orders', kind: 'component' },
    { id: 'orders.A.b', namespace: 'orders' },
    { id: 'signup.J.j', namespace: 'signup', kind: 'journey' },
  ];
  const kEdges = [
    { id: 'k1', from: 'orders.A.a', to: 'orders.A.b', type: 'reads' },
    { id: 'k2', from: 'signup.J.j', to: 'orders.A.a', type: 'calls' },
  ];
  check(JSON.stringify(collectKinds(kNodes)) === JSON.stringify(['component', 'journey']), 'collectKinds: distinct sorted kinds, default component');
  const fc = filterByKind(kNodes, kEdges, 'component');
  check(fc.nodes.length === 2 && fc.edges.length === 1, 'filterByKind: component keeps only component nodes and internal edges');
  const fj = filterByKind(kNodes, kEdges, 'journey');
  check(fj.nodes.length === 1 && fj.edges.length === 0, 'filterByKind: journey keeps journey namespace only');
  check(filterByKind(kNodes, kEdges, 'all').nodes.length === 3, 'filterByKind: all keeps everything');
  check(filterByKind(kNodes, kEdges, 'mystery').nodes.length === 0, 'filterByKind: unrecognised kind matches exactly');
  check(kindColour('journey') === kindColour('journey') && kindColour('journey') !== kindColour('component'), 'kindColour: stable and distinct from component');
  check(resolveKindFilter(null, kNodes) === 'component', 'resolveKindFilter: defaults to component when present');
  check(resolveKindFilter(null, [{ id: 's.J.j', namespace: 's', kind: 'journey' }]) === 'all', 'resolveKindFilter: falls back to all when no component namespace');
  check(resolveKindFilter(null, [{ id: 's.J.j', namespace: 's', kind: 'mystery' }]) === 'all', 'resolveKindFilter: falls back to all for unknown-only kinds');
  check(resolveKindFilter('journey', kNodes) === 'journey', 'resolveKindFilter: explicit choice wins');
  const km = buildNamespaceMap(kNodes, kEdges);
  check(km.nodes.find((n: any) => n.id === 'signup')?.kind === 'journey', 'buildNamespaceMap: carries kind');

})
