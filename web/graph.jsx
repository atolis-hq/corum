/* Graph view: interactive three-level canvas using React Flow + Dagre. */

const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { navigate, Icon, TemplateBadge, StateTag, StabilityTag } = window.CorumPrimitives;
const { buildRoute, parseRoute } = window.CorumRouter;
const { buildComponentMap, applyEdgeTypeFilter, getDisplayName } = window.CorumGraphUtils;

const RF = window.ReactFlow;
const ReactFlowCanvas = RF.ReactFlow || RF.default;
const { MiniMap, Background, useNodesState, useEdgesState, MarkerType, ReactFlowProvider } = RF;

const EDGE_STYLES = {
  'triggers':     { stroke: '#b45309', strokeWidth: 1.5 },
  'produces':     { stroke: '#0f766e', strokeWidth: 1.5 },
  'calls':        { stroke: '#6d28d9', strokeWidth: 1.5 },
  'implements':   { stroke: '#475569', strokeWidth: 1.5 },
  'reads':        { stroke: '#1d4ed8', strokeWidth: 1.5 },
  'maps-to':      { stroke: '#be185d', strokeWidth: 1.5 },
  'derived-from': { stroke: '#6b7280', strokeWidth: 1.5, strokeDasharray: '5,5' },
};

const EDGE_PILL_STYLES = {
  'triggers':     { background: '#fef3c7', color: '#b45309' },
  'produces':     { background: '#ccfbf1', color: '#0f766e' },
  'calls':        { background: '#ede9fe', color: '#6d28d9' },
  'implements':   { background: '#f1f5f9', color: '#475569' },
  'reads':        { background: '#dbeafe', color: '#1d4ed8' },
  'maps-to':      { background: '#fce7f3', color: '#be185d' },
  'derived-from': { background: '#f3f4f6', color: '#6b7280' },
};

const ALL_EDGE_TYPES = ['triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from'];
const DEPTH_STEPS = [1, 2, 3, 4, 5, Infinity];

const NODE_W = 210;
const NODE_H = 100;
const COMP_W = 180;
const COMP_H = 72;

function loadVisibleEdgeTypes() {
  try {
    const stored = localStorage.getItem('corum:graphEdgeTypes');
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set(ALL_EDGE_TYPES);
}

function saveVisibleEdgeTypes(types) {
  try { localStorage.setItem('corum:graphEdgeTypes', JSON.stringify([...types])); } catch {}
}

function computeLayout(rfNodes, rfEdges, nodeW, nodeH) {
  if (!rfNodes.length) return rfNodes;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80 });
  rfNodes.forEach(n => g.setNode(n.id, { width: nodeW, height: nodeH }));
  rfEdges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return rfNodes.map(n => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - nodeW / 2, y: pos.y - nodeH / 2 } };
  });
}

function makeRFEdge(edge, edgeStyles) {
  const style = edgeStyles[edge.type] || { stroke: '#a8acb5', strokeWidth: 1.5 };
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
  };
}

function buildRFNodesForNodes(graphNodes, templateMap, onNodeClick, viewingRef) {
  return graphNodes.map(n => {
    const tmpl = templateMap.get(n.template);
    const colour = tmpl?.ui?.colour ?? 'var(--ink-4)';
    const parentLabel = n.parentId ? getDisplayName(n.parentId) : null;
    return {
      id: n.id,
      type: 'nodeCard',
      position: { x: 0, y: 0 },
      data: {
        nodeId: n.id,
        label: getDisplayName(n.id),
        component: n.component,
        templateLabel: tmpl?.ui?.displayName ?? n.template,
        colour,
        state: n.state,
        stability: n.stability,
        onClick: () => onNodeClick(n.id),
        viewingRef,
        parentLabel,
      },
    };
  });
}

function buildRFEdgesForEdges(edges, visibleEdgeTypes) {
  return applyEdgeTypeFilter(edges, visibleEdgeTypes).map(e => makeRFEdge(e, EDGE_STYLES));
}

// Level 1: component card node
function ComponentCardNode({ data }) {
  return (
    <div className="graph-component-card" onClick={data.onClick}>
      <RF.Handle type="target" position={RF.Position.Left} style={{ opacity: 0 }} />
      <div className="graph-component-card-name">{data.label}</div>
      <div className="graph-component-card-count">{data.count} {data.count === 1 ? 'node' : 'nodes'}</div>
      <RF.Handle type="source" position={RF.Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

// Level 2/3: node card node
function NodeCardNode({ data }) {
  const colour = data.colour ?? 'var(--ink-4)';
  return (
    <div className="graph-node-card" onClick={data.onClick}>
      {data.parentLabel && (
        <div className="graph-node-card-owner">{data.parentLabel}</div>
      )}
      <RF.Handle type="target" position={RF.Position.Left} style={{ opacity: 0 }} />
      <div className="graph-node-card-bar" style={{ background: colour }} />
      <div className="graph-node-card-body">
        <div className="graph-node-card-text">
          <div className="graph-node-card-name" title={data.nodeId}>{data.label}</div>
          <div className="graph-node-card-component">{data.component}</div>
        </div>
        <div className="graph-node-card-type">
          <TemplateBadge name={data.templateLabel} colour={colour} />
        </div>
      </div>
      <div className="graph-node-card-footer">
        <StabilityTag stability={data.stability} />
        <StateTag state={data.state} />
        <button
          className="graph-node-card-link"
          title="View node details"
          onClick={e => { e.stopPropagation(); navigate(buildRoute({ pathname: '/node', params: { id: data.nodeId }, branch: data.viewingRef })); }}
        >
          <Icon name="arrow-up-right-from-square" size={11} />
        </button>
      </div>
      <RF.Handle type="source" position={RF.Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { componentCard: ComponentCardNode, nodeCard: NodeCardNode };

function GraphBreadcrumb({ level, selectedComponent, focalNodeId, onNavigateToRoot, onNavigateToComponent }) {
  return (
    <div className="graph-breadcrumb">
      <button className="graph-breadcrumb-item" onClick={onNavigateToRoot}>Graph</button>
      {(level === 'interior' || level === 'focus') && selectedComponent && (
        <>
          <span className="graph-breadcrumb-sep">/</span>
          {level === 'interior'
            ? <span className="graph-breadcrumb-current">{selectedComponent}</span>
            : <button className="graph-breadcrumb-item" onClick={() => onNavigateToComponent(selectedComponent)}>{selectedComponent}</button>
          }
        </>
      )}
      {level === 'focus' && focalNodeId && (
        <>
          <span className="graph-breadcrumb-sep">/</span>
          <span className="graph-breadcrumb-current">{getDisplayName(focalNodeId)}</span>
        </>
      )}
    </div>
  );
}

function GraphToolbar({ visibleEdgeTypes, onToggleEdgeType, showMinimap, onToggleMinimap, onResetLayout, level, depth, onDepth, allNodes, focalNodeId, onFocalNode }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allNodes
      .filter(n => n.id.toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchQuery, allNodes]);

  useEffect(() => {
    if (!searchOpen) return;
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [searchOpen]);

  return (
    <div className="graph-toolbar">
      {ALL_EDGE_TYPES.map(type => {
        const active = visibleEdgeTypes.has(type);
        const pill = EDGE_PILL_STYLES[type] || {};
        return (
          <span
            key={type}
            className={`graph-edge-pill${active ? '' : ' inactive'}`}
            style={active ? pill : {}}
            onClick={() => onToggleEdgeType(type)}
          >
            {type}
          </span>
        );
      })}
      <div className="graph-toolbar-sep" />
      {level === 'focus' && (
        <>
          <div className="graph-depth-ctrl">
            <button
              className="graph-depth-btn"
              onClick={() => onDepth(DEPTH_STEPS[DEPTH_STEPS.indexOf(depth) - 1])}
              disabled={depth === DEPTH_STEPS[0]}
            >−</button>
            <span className="graph-depth-val">{depth === Infinity ? '∞' : depth}</span>
            <button
              className="graph-depth-btn"
              onClick={() => onDepth(DEPTH_STEPS[DEPTH_STEPS.indexOf(depth) + 1])}
              disabled={depth === DEPTH_STEPS[DEPTH_STEPS.length - 1]}
            >+</button>
          </div>
          <div className="graph-focus-search" ref={searchRef}>
            <input
              className="graph-focus-search-input"
              placeholder="Focus node..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="graph-focus-search-dropdown">
                {searchResults.map(n => (
                  <div
                    key={n.id}
                    className={`graph-focus-search-item${n.id === focalNodeId ? ' selected' : ''}`}
                    onClick={() => { onFocalNode(n.id); setSearchQuery(''); setSearchOpen(false); }}
                  >
                    <span style={{ fontWeight: 500 }}>{getDisplayName(n.id)}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 10, marginLeft: 4 }}>{n.component}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="graph-toolbar-sep" />
        </>
      )}
      <button className="graph-toolbar-btn" onClick={onResetLayout}>Reset layout</button>
      <button className={`graph-toolbar-btn${showMinimap ? ' active' : ''}`} onClick={onToggleMinimap}>Minimap</button>
    </div>
  );
}

function GraphView({ route, viewingRef, templates }) {
  const [graphData, setGraphData] = useState(null);
  const [error, setError] = useState(null);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState(loadVisibleEdgeTypes);
  const [showMinimap, setShowMinimap] = useState(false);
  const [depth, setDepth] = useState(2);
  const [layoutKey, setLayoutKey] = useState(0);
  const [focusData, setFocusData] = useState(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const pendingViewportRef = useRef(null);
  const lastFocusedNodeIdRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // Derive level and selection from URL
  const selectedComponent = route.params.get('component') ?? null;
  const focalNodeId = route.params.get('focus') ?? null;
  const level = focalNodeId ? 'focus' : selectedComponent ? 'interior' : 'component';

  const navToRoot = useCallback(() => {
    navigate(buildRoute({ pathname: '/graph', params: {}, branch: viewingRef }));
  }, [viewingRef]);

  const navToComponent = useCallback(component => {
    navigate(buildRoute({ pathname: '/graph', params: { component }, branch: viewingRef }));
  }, [viewingRef]);

  const navToFocus = useCallback(nodeId => {
    const params = { focus: nodeId };
    if (selectedComponent) params.component = selectedComponent;
    navigate(buildRoute({ pathname: '/graph', params, branch: viewingRef }));
  }, [viewingRef, selectedComponent]);

  useEffect(() => {
    setGraphData(null);
    setFocusData(null);
    setError(null);
    const refParam = viewingRef ? `?ref=${encodeURIComponent(viewingRef)}` : '';
    fetch(`/api/graph${refParam}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setGraphData)
      .catch(err => setError(String(err)));
  }, [viewingRef]);

  useEffect(() => {
    if (!focalNodeId) { setFocusData(null); return; }
    setFocusData(null);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const params = new URLSearchParams([
        ['node_ids', focalNodeId],
        ['depth', depth === Infinity ? '999' : String(depth)],
        ['direction', 'both'],
        ['reads_outbound_only', 'false'],
      ]);
      if (viewingRef) params.append('ref', viewingRef);
      fetch(`/api/lineage?${params}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => { setFocusData(data); })
        .catch(err => setError(String(err)));
    }, 150);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [focalNodeId, depth, viewingRef]);

  const templateMap = useMemo(() => new Map((templates ?? []).map(t => [t.name, t])), [templates]);

  const templateColour = useCallback(templateName => {
    return templateMap.get(templateName)?.ui?.colour ?? 'var(--ink-4)';
  }, [templateMap]);

  // Level 1: component map
  const level1 = useMemo(() => {
    if (!graphData) return null;
    const { nodes: cmNodes, edges: cmEdges } = buildComponentMap(graphData.nodes, graphData.edges);
    const filteredCmEdges = cmEdges.filter(e => e.types.some(t => visibleEdgeTypes.has(t)));
    const rfN = cmNodes.map(n => ({
      id: n.id,
      type: 'componentCard',
      position: { x: 0, y: 0 },
      data: { label: n.component, count: n.count, onClick: () => navToComponent(n.component) },
    }));
    const rfE = filteredCmEdges.map(e => {
      const repType = e.types.find(t => visibleEdgeTypes.has(t)) ?? e.types[0];
      return {
        ...makeRFEdge({ ...e, type: repType }, EDGE_STYLES),
        label: e.types.join(', '),
      };
    });
    return { rfN: computeLayout(rfN, rfE, COMP_W, COMP_H), rfE };
  }, [graphData, visibleEdgeTypes, layoutKey, navToComponent]);

  useEffect(() => {
    if (level !== 'component' || !level1) return;
    pendingViewportRef.current = { type: 'full' };
    setRfNodes(level1.rfN);
    setRfEdges(level1.rfE);
  }, [level, level1]);

  // Level 2: component interior
  const level2 = useMemo(() => {
    if (!graphData || !selectedComponent) return null;
    const compNodes = graphData.nodes.filter(n => n.component === selectedComponent);
    const compNodeIds = new Set(compNodes.map(n => n.id));
    const internalEdges = graphData.edges.filter(e => compNodeIds.has(e.from) && compNodeIds.has(e.to));
    const crossEdges = graphData.edges.filter(e =>
      (compNodeIds.has(e.from) && !compNodeIds.has(e.to)) ||
      (!compNodeIds.has(e.from) && compNodeIds.has(e.to))
    );
    const externalNodeIds = new Set([
      ...crossEdges.map(e => e.from).filter(id => !compNodeIds.has(id)),
      ...crossEdges.map(e => e.to).filter(id => !compNodeIds.has(id)),
    ]);
    const externalNodes = graphData.nodes.filter(n => externalNodeIds.has(n.id));
    const allVisibleNodes = [...compNodes, ...externalNodes];
    const allVisibleEdges = [...internalEdges, ...crossEdges];
    const rfN = buildRFNodesForNodes(allVisibleNodes, templateMap, navToFocus, viewingRef);
    const rfE = buildRFEdgesForEdges(allVisibleEdges, visibleEdgeTypes).map(e => {
      const isCross = crossEdges.some(ce => ce.id === e.id);
      return isCross ? { ...e, style: { ...e.style, opacity: 0.45 }, labelStyle: { ...e.labelStyle, opacity: 0.45 } } : e;
    });
    return { rfN: computeLayout(rfN, rfE, NODE_W, NODE_H), rfE };
  }, [graphData, selectedComponent, visibleEdgeTypes, templateMap, layoutKey, navToFocus]);

  useEffect(() => {
    if (level !== 'interior' || !level2) return;
    pendingViewportRef.current = { type: 'full' };
    setRfNodes(level2.rfN);
    setRfEdges(level2.rfE);
  }, [level, level2]);

  useEffect(() => {
    if (level === 'focus') return;
    lastFocusedNodeIdRef.current = null;
  }, [level]);

  // Level 3: node focus
  const nodeById = useMemo(
    () => new Map((graphData?.nodes ?? []).map(n => [n.id, n])),
    [graphData],
  );

  const level3 = useMemo(() => {
    if (!focusData || !focalNodeId) return null;
    const parentIdMap = new Map((graphData?.nodes ?? []).map(n => [n.id, n.parentId]));
    const focalNode = nodeById.get(focalNodeId);
    const lineageNodes = [
      ...(focalNode && !focusData.nodes.some(n => n.id === focalNodeId) ? [focalNode] : []),
      ...focusData.nodes,
    ].map(n => ({ ...n, parentId: parentIdMap.get(n.id) ?? null }));
    const rfN = buildRFNodesForNodes(lineageNodes, templateMap, nodeId => {
      navigate(buildRoute({ pathname: '/graph', params: { focus: nodeId }, branch: viewingRef }));
    }, viewingRef);
    const rfE = buildRFEdgesForEdges(applyEdgeTypeFilter(focusData.edges, visibleEdgeTypes), visibleEdgeTypes);
    const layoutedN = computeLayout(rfN, rfE, NODE_W, NODE_H);
    return {
      rfN: layoutedN.map(n => n.id === focalNodeId
        ? { ...n, style: { outline: '2px solid var(--accent)', outlineOffset: '2px', borderRadius: 'var(--radius)' } }
        : n
      ),
      rfE,
    };
  }, [focusData, focalNodeId, visibleEdgeTypes, templateMap, layoutKey, viewingRef, graphData, nodeById]);

  useEffect(() => {
    if (level !== 'focus' || !level3) return;
    const focalChanged = lastFocusedNodeIdRef.current !== focalNodeId;
    if (focalChanged) {
      pendingViewportRef.current = { type: 'focus', nodeId: focalNodeId };
    }
    lastFocusedNodeIdRef.current = focalNodeId;
    setRfNodes(level3.rfN);
    setRfEdges(level3.rfE);
  }, [level, level3, focalNodeId]);

  useEffect(() => {
    if (!reactFlowInstance || !rfNodes.length) return;
    let frameId = null;
    function fitPendingViewport() {
      const pending = pendingViewportRef.current;
      if (!pending) return;
      if (pending.type === 'focus' && !rfNodes.some(node => node.id === pending.nodeId)) return;
      if (pending.type === 'focus') {
        const measuredNode = reactFlowInstance.getNode(pending.nodeId);
        if (!measuredNode?.width || !measuredNode?.height) {
          frameId = requestAnimationFrame(fitPendingViewport);
          return;
        }
        reactFlowInstance.fitView({
          duration: 0,
          padding: 0.2,
        });
      } else {
        reactFlowInstance.fitView({
          duration: 0,
          padding: 0.2,
        });
      }
      pendingViewportRef.current = null;
    }
    frameId = requestAnimationFrame(fitPendingViewport);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [reactFlowInstance, rfNodes, rfEdges]);

  function handleToggleEdgeType(type) {
    setVisibleEdgeTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      saveVisibleEdgeTypes(next);
      return next;
    });
  }

  if (!graphData && !error) return <div className="graph-section"><p className="label-sm" style={{ padding: 24 }}>Loading graph...</p></div>;
  if (error) return <div className="graph-section"><p style={{ color: 'var(--warn)', padding: 24 }}>Error loading graph: {error}</p></div>;

  return (
    <div className="graph-section">
      <GraphBreadcrumb
        level={level}
        selectedComponent={selectedComponent}
        focalNodeId={focalNodeId}
        onNavigateToRoot={navToRoot}
        onNavigateToComponent={navToComponent}
      />
      <GraphToolbar
        visibleEdgeTypes={visibleEdgeTypes}
        onToggleEdgeType={handleToggleEdgeType}
        showMinimap={showMinimap}
        onToggleMinimap={() => setShowMinimap(v => !v)}
        onResetLayout={() => setLayoutKey(k => k + 1)}
        level={level}
        depth={depth}
        onDepth={setDepth}
        allNodes={graphData?.nodes ?? []}
        focalNodeId={focalNodeId}
        onFocalNode={navToFocus}
      />
      <div className="graph-canvas-wrap">
        <ReactFlowProvider>
          <ReactFlowCanvas
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            {showMinimap && <MiniMap />}
          </ReactFlowCanvas>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

window.CorumGraph = { GraphView };
