/* Pure graph utility functions — browser globals + Node require() compatible. */

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

function applyEdgeTypeFilter(edges, visibleTypes) {
  return edges.filter(e => visibleTypes.has(e.type));
}

// Weakly connected components. Edges use {from, to}; extraLinks are additional
// affinity pairs (e.g. group co-membership) that merge components without
// being real edges. Returns arrays of node ids.
function computeConnectedComponents(nodes, edges, extraLinks = []) {
  const adjacency = new Map(nodes.map(n => [n.id, []]));
  for (const link of [...edges, ...extraLinks]) {
    if (!adjacency.has(link.from) || !adjacency.has(link.to)) continue;
    adjacency.get(link.from).push(link.to);
    adjacency.get(link.to).push(link.from);
  }
  const visited = new Set();
  const components = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const component = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length) {
      const id = queue.pop();
      component.push(id);
      for (const next of adjacency.get(id)) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

// Scope threads (connected components) to those containing an interaction:
// an edge of scope.edgeType whose endpoints match the optional
// fromTemplate/toTemplate. Returns the node ids of matching threads.
function filterThreadScope(nodes, edges, scope) {
  const components = computeConnectedComponents(nodes, edges);
  const templateById = new Map(nodes.map(n => [n.id, n.template]));
  const matchingEdges = edges.filter(e =>
    e.type === scope.edgeType &&
    (!scope.fromTemplate || templateById.get(e.from) === scope.fromTemplate) &&
    (!scope.toTemplate || templateById.get(e.to) === scope.toTemplate)
  );
  const matchEndpoints = new Set(matchingEdges.flatMap(e => [e.from, e.to]));
  const nodeIds = new Set();
  let matchCount = 0;
  for (const component of components) {
    if (!component.some(id => matchEndpoints.has(id))) continue;
    matchCount += 1;
    for (const id of component) nodeIds.add(id);
  }
  return { nodeIds, threadCount: components.length, matchCount };
}

// Scope to one owner: the owner node itself, nodes owned by it, plus their
// direct neighbours via the given edges.
function filterOwnerScope(nodes, edges, parentId) {
  const memberIds = new Set(nodes.filter(n => n.id === parentId || n.parentId === parentId).map(n => n.id));
  const nodeIds = new Set(memberIds);
  for (const e of edges) {
    if (memberIds.has(e.from)) nodeIds.add(e.to);
    if (memberIds.has(e.to)) nodeIds.add(e.from);
  }
  return nodeIds;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildComponentMap, applyEdgeTypeFilter, getDisplayName, computeConnectedComponents, filterThreadScope, filterOwnerScope };
}
if (typeof window !== 'undefined') {
  window.CorumGraphUtils = { buildComponentMap, applyEdgeTypeFilter, getDisplayName, computeConnectedComponents, filterThreadScope, filterOwnerScope };
}
