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

function buildFocusGraph(focalNodeId, nodes, edges, depth) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set([focalNodeId]);

  if (depth === Infinity) {
    // Full lineage: directed BFS upstream and downstream separately.
    // Undirected BFS would "switch direction" at upstream nodes and pull in
    // unrelated sideways branches, so we do two separate directed passes.
    const downQueue = [focalNodeId];
    while (downQueue.length > 0) {
      const id = downQueue.shift();
      for (const edge of edges) {
        if (edge.from === id && !visited.has(edge.to) && nodeById.has(edge.to)) {
          visited.add(edge.to);
          downQueue.push(edge.to);
        }
      }
    }
    const upQueue = [focalNodeId];
    while (upQueue.length > 0) {
      const id = upQueue.shift();
      for (const edge of edges) {
        if (edge.to === id && !visited.has(edge.from) && nodeById.has(edge.from)) {
          visited.add(edge.from);
          upQueue.push(edge.from);
        }
      }
    }
  } else {
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
  }

  return {
    nodes: [...visited].map(id => nodeById.get(id)).filter(Boolean),
    edges: edges.filter(e => visited.has(e.from) && visited.has(e.to)),
  };
}

function applyEdgeTypeFilter(edges, visibleTypes) {
  return edges.filter(e => visibleTypes.has(e.type));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName };
}
if (typeof window !== 'undefined') {
  window.CorumGraphUtils = { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName };
}
