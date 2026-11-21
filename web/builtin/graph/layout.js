/* ELK-based layout: flat and grouped modes, connected-component stacking, group box fitting. */
import ELK from 'elkjs'
import { getDisplayName } from 'corum:ui'
import { NODE_W, NODE_H } from './constants.js'
import { computeConnectedComponents } from './graph-helpers.js'


const elk = new ELK()

const ELK_BASE_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '40',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  // Disconnected sub-graphs are separated and stacked by computeLayout, not ELK.
  'elk.separateConnectedComponents': 'false',
}

const STACK_GAP = 100
const FRAGMENT_GAP = 40

// Flat ELK layout: every node is a direct child of the root.
async function computeFlatLayout(rfNodes, rfEdges, nodeW, nodeH) {
  if (!rfNodes.length) return rfNodes
  const nodeIds = new Set(rfNodes.map(n => n.id))
  const elkGraph = {
    id: 'root',
    layoutOptions: ELK_BASE_OPTIONS,
    children: rfNodes.map(n => ({ id: n.id, width: nodeW, height: nodeH })),
    edges: rfEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }
  const result = await elk.layout(elkGraph)
  const posById = new Map(result.children.map(c => [c.id, c]))
  return rfNodes.map(n => {
    const pos = posById.get(n.id)
    return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
  })
}

// Grouped ELK layout: nodes sharing a parentId (2+ visible siblings) are
// clustered into a compound "group:<parentId>" container node.
async function computeGroupedLayout(rfNodes, rfEdges, nodeW, nodeH) {
  if (!rfNodes.length) return rfNodes

  const parentCounts = new Map()
  for (const n of rfNodes) {
    const pid = n.data?.parentId
    if (!pid) continue
    parentCounts.set(pid, (parentCounts.get(pid) ?? 0) + 1)
  }
  const groupParentIds = new Set([...parentCounts.entries()].filter(([, c]) => c >= 2).map(([pid]) => pid))

  if (!groupParentIds.size) return computeFlatLayout(rfNodes, rfEdges, nodeW, nodeH)

  const nodeIds = new Set(rfNodes.map(n => n.id))
  const groupChildrenMap = new Map([...groupParentIds].map(pid => [pid, []]))
  const rootChildren = []

  for (const n of rfNodes) {
    const pid = n.data?.parentId
    if (pid && groupParentIds.has(pid)) {
      groupChildrenMap.get(pid).push({ id: n.id, width: nodeW, height: nodeH })
    } else {
      rootChildren.push({ id: n.id, width: nodeW, height: nodeH })
    }
  }

  for (const pid of groupParentIds) {
    rootChildren.push({
      id: 'group:' + pid,
      layoutOptions: { 'elk.padding': '[top=36,left=16,bottom=16,right=16]' },
      children: groupChildrenMap.get(pid),
    })
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: { ...ELK_BASE_OPTIONS, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' },
    children: rootChildren,
    edges: rfEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  const result = await elk.layout(elkGraph)

  const groupNodeIds = new Set([...groupParentIds].map(pid => 'group:' + pid))
  const groupBoxes = new Map()
  const nodePositions = new Map()

  for (const child of result.children) {
    if (groupNodeIds.has(child.id)) {
      groupBoxes.set(child.id, { x: child.x, y: child.y, width: child.width, height: child.height })
      for (const gc of child.children ?? []) {
        nodePositions.set(gc.id, { x: gc.x, y: gc.y })
      }
    } else {
      nodePositions.set(child.id, { x: child.x, y: child.y })
    }
  }

  const groupNodes = [...groupBoxes.entries()].map(([gid, box]) => ({
    id: gid,
    type: 'groupCard',
    position: { x: box.x, y: box.y },
    style: { width: box.width, height: box.height },
    data: { label: getDisplayName(gid.slice('group:'.length)) },
  }))

  const memberNodes = rfNodes.map(n => {
    const pos = nodePositions.get(n.id) ?? { x: 0, y: 0 }
    const pid = n.data?.parentId
    if (pid && groupParentIds.has(pid)) {
      // The group box already shows the owner; drop the per-card owner chip.
      // No extent constraint: members drag freely and the box refits around them.
      return { ...n, position: pos, parentNode: 'group:' + pid, data: { ...n.data, parentLabel: null } }
    }
    return { ...n, position: pos }
  })

  // Parent/group nodes must precede their children in the React Flow nodes array.
  return [...groupNodes, ...memberNodes]
}

const GROUP_PAD = { top: 36, right: 16, bottom: 16, left: 16 }

// Fit each group box around its children. With shiftOrigin the box origin
// moves and children are re-based (full normalise, safe after a drag ends);
// without it the box only grows right/down, which avoids fighting React
// Flow's pointer tracking mid-drag.
export function fitGroupsToChildren(nodes, shiftOrigin) {
  const fits = new Map()
  for (const g of nodes) {
    if (g.type !== 'groupCard') continue
    const children = nodes.filter(n => n.parentNode === g.id)
    if (!children.length) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of children) {
      minX = Math.min(minX, c.position.x)
      minY = Math.min(minY, c.position.y)
      maxX = Math.max(maxX, c.position.x + (c.width ?? NODE_W))
      maxY = Math.max(maxY, c.position.y + (c.height ?? NODE_H))
    }
    fits.set(g.id, shiftOrigin
      ? {
          dx: minX - GROUP_PAD.left,
          dy: minY - GROUP_PAD.top,
          width: (maxX - minX) + GROUP_PAD.left + GROUP_PAD.right,
          height: (maxY - minY) + GROUP_PAD.top + GROUP_PAD.bottom,
        }
      : {
          dx: 0,
          dy: 0,
          width: Math.max(g.style?.width ?? 0, maxX + GROUP_PAD.right),
          height: Math.max(g.style?.height ?? 0, maxY + GROUP_PAD.bottom),
        })
  }
  if (!fits.size) return nodes
  return nodes.map(n => {
    if (n.type === 'groupCard' && fits.has(n.id)) {
      const f = fits.get(n.id)
      return { ...n, position: { x: n.position.x + f.dx, y: n.position.y + f.dy }, style: { ...n.style, width: f.width, height: f.height } }
    }
    if (n.parentNode && fits.has(n.parentNode)) {
      const f = fits.get(n.parentNode)
      if (!f.dx && !f.dy) return n
      return { ...n, position: { x: n.position.x - f.dx, y: n.position.y - f.dy } }
    }
    return n
  })
}

// Lay out each connected component independently, then stack them as
// left-aligned rows so every flow reads left-to-right from a common edge.
// Small fragments (pairs/singletons) are packed into a compact grid below.
export async function computeLayout(rfNodes, rfEdges, nodeW, nodeH, mode) {
  if (!rfNodes.length) return rfNodes

  // In grouped mode, group co-membership must not split across components.
  const extraLinks = []
  if (mode === 'grouped') {
    const byParent = new Map()
    for (const n of rfNodes) {
      const pid = n.data?.parentId
      if (!pid) continue
      if (!byParent.has(pid)) byParent.set(pid, [])
      byParent.get(pid).push(n.id)
    }
    for (const ids of byParent.values()) {
      for (let i = 1; i < ids.length; i++) extraLinks.push({ from: ids[0], to: ids[i] })
    }
  }

  const links = rfEdges.map(e => ({ from: e.source, to: e.target }))
  const components = computeConnectedComponents(rfNodes, links, extraLinks)
    .sort((a, b) => b.length - a.length)
  const flows = components.filter(c => c.length >= 3)
  const fragments = components.filter(c => c.length < 3)
  const nodeById = new Map(rfNodes.map(n => [n.id, n]))

  const layouts = await Promise.all(flows.map(ids => {
    const idSet = new Set(ids)
    const subNodes = ids.map(id => nodeById.get(id))
    const subEdges = rfEdges.filter(e => idSet.has(e.source) && idSet.has(e.target))
    return mode === 'grouped'
      ? computeGroupedLayout(subNodes, subEdges, nodeW, nodeH)
      : computeFlatLayout(subNodes, subEdges, nodeW, nodeH)
  }))

  const out = []
  let offsetY = 0
  let maxWidth = 0
  for (const layoutNodes of layouts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of layoutNodes) {
      if (n.parentNode) continue // group members are positioned relative to their group
      const w = n.style?.width ?? nodeW
      const h = n.style?.height ?? nodeH
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + w)
      maxY = Math.max(maxY, n.position.y + h)
    }
    for (const n of layoutNodes) {
      out.push(n.parentNode ? n : { ...n, position: { x: n.position.x - minX, y: n.position.y - minY + offsetY } })
    }
    offsetY += (maxY - minY) + STACK_GAP
    maxWidth = Math.max(maxWidth, maxX - minX)
  }

  const wrapWidth = Math.max(maxWidth, 1600)
  let gx = 0, gy = offsetY
  for (const ids of fragments) {
    const idSet = new Set(ids)
    const subEdges = rfEdges.filter(e => idSet.has(e.source) && idSet.has(e.target))
    // Order pairs source-first so the arrow reads left-to-right.
    const ordered = ids.length === 2 && subEdges.length ? [subEdges[0].source, subEdges[0].target] : ids
    const fragW = ordered.length * nodeW + (ordered.length - 1) * FRAGMENT_GAP
    if (gx > 0 && gx + fragW > wrapWidth) { gx = 0; gy += nodeH + FRAGMENT_GAP }
    ordered.forEach((id, i) => {
      out.push({ ...nodeById.get(id), position: { x: gx + i * (nodeW + FRAGMENT_GAP), y: gy } })
    })
    gx += fragW + FRAGMENT_GAP * 2
  }

  return out
}
