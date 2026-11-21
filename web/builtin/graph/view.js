/* Graph view: interactive three-level canvas using React Flow + ELK.js. */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import ReactFlowCanvas, { MiniMap, Background, useNodesState, useEdgesState, ReactFlowProvider } from 'reactflow'
import { html } from 'corum:ui'
import {
  GraphUtils, NODE_W, NODE_H, COMP_W, COMP_H,
  loadHiddenEdgeTypes, saveHiddenEdgeTypes, loadLayoutMode, saveLayoutMode,
} from './constants.js'
import { computeLayout, fitGroupsToChildren } from './layout.js'
import { buildComponentLevel, buildInteriorLevel, buildFocusLevel } from './levels.js'
import { nodeTypes } from './node-cards.js'
import { GraphBreadcrumb, GraphToolbar } from './toolbar.js'

const { resolveKindFilter, collectKinds, collectEdgeTypes } = GraphUtils

export function GraphView({ ctx }) {
  const { params, templates } = ctx
  const [graphData, setGraphData] = useState(null)
  const [error, setError] = useState(null)
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState(loadHiddenEdgeTypes)
  const [showMinimap, setShowMinimap] = useState(false)
  const [depth, setDepth] = useState(2)
  const [layoutKey, setLayoutKey] = useState(0)
  const [layoutMode, setLayoutMode] = useState(loadLayoutMode)
  const [scope, setScope] = useState(null)
  const [focusData, setFocusData] = useState(null)
  const [reactFlowInstance, setReactFlowInstance] = useState(null)
  const pendingViewportRef = useRef(null)
  const lastFocusedNodeIdRef = useRef(null)
  const debounceTimerRef = useRef(null)
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([])

  // Derive level and selection from URL
  const selectedComponent = params.get('component') ?? null
  const focalNodeId = params.get('focus') ?? null
  const level = focalNodeId ? 'focus' : selectedComponent ? 'interior' : 'component'
  // Namespace-level map defaults to the default kind; 'all' shows every kind.
  const requestedKind = params.get('kind')
  const kindFilter = resolveKindFilter(requestedKind, graphData?.nodes ?? [])
  const kindParams = requestedKind ? { kind: requestedKind } : {}
  const [kindRegistry, setKindRegistry] = useState([])

  const goTo = useCallback(
    nextParams => ctx.navigate(ctx.hrefForPage(nextParams)),
    [ctx.navigate, ctx.hrefForPage],
  )

  useEffect(() => {
    ctx.api.get('/api/kinds')
      .then(data => setKindRegistry(data.kinds ?? []))
      .catch(() => setKindRegistry([]))
  }, [ctx.viewingRef])

  const navToKind = useCallback(kind => {
    goTo(kind === 'component' ? {} : { kind })
  }, [goTo])

  useEffect(() => { setScope(null) }, [selectedComponent])

  const navToRoot = useCallback(() => {
    goTo({ ...kindParams })
  }, [goTo, requestedKind])

  const navToComponent = useCallback(component => {
    goTo({ component, ...kindParams })
  }, [goTo, requestedKind])

  const navToFocus = useCallback(nodeId => {
    const next = { focus: nodeId }
    if (selectedComponent) next.component = selectedComponent
    goTo(next)
  }, [goTo, selectedComponent])

  useEffect(() => {
    setGraphData(null)
    setFocusData(null)
    setError(null)
    ctx.api.get('/api/graph')
      .then(setGraphData)
      .catch(err => setError(err.message))
  }, [ctx.viewingRef])

  useEffect(() => {
    if (!focalNodeId) { setFocusData(null); return }
    setFocusData(null)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      ctx.api.get('/api/lineage', [
        ['node_ids', focalNodeId],
        ['depth', depth === Infinity ? '999' : String(depth)],
        ['direction', 'both'],
        ['reads_outbound_only', 'false'],
      ])
        .then(data => { setFocusData(data) })
        .catch(err => setError(err.message))
    }, 150)
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [focalNodeId, depth, ctx.viewingRef])

  const templateMap = useMemo(() => new Map((templates ?? []).map(t => [t.name, t])), [templates])
  const availableEdgeTypes = useMemo(() => collectEdgeTypes(graphData?.edges ?? [], focusData?.edges ?? []), [graphData, focusData])
  const visibleEdgeTypes = useMemo(
    () => new Set(availableEdgeTypes.filter(type => !hiddenEdgeTypes.has(type))),
    [availableEdgeTypes, hiddenEdgeTypes],
  )

  const kindByNamespace = useMemo(
    () => new Map((graphData?.nodes ?? []).map(n => [n.namespace, n.kind ?? 'component'])),
    [graphData],
  )
  const kindOptions = useMemo(() => {
    const labels = new Map(kindRegistry.map(k => [k.id, k.label]))
    return [
      { id: 'all', label: 'All' },
      ...collectKinds(graphData?.nodes ?? []).map(id => ({ id, label: labels.get(id) ?? id })),
    ]
  }, [graphData, kindRegistry])

  // Level 1: component map
  const level1 = useMemo(() => {
    if (!graphData) return null
    return buildComponentLevel({ graphData, visibleEdgeTypes, kindFilter, navToComponent })
  }, [graphData, visibleEdgeTypes, layoutKey, navToComponent, kindFilter])

  useEffect(() => {
    if (level !== 'component' || !level1) return
    let cancelled = false
    pendingViewportRef.current = { type: 'full' }
    computeLayout(level1.rfN, level1.rfE, COMP_W, COMP_H, layoutMode).then(positioned => {
      if (cancelled) return
      setRfNodes(positioned)
      setRfEdges(level1.rfE)
    })
    return () => { cancelled = true }
  }, [level, level1, layoutMode])

  // Level 2: component interior
  const level2 = useMemo(() => {
    if (!graphData || !selectedComponent) return null
    return buildInteriorLevel({ graphData, selectedComponent, availableEdgeTypes, visibleEdgeTypes, templateMap, navToFocus, openNode: ctx.openNode, scope, kindByNamespace })
  }, [graphData, selectedComponent, availableEdgeTypes, visibleEdgeTypes, templateMap, layoutKey, navToFocus, scope, kindByNamespace])

  useEffect(() => {
    if (level !== 'interior' || !level2) return
    let cancelled = false
    pendingViewportRef.current = { type: 'full' }
    computeLayout(level2.rfN, level2.rfE, NODE_W, NODE_H, layoutMode).then(positioned => {
      if (cancelled) return
      setRfNodes(positioned)
      setRfEdges(level2.rfE)
    })
    return () => { cancelled = true }
  }, [level, level2, layoutMode])

  useEffect(() => {
    if (level === 'focus') return
    lastFocusedNodeIdRef.current = null
  }, [level])

  // Level 3: node focus
  const nodeById = useMemo(
    () => new Map((graphData?.nodes ?? []).map(n => [n.id, n])),
    [graphData],
  )

  const level3 = useMemo(() => {
    if (!focusData || !focalNodeId) return null
    return buildFocusLevel({ graphData, focusData, focalNodeId, nodeById, visibleEdgeTypes, templateMap, navToFocus, openNode: ctx.openNode, kindByNamespace })
  }, [focusData, focalNodeId, visibleEdgeTypes, templateMap, layoutKey, graphData, nodeById, navToFocus, kindByNamespace])

  useEffect(() => {
    if (level !== 'focus' || !level3) return
    let cancelled = false
    const focalChanged = lastFocusedNodeIdRef.current !== focalNodeId
    if (focalChanged) {
      pendingViewportRef.current = { type: 'focus', nodeId: focalNodeId }
    }
    lastFocusedNodeIdRef.current = focalNodeId
    computeLayout(level3.rfN, level3.rfE, NODE_W, NODE_H, layoutMode).then(positioned => {
      if (cancelled) return
      setRfNodes(positioned)
      setRfEdges(level3.rfE)
    })
    return () => { cancelled = true }
  }, [level, level3, focalNodeId, layoutMode])

  useEffect(() => {
    if (!reactFlowInstance || !rfNodes.length) return
    let frameId = null
    function fitPendingViewport() {
      const pending = pendingViewportRef.current
      if (!pending) return
      if (pending.type === 'focus' && !rfNodes.some(node => node.id === pending.nodeId)) return
      const measuredId = pending.type === 'focus' ? pending.nodeId : rfNodes[0]?.id
      const measuredNode = measuredId ? reactFlowInstance.getNode(measuredId) : null
      if (!measuredNode?.width || !measuredNode?.height) {
        frameId = requestAnimationFrame(fitPendingViewport)
        return
      }
      reactFlowInstance.fitView({
        duration: 0,
        padding: 0.2,
      })
      pendingViewportRef.current = null
    }
    frameId = requestAnimationFrame(fitPendingViewport)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [reactFlowInstance, rfNodes, rfEdges])

  const handleNodeDrag = useCallback((event, node) => {
    if (!node.parentNode) return
    setRfNodes(ns => fitGroupsToChildren(ns, false))
  }, [setRfNodes])

  const handleNodeDragStop = useCallback((event, node) => {
    if (!node.parentNode) return
    setRfNodes(ns => fitGroupsToChildren(ns, true))
  }, [setRfNodes])

  function handleToggleEdgeType(type) {
    setHiddenEdgeTypes(prev => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      saveHiddenEdgeTypes(next)
      return next
    })
  }

  if (!graphData && !error) return html`<div className="graph-section"><p className="label-sm" style=${{ padding: 24 }}>Loading graph...</p></div>`
  if (error) return html`<div className="graph-section"><p style=${{ color: 'var(--warn)', padding: 24 }}>Error loading graph: ${error}</p></div>`

  return html`
    <div className="graph-section">
      <${GraphBreadcrumb}
        level=${level}
        selectedComponent=${selectedComponent ?? (focalNodeId ? nodeById.get(focalNodeId)?.namespace ?? null : null)}
        focalNodeId=${focalNodeId}
        onNavigateToRoot=${navToRoot}
        onNavigateToComponent=${navToComponent}
      />
      <${GraphToolbar}
        edgeTypes=${availableEdgeTypes}
        visibleEdgeTypes=${visibleEdgeTypes}
        onToggleEdgeType=${handleToggleEdgeType}
        showMinimap=${showMinimap}
        onToggleMinimap=${() => setShowMinimap(v => !v)}
        onResetLayout=${() => { pendingViewportRef.current = { type: 'full' }; setLayoutKey(k => k + 1) }}
        level=${level}
        kindOptions=${kindOptions}
        kindFilter=${kindFilter}
        onKindFilter=${navToKind}
        depth=${depth}
        onDepth=${setDepth}
        allNodes=${graphData?.nodes ?? []}
        focalNodeId=${focalNodeId}
        onFocalNode=${navToFocus}
        layoutMode=${layoutMode}
        onLayoutMode=${mode => { saveLayoutMode(mode); setLayoutMode(mode) }}
        scope=${scope}
        onScope=${setScope}
        scopeOptions=${level === 'interior' ? level2?.scopeOptions : null}
        scopeInfo=${level === 'interior' ? level2?.scopeInfo : null}
      />
      <div className="graph-canvas-wrap">
        <${ReactFlowProvider}>
          <${ReactFlowCanvas}
            nodes=${rfNodes}
            edges=${rfEdges}
            onNodesChange=${onNodesChange}
            onEdgesChange=${onEdgesChange}
            onNodeDrag=${handleNodeDrag}
            onNodeDragStop=${handleNodeDragStop}
            onInit=${setReactFlowInstance}
            nodeTypes=${nodeTypes}
            fitView
            minZoom=${0.1}
            proOptions=${{ hideAttribution: true }}
          >
            <${Background} />
            ${showMinimap && html`<${MiniMap} />`}
          <//>
        <//>
      </div>
    </div>
  `
}
