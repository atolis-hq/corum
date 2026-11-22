/* Build React Flow node and edge objects from graph API data. */
import { MarkerType } from 'reactflow'
import { getDisplayName, kindColour, edgeTypeStyle } from 'corum:ui'
import { applyEdgeTypeFilter } from './graph-helpers.js'

/* Edge appearance comes from the shared edge-type helper as custom properties; stroke, dash, label colour and
   opacity are applied by the `.graph-edge` rules in web/style.css. The arrowhead lives in a shared <defs> outside
   the edge, so it takes the `--pack-edge-*` reference (defined on :root), which the helper's value already is. */
export function makeRFEdge(edge) {
  const style = edgeTypeStyle(edge.type)
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.type,
    className: 'graph-edge',
    labelStyle: style,
    style,
    markerEnd: { type: MarkerType.ArrowClosed, color: style['--edge-colour'], width: 14, height: 14 },
    type: 'default',
  }
}

export function buildRFNodesForNodes(graphNodes, templateMap, onNodeClick, onOpenNode, fadedIds, kindByNamespace) {
  return graphNodes.map(n => {
    const tmpl = templateMap.get(n.template)
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
        template: n.template,
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
  return applyEdgeTypeFilter(edges, visibleEdgeTypes).map(e => makeRFEdge(e))
}
