/* Graph view: interactive three-level canvas using React Flow + Dagre. */

const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { navigate, Icon, TemplateBadge, StateTag, StabilityTag } = window.CorumPrimitives;
const { buildRoute, parseRoute } = window.CorumRouter;
const { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName } = window.CorumGraphUtils;

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

const NODE_W = 210;
const NODE_H = 88;
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

function buildRFNodesForNodes(graphNodes, templateMap, onNodeClick) {
  return graphNodes.map(n => {
    const tmpl = templateMap.get(n.template);
    const colour = tmpl?.ui?.colour ?? 'var(--ink-4)';
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
      <RF.Handle type="target" position={RF.Position.Left} style={{ opacity: 0 }} />
      <div className="graph-node-card-bar" style={{ background: colour }} />
      <div className="graph-node-card-header">
        <TemplateBadge name={data.templateLabel} colour={colour} />
        <StateTag state={data.state} />
      </div>
      <div className="graph-node-card-body">
        <div className="graph-node-card-name" title={data.nodeId}>{data.label}</div>
        <div className="graph-node-card-component">{data.component}</div>
      </div>
      <div className="graph-node-card-footer">
        <StabilityTag stability={data.stability} />
        <button
          className="graph-node-card-link"
          title="View node details"
          onClick={e => { e.stopPropagation(); navigate(`#/node?id=${encodeURIComponent(data.nodeId)}`); }}
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
          <div className="graph-depth-seg">
            {[['1', 1], ['2', 2], ['∞', Infinity]].map(([label, val]) => (
              <button
                key={label}
                className={`graph-depth-item${depth === val ? ' active' : ''}`}
                onClick={() => onDepth(val)}
              >
                {label}
              </button>
            ))}
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
  const [depth, setDepth] = useState(1);
  const [layoutKey, setLayoutKey] = useState(0);
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
    setError(null);
    const refParam = viewingRef ? `?ref=${encodeURIComponent(viewingRef)}` : '';
    fetch(`/api/graph${refParam}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setGraphData)
      .catch(err => setError(String(err)));
  }, [viewingRef]);

  const templateMap = useMemo(() => new Map((templates ?? []).map(t => [t.name, t])), [templates]);

  const templateColour = useCallback(templateName => {
    return templateMap.get(templateName)?.ui?.colour ?? 'var(--ink-4)';
  }, [templateMap]);

  // Level 1: component map
  const level1 = useMemo(() => {
    if (!graphData) return null;
    const { nodes: cmNodes, edges: cmEdges } = buildComponentMap(graphData.nodes, graphData.edges);
    const filteredEdges = applyEdgeTypeFilter(
      cmEdges.map(e => ({ ...e, type: e.types[0] ?? 'calls' })),
      visibleEdgeTypes
    );
    const rfN = cmNodes.map(n => ({
      id: n.id,
      type: 'componentCard',
      position: { x: 0, y: 0 },
      data: { label: n.component, count: n.count, onClick: () => navToComponent(n.component) },
    }));
    const rfE = filteredEdges.map(e => ({
      ...makeRFEdge({ ...e, type: e.type }, EDGE_STYLES),
      label: cmEdges.find(ce => ce.id === e.id)?.types.join(', ') ?? e.type,
    }));
    return { rfN: computeLayout(rfN, rfE, COMP_W, COMP_H), rfE };
  }, [graphData, visibleEdgeTypes, layoutKey, navToComponent]);

  useEffect(() => {
    if (level !== 'component' || !level1) return;
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
    const rfN = buildRFNodesForNodes(allVisibleNodes, templateMap, navToFocus);
    const rfE = buildRFEdgesForEdges(allVisibleEdges, visibleEdgeTypes).map(e => {
      const isCross = crossEdges.some(ce => ce.id === e.id);
      return isCross ? { ...e, style: { ...e.style, opacity: 0.45 }, labelStyle: { ...e.labelStyle, opacity: 0.45 } } : e;
    });
    return { rfN: computeLayout(rfN, rfE, NODE_W, NODE_H), rfE };
  }, [graphData, selectedComponent, visibleEdgeTypes, templateMap, layoutKey, navToFocus]);

  useEffect(() => {
    if (level !== 'interior' || !level2) return;
    setRfNodes(level2.rfN);
    setRfEdges(level2.rfE);
  }, [level, level2]);

  // Level 3: node focus
  const level3 = useMemo(() => {
    if (!graphData || !focalNodeId) return null;
    const { nodes: focusNodes, edges: focusEdges } = buildFocusGraph(
      focalNodeId, graphData.nodes, graphData.edges, depth
    );
    const rfN = buildRFNodesForNodes(focusNodes, templateMap, nodeId => {
      navigate(buildRoute({ pathname: '/graph', params: { focus: nodeId }, branch: viewingRef }));
    });
    const rfE = buildRFEdgesForEdges(focusEdges, visibleEdgeTypes);
    const layoutedN = computeLayout(rfN, rfE, NODE_W, NODE_H);
    return {
      rfN: layoutedN.map(n => n.id === focalNodeId
        ? { ...n, style: { outline: '2px solid var(--accent)', outlineOffset: '2px', borderRadius: 'var(--radius)' } }
        : n
      ),
      rfE,
    };
  }, [graphData, focalNodeId, depth, visibleEdgeTypes, templateMap, layoutKey, viewingRef]);

  useEffect(() => {
    if (level !== 'focus' || !level3) return;
    setRfNodes(level3.rfN);
    setRfEdges(level3.rfE);
  }, [level, level3]);

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
            nodeTypes={nodeTypes}
            fitView
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
