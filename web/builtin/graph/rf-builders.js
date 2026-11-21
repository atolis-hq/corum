/* Build React Flow node and edge objects from graph API data. */
import { MarkerType } from 'reactflow'
import { getDisplayName, kindColour } from 'corum:ui'
import { EDGE_STYLES } from './constants.js'
import { applyEdgeTypeFilter } from './graph-helpers.js'


export function makeRFEdge(edge, edgeStyles) {
  const style = edgeStyles[edge.type] || { stroke: '#a8acb5', strokeWidth: 1.5 }
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.type,
    labelStyle: { fontSize: 10, fill: style.stroke },
    labelBgStyle: { fill: 'var(--paper)', fillOpacity: 0.85 },
    style: { stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDasharray: style.strokeDasharray },
    markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    type: 'default',
  }
}

export function buildRFNodesForNodes(graphNodes, templateMap, onNodeClick, onOpenNode, fadedIds, kindByNamespace) {
  return graphNodes.map(n => {
    const tmpl = templateMap.get(n.template)
    const colour = tmpl?.ui?.colour ?? 'var(--ink-4)'
    const parentLabel = n.parentId ? getDisplayName(n.parentId) : null
    return {
      id: n.id,
      type: 'nodeCard',
      position: { x: 0, y: 0 },
      data: {
        nodeId: n.id,
        label: getDisplayName(n.id),
        component: n.namespace,
        kindColour: kindColour(n.kind ?? kindByNamespace?.get(n.namespace)),
        templateLabel: tmpl?.ui?.displayName ?? n.template,
        colour,
        state: n.state,
        stability: n.stability,
        onClick: () => onNodeClick(n.id),
        onOpen: () => onOpenNode(n.id),
        parentLabel,
        parentId: n.parentId ?? null,
        faded: fadedIds?.has(n.id) ?? false,
      },
    }
  })
}

export function buildRFEdgesForEdges(edges, visibleEdgeTypes) {
  return applyEdgeTypeFilter(edges, visibleEdgeTypes).map(e => makeRFEdge(e, EDGE_STYLES))
}
