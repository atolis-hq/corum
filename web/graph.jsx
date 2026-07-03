/* Graph view: interactive three-level canvas using React Flow + ELK.js. */

const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { navigate, Icon, TemplateBadge, StateTag, StabilityTag } = window.CorumPrimitives;
const { buildRoute, parseRoute } = window.CorumRouter;
const { buildComponentMap, applyEdgeTypeFilter, getDisplayName, computeConnectedComponents, filterThreadScope, filterOwnerScope } = window.CorumGraphUtils;

const RF = window.ReactFlow;
const ReactFlowCanvas = RF.ReactFlow || RF.default;
const { MiniMap, Background, useNodesState, useEdgesState, MarkerType, ReactFlowProvider } = RF;

const EDGE_STYLES = {
  'triggers':     { stroke: '#b45309', strokeWidth: 1.5 },
  'produces':     { stroke: '#0f766e', strokeWidth: 1.5 },
  'calls':        { stroke: '#6d28d9', strokeWidth: 1.5 },
  'implements':   { stroke: '#475569', strokeWidth: 1.5 },
  'reads':        { stroke: '#1d4ed8', strokeWidth: 1.5 },
  'uses-type':    { stroke: '#0891b2', strokeWidth: 1.5 },
  'maps-to':      { stroke: '#be185d', strokeWidth: 1.5 },
  'derived-from': { stroke: '#6b7280', strokeWidth: 1.5, strokeDasharray: '5,5' },
};

const EDGE_PILL_STYLES = {
  'triggers':     { background: '#fef3c7', color: '#b45309' },
  'produces':     { background: '#ccfbf1', color: '#0f766e' },
  'calls':        { background: '#ede9fe', color: '#6d28d9' },
  'implements':   { background: '#f1f5f9', color: '#475569' },
  'reads':        { background: '#dbeafe', color: '#1d4ed8' },
  'uses-type':    { background: '#cffafe', color: '#0891b2' },
  'maps-to':      { background: '#fce7f3', color: '#be185d' },
  'derived-from': { background: '#f3f4f6', color: '#6b7280' },
};

const ALL_EDGE_TYPES = ['triggers', 'produces', 'reads', 'uses-type', 'calls', 'implements', 'maps-to', 'derived-from'];
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

function loadLayoutMode() {
  try {
    const stored = localStorage.getItem('corum:graphLayoutMode');
    if (stored === 'flat' || stored === 'grouped') return stored;
  } catch {}
  return 'flat';
}

function saveLayoutMode(mode) {
  try { localStorage.setItem('corum:graphLayoutMode', mode); } catch {}
}

const elk = new ELK();

const ELK_BASE_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '40',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  // Disconnected sub-graphs are separated and stacked by computeLayout, not ELK.
  'elk.separateConnectedComponents': 'false',
};

const STACK_GAP = 100;
const FRAGMENT_GAP = 40;

// Flat ELK layout: every node is a direct child of the root.
async function computeFlatLayout(rfNodes, rfEdges, nodeW, nodeH) {
  if (!rfNodes.length) return rfNodes;
  const nodeIds = new Set(rfNodes.map(n => n.id));
  const elkGraph = {
    id: 'root',
    layoutOptions: ELK_BASE_OPTIONS,
    children: rfNodes.map(n => ({ id: n.id, width: nodeW, height: nodeH })),
    edges: rfEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const result = await elk.layout(elkGraph);
  const posById = new Map(result.children.map(c => [c.id, c]));
  return rfNodes.map(n => {
    const pos = posById.get(n.id);
    return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n;
  });
}

// Grouped ELK layout: nodes sharing a parentId (2+ visible siblings) are
// clustered into a compound "group:<parentId>" container node.
async function computeGroupedLayout(rfNodes, rfEdges, nodeW, nodeH) {
  if (!rfNodes.length) return rfNodes;

  const parentCounts = new Map();
  for (const n of rfNodes) {
    const pid = n.data?.parentId;
    if (!pid) continue;
    parentCounts.set(pid, (parentCounts.get(pid) ?? 0) + 1);
  }
  const groupParentIds = new Set([...parentCounts.entries()].filter(([, c]) => c >= 2).map(([pid]) => pid));

  if (!groupParentIds.size) return computeFlatLayout(rfNodes, rfEdges, nodeW, nodeH);

  const nodeIds = new Set(rfNodes.map(n => n.id));
  const groupChildrenMap = new Map([...groupParentIds].map(pid => [pid, []]));
  const rootChildren = [];

  for (const n of rfNodes) {
    const pid = n.data?.parentId;
    if (pid && groupParentIds.has(pid)) {
      groupChildrenMap.get(pid).push({ id: n.id, width: nodeW, height: nodeH });
    } else {
      rootChildren.push({ id: n.id, width: nodeW, height: nodeH });
    }
  }

  for (const pid of groupParentIds) {
    rootChildren.push({
      id: 'group:' + pid,
      layoutOptions: { 'elk.padding': '[top=36,left=16,bottom=16,right=16]' },
      children: groupChildrenMap.get(pid),
    });
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: { ...ELK_BASE_OPTIONS, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' },
    children: rootChildren,
    edges: rfEdges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const result = await elk.layout(elkGraph);

  const groupNodeIds = new Set([...groupParentIds].map(pid => 'group:' + pid));
  const groupBoxes = new Map();
  const nodePositions = new Map();

  for (const child of result.children) {
    if (groupNodeIds.has(child.id)) {
      groupBoxes.set(child.id, { x: child.x, y: child.y, width: child.width, height: child.height });
      for (const gc of child.children ?? []) {
        nodePositions.set(gc.id, { x: gc.x, y: gc.y });
      }
    } else {
      nodePositions.set(child.id, { x: child.x, y: child.y });
    }
  }

  const groupNodes = [...groupBoxes.entries()].map(([gid, box]) => ({
    id: gid,
    type: 'groupCard',
    position: { x: box.x, y: box.y },
    style: { width: box.width, height: box.height },
    data: { label: getDisplayName(gid.slice('group:'.length)) },
  }));

  const memberNodes = rfNodes.map(n => {
    const pos = nodePositions.get(n.id) ?? { x: 0, y: 0 };
    const pid = n.data?.parentId;
    if (pid && groupParentIds.has(pid)) {
      // The group box already shows the owner; drop the per-card owner chip.
      // No extent constraint: members drag freely and the box refits around them.
      return { ...n, position: pos, parentNode: 'group:' + pid, data: { ...n.data, parentLabel: null } };
    }
    return { ...n, position: pos };
  });

  // Parent/group nodes must precede their children in the React Flow nodes array.
  return [...groupNodes, ...memberNodes];
}

const GROUP_PAD = { top: 36, right: 16, bottom: 16, left: 16 };

// Fit each group box around its children. With shiftOrigin the box origin
// moves and children are re-based (full normalise, safe after a drag ends);
// without it the box only grows right/down, which avoids fighting React
// Flow's pointer tracking mid-drag.
function fitGroupsToChildren(nodes, shiftOrigin) {
  const fits = new Map();
  for (const g of nodes) {
    if (g.type !== 'groupCard') continue;
    const children = nodes.filter(n => n.parentNode === g.id);
    if (!children.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of children) {
      minX = Math.min(minX, c.position.x);
      minY = Math.min(minY, c.position.y);
      maxX = Math.max(maxX, c.position.x + (c.width ?? NODE_W));
      maxY = Math.max(maxY, c.position.y + (c.height ?? NODE_H));
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
        });
  }
  if (!fits.size) return nodes;
  return nodes.map(n => {
    if (n.type === 'groupCard' && fits.has(n.id)) {
      const f = fits.get(n.id);
      return { ...n, position: { x: n.position.x + f.dx, y: n.position.y + f.dy }, style: { ...n.style, width: f.width, height: f.height } };
    }
    if (n.parentNode && fits.has(n.parentNode)) {
      const f = fits.get(n.parentNode);
      if (!f.dx && !f.dy) return n;
      return { ...n, position: { x: n.position.x - f.dx, y: n.position.y - f.dy } };
    }
    return n;
  });
}

// Lay out each connected component independently, then stack them as
// left-aligned rows so every flow reads left-to-right from a common edge.
// Small fragments (pairs/singletons) are packed into a compact grid below.
async function computeLayout(rfNodes, rfEdges, nodeW, nodeH, mode) {
  if (!rfNodes.length) return rfNodes;

  // In grouped mode, group co-membership must not split across components.
  const extraLinks = [];
  if (mode === 'grouped') {
    const byParent = new Map();
    for (const n of rfNodes) {
      const pid = n.data?.parentId;
      if (!pid) continue;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(n.id);
    }
    for (const ids of byParent.values()) {
      for (let i = 1; i < ids.length; i++) extraLinks.push({ from: ids[0], to: ids[i] });
    }
  }

  const links = rfEdges.map(e => ({ from: e.source, to: e.target }));
  const components = computeConnectedComponents(rfNodes, links, extraLinks)
    .sort((a, b) => b.length - a.length);
  const flows = components.filter(c => c.length >= 3);
  const fragments = components.filter(c => c.length < 3);
  const nodeById = new Map(rfNodes.map(n => [n.id, n]));

  const layouts = await Promise.all(flows.map(ids => {
    const idSet = new Set(ids);
    const subNodes = ids.map(id => nodeById.get(id));
    const subEdges = rfEdges.filter(e => idSet.has(e.source) && idSet.has(e.target));
    return mode === 'grouped'
      ? computeGroupedLayout(subNodes, subEdges, nodeW, nodeH)
      : computeFlatLayout(subNodes, subEdges, nodeW, nodeH);
  }));

  const out = [];
  let offsetY = 0;
  let maxWidth = 0;
  for (const layoutNodes of layouts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of layoutNodes) {
      if (n.parentNode) continue; // group members are positioned relative to their group
      const w = n.style?.width ?? nodeW;
      const h = n.style?.height ?? nodeH;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }
    for (const n of layoutNodes) {
      out.push(n.parentNode ? n : { ...n, position: { x: n.position.x - minX, y: n.position.y - minY + offsetY } });
    }
    offsetY += (maxY - minY) + STACK_GAP;
    maxWidth = Math.max(maxWidth, maxX - minX);
  }

  const wrapWidth = Math.max(maxWidth, 1600);
  let gx = 0, gy = offsetY;
  for (const ids of fragments) {
    const idSet = new Set(ids);
    const subEdges = rfEdges.filter(e => idSet.has(e.source) && idSet.has(e.target));
    // Order pairs source-first so the arrow reads left-to-right.
    const ordered = ids.length === 2 && subEdges.length ? [subEdges[0].source, subEdges[0].target] : ids;
    const fragW = ordered.length * nodeW + (ordered.length - 1) * FRAGMENT_GAP;
    if (gx > 0 && gx + fragW > wrapWidth) { gx = 0; gy += nodeH + FRAGMENT_GAP; }
    ordered.forEach((id, i) => {
      out.push({ ...nodeById.get(id), position: { x: gx + i * (nodeW + FRAGMENT_GAP), y: gy } });
    });
    gx += fragW + FRAGMENT_GAP * 2;
  }

  return out;
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

function buildRFNodesForNodes(graphNodes, templateMap, onNodeClick, viewingRef, fadedIds) {
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
        parentId: n.parentId ?? null,
        faded: fadedIds?.has(n.id) ?? false,
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
    <div className={`graph-node-card${data.faded ? ' faded' : ''}${data.focal ? ' focal' : ''}`} onClick={data.onClick}>
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

// Grouped-mode compound container: label only, member nodes render as children.
function GroupCardNode({ data }) {
  return (
    <div className="graph-group-card">
      <div className="graph-group-card-label">{data.label}</div>
    </div>
  );
}

const nodeTypes = { componentCard: ComponentCardNode, nodeCard: NodeCardNode, groupCard: GroupCardNode };

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

function ScopePopover({ scope, onScope, scopeOptions, onClose }) {
  const [edgeType, setEdgeType] = useState(scope?.edgeType ?? '');
  const [fromTemplate, setFromTemplate] = useState(scope?.fromTemplate ?? '');
  const [toTemplate, setToTemplate] = useState(scope?.toTemplate ?? '');
  const [owner, setOwner] = useState(scope?.owner ?? '');

  function apply() {
    if (!edgeType && !owner) { onScope(null); onClose(); return; }
    onScope({
      edgeType: edgeType || null,
      fromTemplate: edgeType ? (fromTemplate || null) : null,
      toTemplate: edgeType ? (toTemplate || null) : null,
      owner: owner || null,
    });
    onClose();
  }

  return (
    <div className="graph-scope-popover">
      <div className="graph-scope-row">
        <label className="graph-scope-label">Interaction</label>
        <select className="graph-scope-select" value={edgeType} onChange={e => setEdgeType(e.target.value)}>
          <option value="">any</option>
          {scopeOptions.edgeTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="graph-scope-row">
        <label className="graph-scope-label">From</label>
        <select className="graph-scope-select" value={fromTemplate} onChange={e => setFromTemplate(e.target.value)} disabled={!edgeType}>
          <option value="">any template</option>
          {scopeOptions.templates.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}
        </select>
      </div>
      <div className="graph-scope-row">
        <label className="graph-scope-label">To</label>
        <select className="graph-scope-select" value={toTemplate} onChange={e => setToTemplate(e.target.value)} disabled={!edgeType}>
          <option value="">any template</option>
          {scopeOptions.templates.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}
        </select>
      </div>
      <div className="graph-scope-row">
        <label className="graph-scope-label">Owner</label>
        <select className="graph-scope-select" value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">any</option>
          {scopeOptions.owners.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div className="graph-scope-actions">
        <button className="graph-toolbar-btn" onClick={() => { onScope(null); onClose(); }}>Clear</button>
        <button className="graph-toolbar-btn active" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}

function describeScope(scope, scopeOptions) {
  const parts = [];
  if (scope.edgeType) {
    const from = scope.fromTemplate
      ? (scopeOptions.templates.find(t => t.name === scope.fromTemplate)?.label ?? scope.fromTemplate)
      : 'any';
    const to = scope.toTemplate
      ? (scopeOptions.templates.find(t => t.name === scope.toTemplate)?.label ?? scope.toTemplate)
      : 'any';
    parts.push(`${scope.edgeType} · ${from} → ${to}`);
  }
  if (scope.owner) parts.push(getDisplayName(scope.owner));
  return parts.join(' · ');
}

function GraphToolbar({ visibleEdgeTypes, onToggleEdgeType, showMinimap, onToggleMinimap, onResetLayout, level, depth, onDepth, allNodes, focalNodeId, onFocalNode, layoutMode, onLayoutMode, scope, onScope, scopeOptions, scopeInfo }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const searchRef = useRef(null);
  const scopeRef = useRef(null);

  useEffect(() => {
    if (!scopeOpen) return;
    function handleClick(e) {
      if (scopeRef.current && !scopeRef.current.contains(e.target)) setScopeOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [scopeOpen]);

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
      {level === 'interior' && scopeOptions && (
        <>
          <div className="graph-scope" ref={scopeRef}>
            <button
              className={`graph-toolbar-btn${scope ? ' active' : ''}`}
              onClick={() => setScopeOpen(v => !v)}
            >Scope</button>
            {scopeOpen && (
              <ScopePopover
                key={scope ? describeScope(scope, scopeOptions) : 'empty'}
                scope={scope}
                onScope={onScope}
                scopeOptions={scopeOptions}
                onClose={() => setScopeOpen(false)}
              />
            )}
          </div>
          {scope && (
            <span className="graph-scope-pill">
              {describeScope(scope, scopeOptions)}
              <span className="graph-scope-pill-clear" onClick={() => onScope(null)}>×</span>
            </span>
          )}
          {scope && scopeInfo && (
            <span className="graph-scope-count">{scopeInfo.matchCount} of {scopeInfo.threadCount} threads</span>
          )}
        </>
      )}
      {level !== 'component' && (
        <div className="graph-layout-toggle">
          <button
            className={`graph-toolbar-btn${layoutMode === 'flat' ? ' active' : ''}`}
            onClick={() => onLayoutMode('flat')}
          >Flat</button>
          <button
            className={`graph-toolbar-btn${layoutMode === 'grouped' ? ' active' : ''}`}
            onClick={() => onLayoutMode('grouped')}
          >Grouped</button>
        </div>
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
  const [layoutMode, setLayoutMode] = useState(loadLayoutMode);
  const [scope, setScope] = useState(null);
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

  useEffect(() => { setScope(null); }, [selectedComponent]);

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
    return { rfN, rfE };
  }, [graphData, visibleEdgeTypes, layoutKey, navToComponent]);

  useEffect(() => {
    if (level !== 'component' || !level1) return;
    let cancelled = false;
    pendingViewportRef.current = { type: 'full' };
    computeLayout(level1.rfN, level1.rfE, COMP_W, COMP_H, layoutMode).then(positioned => {
      if (cancelled) return;
      setRfNodes(positioned);
      setRfEdges(level1.rfE);
    });
    return () => { cancelled = true; };
  }, [level, level1, layoutMode]);

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

    // Options for the scope popover reflect the unscoped view.
    const typedEdges = applyEdgeTypeFilter(allVisibleEdges, visibleEdgeTypes);
    const parentCounts = new Map();
    for (const n of allVisibleNodes) {
      if (!n.parentId) continue;
      parentCounts.set(n.parentId, (parentCounts.get(n.parentId) ?? 0) + 1);
    }
    const scopeOptions = {
      edgeTypes: ALL_EDGE_TYPES.filter(t => visibleEdgeTypes.has(t) && typedEdges.some(e => e.type === t)),
      templates: [...new Set(allVisibleNodes.map(n => n.template))].sort()
        .map(name => ({ name, label: templateMap.get(name)?.ui?.displayName ?? name })),
      owners: [...parentCounts.entries()].filter(([, c]) => c >= 2).map(([pid]) => pid).sort()
        .map(pid => ({ id: pid, label: getDisplayName(pid) })),
    };

    // Apply the active scope: threads containing an interaction, then owner.
    let visibleNodes = allVisibleNodes;
    let visibleEdges = allVisibleEdges;
    let scopeInfo = null;
    if (scope) {
      let keep = null;
      if (scope.edgeType) {
        const result = filterThreadScope(visibleNodes, typedEdges, scope);
        keep = result.nodeIds;
        scopeInfo = { matchCount: result.matchCount, threadCount: result.threadCount };
      }
      if (scope.owner) {
        const baseNodes = keep ? visibleNodes.filter(n => keep.has(n.id)) : visibleNodes;
        const baseEdges = typedEdges.filter(e => !keep || (keep.has(e.from) && keep.has(e.to)));
        keep = filterOwnerScope(baseNodes, baseEdges, scope.owner);
      }
      if (keep) {
        const keepIds = keep;
        visibleNodes = visibleNodes.filter(n => keepIds.has(n.id));
        visibleEdges = visibleEdges.filter(e => keepIds.has(e.from) && keepIds.has(e.to));
      }
    }

    const rfN = buildRFNodesForNodes(visibleNodes, templateMap, navToFocus, viewingRef, externalNodeIds);
    const rfE = buildRFEdgesForEdges(visibleEdges, visibleEdgeTypes).map(e => {
      const isCross = crossEdges.some(ce => ce.id === e.id);
      return isCross ? { ...e, style: { ...e.style, opacity: 0.45 }, labelStyle: { ...e.labelStyle, opacity: 0.45 } } : e;
    });
    return { rfN, rfE, scopeOptions, scopeInfo };
  }, [graphData, selectedComponent, visibleEdgeTypes, templateMap, layoutKey, navToFocus, scope]);

  useEffect(() => {
    if (level !== 'interior' || !level2) return;
    let cancelled = false;
    pendingViewportRef.current = { type: 'full' };
    computeLayout(level2.rfN, level2.rfE, NODE_W, NODE_H, layoutMode).then(positioned => {
      if (cancelled) return;
      setRfNodes(positioned);
      setRfEdges(level2.rfE);
    });
    return () => { cancelled = true; };
  }, [level, level2, layoutMode]);

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
    const rfN = buildRFNodesForNodes(lineageNodes, templateMap, navToFocus, viewingRef)
      .map(n => n.id === focalNodeId ? { ...n, data: { ...n.data, focal: true } } : n);
    const rfE = buildRFEdgesForEdges(applyEdgeTypeFilter(focusData.edges, visibleEdgeTypes), visibleEdgeTypes);
    return { rfN, rfE };
  }, [focusData, focalNodeId, visibleEdgeTypes, templateMap, layoutKey, viewingRef, graphData, nodeById, navToFocus]);

  useEffect(() => {
    if (level !== 'focus' || !level3) return;
    let cancelled = false;
    const focalChanged = lastFocusedNodeIdRef.current !== focalNodeId;
    if (focalChanged) {
      pendingViewportRef.current = { type: 'focus', nodeId: focalNodeId };
    }
    lastFocusedNodeIdRef.current = focalNodeId;
    computeLayout(level3.rfN, level3.rfE, NODE_W, NODE_H, layoutMode).then(positioned => {
      if (cancelled) return;
      setRfNodes(positioned);
      setRfEdges(level3.rfE);
    });
    return () => { cancelled = true; };
  }, [level, level3, focalNodeId, layoutMode]);

  useEffect(() => {
    if (!reactFlowInstance || !rfNodes.length) return;
    let frameId = null;
    function fitPendingViewport() {
      const pending = pendingViewportRef.current;
      if (!pending) return;
      if (pending.type === 'focus' && !rfNodes.some(node => node.id === pending.nodeId)) return;
      const measuredId = pending.type === 'focus' ? pending.nodeId : rfNodes[0]?.id;
      const measuredNode = measuredId ? reactFlowInstance.getNode(measuredId) : null;
      if (!measuredNode?.width || !measuredNode?.height) {
        frameId = requestAnimationFrame(fitPendingViewport);
        return;
      }
      reactFlowInstance.fitView({
        duration: 0,
        padding: 0.2,
      });
      pendingViewportRef.current = null;
    }
    frameId = requestAnimationFrame(fitPendingViewport);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [reactFlowInstance, rfNodes, rfEdges]);

  const handleNodeDrag = useCallback((event, node) => {
    if (!node.parentNode) return;
    setRfNodes(ns => fitGroupsToChildren(ns, false));
  }, [setRfNodes]);

  const handleNodeDragStop = useCallback((event, node) => {
    if (!node.parentNode) return;
    setRfNodes(ns => fitGroupsToChildren(ns, true));
  }, [setRfNodes]);

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
        selectedComponent={selectedComponent ?? (focalNodeId ? nodeById.get(focalNodeId)?.component ?? null : null)}
        focalNodeId={focalNodeId}
        onNavigateToRoot={navToRoot}
        onNavigateToComponent={navToComponent}
      />
      <GraphToolbar
        visibleEdgeTypes={visibleEdgeTypes}
        onToggleEdgeType={handleToggleEdgeType}
        showMinimap={showMinimap}
        onToggleMinimap={() => setShowMinimap(v => !v)}
        onResetLayout={() => { pendingViewportRef.current = { type: 'full' }; setLayoutKey(k => k + 1); }}
        level={level}
        depth={depth}
        onDepth={setDepth}
        allNodes={graphData?.nodes ?? []}
        focalNodeId={focalNodeId}
        onFocalNode={navToFocus}
        layoutMode={layoutMode}
        onLayoutMode={mode => { saveLayoutMode(mode); setLayoutMode(mode); }}
        scope={scope}
        onScope={setScope}
        scopeOptions={level === 'interior' ? level2?.scopeOptions : null}
        scopeInfo={level === 'interior' ? level2?.scopeInfo : null}
      />
      <div className="graph-canvas-wrap">
        <ReactFlowProvider>
          <ReactFlowCanvas
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDrag={handleNodeDrag}
            onNodeDragStop={handleNodeDragStop}
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
