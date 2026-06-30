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

  // All depths use directed two-pass BFS (downstream + upstream separately).
  // Undirected BFS lets upstream nodes "switch direction" and pull in sibling
  // chains — nodes that share an ancestor or descendant but are not in the
  // focal node's own lineage.
  //
  // parentId is an upstream relationship: an owned operation has no semantic
  // edges of its own, so climbing to the parent aggregate is the only way to
  // reach the edges that connect it to the wider graph. parentId traversal
  // belongs in the upstream pass only; adding it to the downstream pass would
  // re-introduce the same sideways crawl via the aggregate's other children.

  const downQueue = [{ id: focalNodeId, d: 0 }];
  while (downQueue.length > 0) {
    const item = downQueue.shift();
    const id = item.id;
    if (item.d >= depth) continue;
    for (const edge of edges) {
      if (edge.from === id && !visited.has(edge.to) && nodeById.has(edge.to)) {
        visited.add(edge.to);
        downQueue.push({ id: edge.to, d: item.d + 1 });
      }
    }
  }

  const upQueue = [{ id: focalNodeId, d: 0 }];
  while (upQueue.length > 0) {
    const item = upQueue.shift();
    const id = item.id;
    if (item.d >= depth) continue;
    for (const edge of edges) {
      if (edge.to === id && !visited.has(edge.from) && nodeById.has(edge.from)) {
        visited.add(edge.from);
        upQueue.push({ id: edge.from, d: item.d + 1 });
      }
    }
    const pid = nodeById.get(id)?.parentId;
    if (pid && !visited.has(pid) && nodeById.has(pid)) {
      visited.add(pid);
      upQueue.push({ id: pid, d: item.d + 1 });
    }
  }

  const visibleEdges = edges.filter(e => visited.has(e.from) && visited.has(e.to));
  const visibleNodeIds = new Set([focalNodeId]);
  for (const edge of visibleEdges) {
    visibleNodeIds.add(edge.from);
    visibleNodeIds.add(edge.to);
  }

  return {
    nodes: [...visibleNodeIds].map(id => nodeById.get(id)).filter(Boolean),
    edges: visibleEdges,
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
