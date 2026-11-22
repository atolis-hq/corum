/* Pure builders for the three graph levels: component map, component interior, node focus. */
import { getDisplayName, kindColour } from 'corum:ui'
import { buildNamespaceMap, filterByKind, applyEdgeTypeFilter, filterThreadScope, filterOwnerScope } from './graph-helpers.js'
import { makeRFEdge, buildRFNodesForNodes, buildRFEdgesForEdges } from './rf-builders.js'


// Level 1: one card per component (namespace), edges aggregated between components.
export function buildComponentLevel({ graphData, visibleEdgeTypes, kindFilter, navToComponent }) {
  const shown = filterByKind(graphData.nodes, graphData.edges, kindFilter)
  const { nodes: cmNodes, edges: cmEdges } = buildNamespaceMap(shown.nodes, shown.edges)
  const filteredCmEdges = cmEdges.filter(e => e.types.some(t => visibleEdgeTypes.has(t)))
  const rfN = cmNodes.map(n => ({
    id: n.id,
    type: 'componentCard',
    position: { x: 0, y: 0 },
    data: { label: n.namespace, count: n.count, kind: n.kind, kindColour: kindColour(n.kind), onClick: () => navToComponent(n.namespace) },
  }))
  const rfE = filteredCmEdges.map(e => {
    const repType = e.types.find(t => visibleEdgeTypes.has(t)) ?? e.types[0]
    return {
      ...makeRFEdge({ ...e, type: repType }),
      label: e.types.join(', '),
    }
  })
  return { rfN, rfE }
}

// Level 2: the nodes of one component plus the external nodes they connect to.
export function buildInteriorLevel({ graphData, selectedComponent, availableEdgeTypes, visibleEdgeTypes, templateMap, navToFocus, openNode, scope, kindByNamespace }) {
  const compNodes = graphData.nodes.filter(n => n.namespace === selectedComponent)
  const compNodeIds = new Set(compNodes.map(n => n.id))
  const internalEdges = graphData.edges.filter(e => compNodeIds.has(e.from) && compNodeIds.has(e.to))
  const crossEdges = graphData.edges.filter(e =>
    (compNodeIds.has(e.from) && !compNodeIds.has(e.to)) ||
    (!compNodeIds.has(e.from) && compNodeIds.has(e.to))
  )
  const externalNodeIds = new Set([
    ...crossEdges.map(e => e.from).filter(id => !compNodeIds.has(id)),
    ...crossEdges.map(e => e.to).filter(id => !compNodeIds.has(id)),
  ])
  const externalNodes = graphData.nodes.filter(n => externalNodeIds.has(n.id))
  const allVisibleNodes = [...compNodes, ...externalNodes]
  const allVisibleEdges = [...internalEdges, ...crossEdges]

  // Options for the scope popover reflect the unscoped view.
  const typedEdges = applyEdgeTypeFilter(allVisibleEdges, visibleEdgeTypes)
  const parentCounts = new Map()
  for (const n of allVisibleNodes) {
    if (!n.parentId) continue
    parentCounts.set(n.parentId, (parentCounts.get(n.parentId) ?? 0) + 1)
  }
  const scopeOptions = {
    edgeTypes: availableEdgeTypes.filter(t => visibleEdgeTypes.has(t) && typedEdges.some(e => e.type === t)),
    templates: [...new Set(allVisibleNodes.map(n => n.template))].sort()
      .map(name => ({ name, label: templateMap.get(name)?.ui?.displayName ?? name })),
    owners: [...parentCounts.entries()].filter(([, c]) => c >= 2).map(([pid]) => pid).sort()
      .map(pid => ({ id: pid, label: getDisplayName(pid) })),
  }

  // Apply the active scope: threads containing an interaction, then owner.
  let visibleNodes = allVisibleNodes
  let visibleEdges = allVisibleEdges
  let scopeInfo = null
  if (scope) {
    let keep = null
    if (scope.edgeType) {
      const result = filterThreadScope(visibleNodes, typedEdges, scope)
      keep = result.nodeIds
      scopeInfo = { matchCount: result.matchCount, threadCount: result.threadCount }
    }
    if (scope.owner) {
      const baseNodes = keep ? visibleNodes.filter(n => keep.has(n.id)) : visibleNodes
      const baseEdges = typedEdges.filter(e => !keep || (keep.has(e.from) && keep.has(e.to)))
      keep = filterOwnerScope(baseNodes, baseEdges, scope.owner)
    }
    if (keep) {
      const keepIds = keep
      visibleNodes = visibleNodes.filter(n => keepIds.has(n.id))
      visibleEdges = visibleEdges.filter(e => keepIds.has(e.from) && keepIds.has(e.to))
    }
  }

  const rfN = buildRFNodesForNodes(visibleNodes, templateMap, navToFocus, openNode, externalNodeIds, kindByNamespace)
  const rfE = buildRFEdgesForEdges(visibleEdges, visibleEdgeTypes).map(e => {
    const isCross = crossEdges.some(ce => ce.id === e.id)
    return isCross ? { ...e, className: `${e.className} graph-edge-cross` } : e
  })
  return { rfN, rfE, scopeOptions, scopeInfo }
}

// Level 3: lineage neighbourhood around the focal node.
export function buildFocusLevel({ graphData, focusData, focalNodeId, nodeById, visibleEdgeTypes, templateMap, navToFocus, openNode, kindByNamespace }) {
  const parentIdMap = new Map((graphData?.nodes ?? []).map(n => [n.id, n.parentId]))
  const focalNode = nodeById.get(focalNodeId)
  const lineageNodes = [
    ...(focalNode && !focusData.nodes.some(n => n.id === focalNodeId) ? [focalNode] : []),
    ...focusData.nodes,
  ].map(n => ({ ...n, parentId: parentIdMap.get(n.id) ?? null }))
  const rfN = buildRFNodesForNodes(lineageNodes, templateMap, navToFocus, openNode, undefined, kindByNamespace)
    .map(n => n.id === focalNodeId ? { ...n, data: { ...n.data, focal: true } } : n)
  const rfE = buildRFEdgesForEdges(applyEdgeTypeFilter(focusData.edges, visibleEdgeTypes), visibleEdgeTypes)
  return { rfN, rfE }
}
