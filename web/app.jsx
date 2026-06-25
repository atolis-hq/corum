/* Main app: router, nav shell, data loading, and node pages. */

const { useState, useEffect, useCallback, useMemo } = React;
const {
  navigate,
  BrandMark,
  Icon,
  StateTag,
  StabilityTag,
  TemplateBadge,
  PropertiesTable,
  SchemaCard,
} = window.CorumPrimitives;
const { buildNavTree, buildOverlayIndicatorIds } = window.CorumNav;
const { parseRoute, buildRoute } = window.CorumRouter;

function displayName(id) {
  const parts = id.split('.');
  return parts[parts.length - 1];
}

function anchorIdForNode(nodeId) {
  return `node-anchor-${encodeURIComponent(nodeId)}`;
}

function templateDisplayName(template) {
  return template?.ui?.displayName ?? template?.name ?? '';
}

function summarizeBranchFailure(result) {
  const firstDiagnostic = result?.diagnostics?.[0];
  if (firstDiagnostic) {
    return `${firstDiagnostic.file}: ${firstDiagnostic.message}`;
  }
  return result?.error ?? 'Branch failed to load';
}

function TopBar() {
  return (
    <div className="topbar">
      <div className="brand">
        <BrandMark size={22} color="#fff" />
        <span>corum</span>
      </div>
    </div>
  );
}

function NavRail({ activeSection, onSection, debugMode, onDebugMode }) {
  const items = [
    { id: 'dashboard', icon: 'grip', label: 'Dashboard' },
    { id: 'components', icon: 'circle-nodes', label: 'Models' },
  ];

  return (
    <div className="nav-rail">
      {items.map(item => (
        <button
          key={item.id}
          className={`nav-rail-item${activeSection === item.id ? ' active' : ''}`}
          onClick={() => onSection(item.id)}
          title={item.label}
          type="button"
        >
          <Icon name={item.icon} size={16} />
          <span>{item.label}</span>
        </button>
      ))}
      <button
        className="nav-rail-item"
        onClick={onDebugMode}
        title="Debug mode: show fully qualified names"
        type="button"
        style={{
          marginTop: 'auto',
          ...(debugMode ? { background: 'var(--paper-3)', color: 'var(--ink)', borderColor: 'var(--rule-2)' } : {}),
        }}
      >
        <Icon name="code" size={16} />
        <span>Debug</span>
      </button>
    </div>
  );
}

function entryKey(entry) {
  return entry.kind === 'group' ? entry.groupTemplateName : entry.templateName;
}

function NavTree({ navTree, templates, activeNodeId, onNode, overlayIndicatorIds }) {
  const sortedComponents = [...navTree.keys()].sort((a, b) => a.localeCompare(b));
  const [openComponent, setOpenComponent] = useState();
  const [openEntryKeys, setOpenEntryKeys] = useState(new Set());
  const templateMap = new Map(templates.map(template => [template.name, template]));

  function openComponentWithEntries(component) {
    setOpenComponent(component);
    if (!component) { setOpenEntryKeys(new Set()); return; }
    const entries = navTree.get(component) ?? [];
    setOpenEntryKeys(entries.length === 1 ? new Set([entryKey(entries[0])]) : new Set());
  }

  // Initialise / recover openComponent when the tree first loads or the open component disappears.
  useEffect(() => {
    const autoOpen = sortedComponents.length === 1 ? sortedComponents[0] : null;
    if (openComponent === undefined) { openComponentWithEntries(autoOpen); return; }
    if (openComponent !== null && !navTree.has(openComponent)) { openComponentWithEntries(autoOpen); }
  }, [navTree, openComponent, sortedComponents]);

  // When navigating directly to a node (e.g. via link), open its component and entry.
  useEffect(() => {
    if (!activeNodeId || !navTree.size) return;
    for (const [component, entries] of navTree.entries()) {
      for (const entry of entries) {
        const eKey = entryKey(entry);
        let found = false;
        if (entry.kind === 'group') {
          found = entry.children.some(child => child.nodes.some(n => n.id === activeNodeId));
        } else {
          found = entry.nodes.some(n => n.id === activeNodeId) ||
            entry.nodes.some(n => (n.navChildren ?? []).some(g => g.nodes.some(c => c.id === activeNodeId)));
        }
        if (found) {
          setOpenComponent(component);
          setOpenEntryKeys(new Set([eKey]));
          return;
        }
      }
    }
  }, [activeNodeId, navTree]);

  function toggleComponent(component) {
    if (openComponent === component) { openComponentWithEntries(null); }
    else { openComponentWithEntries(component); }
  }

  function toggleEntry(key) {
    setOpenEntryKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (navTree.size === 0) {
    return <div className="nav-tree"><div className="empty-state">No graph nodes loaded.</div></div>;
  }

  return (
    <div className="nav-tree">
      {sortedComponents.map(component => {
        const entries = navTree.get(component);
        return (
          <div key={component}>
            <div className="nav-section-head" onClick={() => toggleComponent(component)}>
              <span>{component}</span>
              <Icon name={openComponent === component ? 'chevron-down' : 'chevron-right'} size={12} />
            </div>
            {openComponent === component && entries.map(entry => {
              if (entry.kind === 'group') {
                const gKey = entryKey(entry);
                const gOpen = openEntryKeys.has(gKey);
                return (
                  <div key={entry.groupTemplateName}>
                    <div className="nav-template-head" onClick={() => toggleEntry(gKey)} style={{ cursor: 'pointer' }}>
                      {entry.icon && (
                        <i
                          className={`fa-solid fa-${entry.icon}`}
                          style={{ fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}
                        />
                      )}
                      <span>{entry.label}</span>
                      <Icon name={gOpen ? 'chevron-down' : 'chevron-right'} size={10} />
                    </div>
                    {gOpen && entry.children.map(child => (
                      <div key={child.templateName}>
                        <div className="nav-subtype-head">
                          {child.icon && (
                            <i
                              className={`fa-solid fa-${child.icon}`}
                              style={{ fontSize: 11, width: 14, textAlign: 'center', flexShrink: 0 }}
                            />
                          )}
                          <span>{child.label}</span>
                        </div>
                        {child.nodes.map(node => {
                          const isActive = node.id === activeNodeId;
                          return (
                            <div
                              key={node.id}
                              className={`nav-node-item${isActive ? ' active' : ''}`}
                              onClick={() => onNode(node.id)}
                              title={node.id}
                              style={isActive ? { '--nav-node-active-bg': child.colour } : undefined}
                            >
                              {displayName(node.id)}
                              {overlayIndicatorIds && overlayIndicatorIds.has(node.id) && (
                                <span className="signal-dots">
                                  <span className="signal-dot signal-dot-0" />
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              }

              const template = templateMap.get(entry.templateName);
              const colour = template?.ui?.colour ?? 'var(--ink-4)';
              const tKey = entryKey(entry);
              const tOpen = openEntryKeys.has(tKey);
              return (
                <div key={entry.templateName}>
                  <div className="nav-template-head" onClick={() => toggleEntry(tKey)} style={{ cursor: 'pointer' }}>
                    <i
                      className={`fa-solid fa-${template?.ui?.icon ?? 'circle'}`}
                      style={{ fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}
                    />
                    <span>{templateDisplayName(template)}</span>
                    <Icon name={tOpen ? 'chevron-down' : 'chevron-right'} size={10} />
                  </div>
                  {tOpen && entry.nodes.map(node => {
                    const isActive = node.id === activeNodeId;
                    return (
                      <div key={node.id}>
                        <div
                          className={`nav-node-item${isActive ? ' active' : ''}`}
                          onClick={() => onNode(node.id)}
                          title={node.id}
                          style={isActive ? { '--nav-node-active-bg': colour } : undefined}
                        >
                          {displayName(node.id)}
                        </div>
                        {(node.navChildren ?? []).map(group => (
                          <div className="nav-child-group" key={group.label}>
                            <div className="nav-child-head">{group.label}</div>
                            {group.nodes.map(child => {
                              const childTemplate = templateMap.get(child.template);
                              const childColour = childTemplate?.ui?.colour ?? colour;
                              const childIsActive = child.id === activeNodeId;
                              return (
                                <div
                                  key={child.id}
                                  className={`nav-node-item nav-node-child${childIsActive ? ' active' : ''}`}
                                  onClick={() => onNode(child.id)}
                                  title={child.id}
                                  style={childIsActive ? { '--nav-node-active-bg': childColour } : undefined}
                                >
                                  {displayName(child.id)}
                                  {overlayIndicatorIds && overlayIndicatorIds.has(child.id) && (
                                    <span className="signal-dots">
                                      <span className="signal-dot signal-dot-0" />
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function BranchBar({ branches, branchResults, viewingRef, overlayRefs, overlayMode, onViewingRef, onOverlayRefs, onOverlayMode, onReload }) {
  const { useState: useLocalState, useEffect: useLocalEffect, useRef: useLocalRef } = React;
  const [pickerOpen, setPickerOpen] = useLocalState(false);
  const [comparePickerOpen, setComparePickerOpen] = useLocalState(false);
  const viewingPickerRef = useLocalRef(null);
  const comparePickerRef = useLocalRef(null);

  useLocalEffect(() => {
    if (!pickerOpen && !comparePickerOpen) return;
    function handleClickOutside(e) {
      if (viewingPickerRef.current && !viewingPickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
      if (comparePickerRef.current && !comparePickerRef.current.contains(e.target)) {
        setComparePickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen, comparePickerOpen]);
  const failedBranches = branchResults.filter(result => result.status === 'failed');
  const compareableBranches = branches.filter(branch => branch.ref !== viewingRef);

  const effectiveOverlayRefs = overlayMode === 'consolidated'
    ? branches.filter(branch => branch.ref !== viewingRef).map(branch => branch.ref)
    : overlayMode === 'selected'
      ? overlayRefs
      : [];

  const visibleOverlayRefs = effectiveOverlayRefs.slice(0, 3);
  const hiddenCount = effectiveOverlayRefs.length - visibleOverlayRefs.length;

  return (
    <div className="branch-bar">
      <span className="branch-label">⎇</span>
      <span className="branch-label">Viewing</span>
      <div ref={viewingPickerRef} style={{ position: 'relative' }}>
        <span
          className="branch-chip viewing"
          onClick={() => { setPickerOpen(open => !open); setComparePickerOpen(false); }}
          title="Switch viewing branch"
        >
          {viewingRef}
        </span>
        {failedBranches.length > 0 && (
          <span className="branch-failed-badge" title={failedBranches.map(summarizeBranchFailure).join('\n')}>
            {failedBranches.length} failed
          </span>
        )}
        {pickerOpen && (
          <div className="branch-picker">
            {branches.map(branch => (
              <div
                key={branch.ref}
                className={`branch-picker-item${branch.ref === viewingRef ? ' active' : ''}`}
                onClick={() => { onViewingRef(branch.ref); setPickerOpen(false); }}
              >
                {branch.ref === viewingRef && <Icon name="check" size={11} />}
                {branch.ref}
              </div>
            ))}
            {failedBranches.map(result => (
              <div
                key={result.ref}
                className="branch-picker-item branch-picker-item-disabled"
                title={summarizeBranchFailure(result)}
              >
                <div className="branch-picker-main">{result.ref}</div>
                <div className="branch-picker-error">{summarizeBranchFailure(result)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {overlayMode === 'selected' && (
        <>
          <span className="branch-label">Compare</span>
          <div ref={comparePickerRef} style={{ position: 'relative' }}>
            <span
              className="branch-chip overlay branch-chip-select"
              onClick={() => { setComparePickerOpen(open => !open); setPickerOpen(false); }}
              title="Select compare branches"
            >
              {overlayRefs.length > 0 ? `${overlayRefs.length} selected` : 'Select branches'}
            </span>
            {comparePickerOpen && (
              <div className="branch-picker">
                {compareableBranches.map(branch => (
                  <label key={branch.ref} className="branch-picker-item branch-picker-item-selectable">
                    <span className="branch-picker-main">{branch.ref}</span>
                    <input
                      className="branch-picker-check"
                      type="checkbox"
                      checked={overlayRefs.includes(branch.ref)}
                      onChange={() => onOverlayRefs(overlayRefs.includes(branch.ref)
                        ? overlayRefs.filter(ref => ref !== branch.ref)
                        : [...overlayRefs, branch.ref])}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {overlayMode !== 'single' && effectiveOverlayRefs.length > 0 && (
        <span className="branch-label">overlaid with</span>
      )}
      {overlayMode === 'selected' && visibleOverlayRefs.map(ref => (
        <span key={ref} className="branch-chip overlay">
          {ref}
          <span
            className="branch-chip-remove"
            onClick={() => onOverlayRefs(overlayRefs.filter(item => item !== ref))}
          >x</span>
        </span>
      ))}
      {overlayMode === 'consolidated' && visibleOverlayRefs.map(ref => (
        <span key={ref} className="branch-chip overlay">{ref}</span>
      ))}
      {hiddenCount > 0 && (
        <span className="branch-chip more">+{hiddenCount} more</span>
      )}
      <div className="branch-bar-spacer" />
      <span className="branch-chip reload" onClick={onReload} title="Reload branches and graph data">
        Reload
      </span>
      <div className="branch-seg">
        {['single', 'selected', 'consolidated'].map(mode => (
          <span
            key={mode}
            className={`branch-seg-item${overlayMode === mode ? ' active' : ''}`}
            onClick={() => onOverlayMode(mode)}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function DashboardPage() {
  return <div className="content"><h1>Dashboard</h1></div>;
}

function ComponentsPage() {
  return <div className="content"><h1>Components</h1></div>;
}

function NodePage({ nodeId, templates, onNavigate, refreshToken, viewingRef, overlayRefs, compact = true }) {
  const [cluster, setCluster] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!nodeId) return;
    setCluster(null);
    setError(null);
    const refParam = viewingRef ? `&ref=${encodeURIComponent(viewingRef)}` : '';
    const overlayParam = overlayRefs && overlayRefs.length > 0
      ? '&' + overlayRefs.map(ref => `overlayRefs=${encodeURIComponent(ref)}`).join('&')
      : '';
    fetch(`/api/cluster?nodeId=${encodeURIComponent(nodeId)}&includeEdges=maps-to,reads${refParam}${overlayParam}`)
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(setCluster)
      .catch(err => setError(String(err)));
  }, [nodeId, refreshToken, viewingRef, overlayRefs]);

  if (!nodeId) return <div className="content"><p className="label-sm">No node selected.</p></div>;
  if (error) return <div className="content"><p style={{ color: 'var(--warn)' }}>Error loading node: {error}</p></div>;
  if (!cluster) return <div className="content"><p className="label-sm">Loading...</p></div>;

  const { root, descendants, includedNodes, edges } = cluster;
  const template = templates.find(item => item.name === root.template);
  const colour = template?.ui?.colour ?? null;
  const nestedSections = new Set((template?.ui?.nav?.nestOwned ?? []).map(item => item.section));
  const Plugin = window.CorumPlugins?.[root.template];
  if (Plugin) return <Plugin node={root} cluster={cluster} template={template} />;

  const displayChildren = new Map();
  for (const child of descendants) {
    if (child.parentId === root.id && nestedSections.has(child.ownedSection)) continue;
    if (!displayChildren.has(child.template)) displayChildren.set(child.template, []);
    displayChildren.get(child.template).push(child);
  }
  const displayedNodeIds = new Set([
    root.id,
    ...Array.from(displayChildren.values()).reduce((all, group) => all.concat(group), []).map(child => child.id),
    ...includedNodes.map(n => n.id),
  ]);
  const rootSpecializedTemplates = new Set(['Schema', 'EnumDefinition']);
  const rootSpecializedNodes = rootSpecializedTemplates.has(root.template) ? [[root.template, [root]]] : [];
  const childDisplayEntries = [...displayChildren.entries()]
    .filter(([templateName]) => templateName !== 'Field' && templateName !== 'EnumValue' && templateName !== 'Mapping');
  const displayEntries = [...rootSpecializedNodes, ...childDisplayEntries];
  const includedSchemaNodes = includedNodes.filter(n => n.template === 'Schema');
  const includedEnumNodes = includedNodes.filter(n => n.template === 'EnumDefinition');

  function handlePropertyNavigate(targetNodeId) {
    if (displayedNodeIds.has(targetNodeId)) {
      document.getElementById(anchorIdForNode(targetNodeId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    onNavigate(targetNodeId);
  }

  return (
    <div className="content">
      <div id={anchorIdForNode(root.id)} style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{displayName(root.id)}</h1>
          <TemplateBadge name={templateDisplayName(template)} colour={colour} />
          <StateTag state={root.state} />
          <StabilityTag stability={root.stability} />
        </div>
        <div className="label-sm mono">{root.id}</div>
      </div>

      <div className="meta-strip">
        {[
          ['Component', root.component],
          ['State', root.state],
          ['Stability', root.stability],
          ['Schema version', root.schemaVersion],
          ['Last modified', root.lastModifiedAt],
        ].map(([label, value]) => (
          <div key={label} className="meta-cell">
            <div className="label-xs">{label}</div>
            <div style={{ fontSize: 12, marginTop: 3 }}>{value}</div>
          </div>
        ))}
      </div>

      {Object.keys(root.properties ?? {}).length > 0 && (
        <div className="card">
          <div className="card-head">Properties</div>
          <div className="card-body">
            <PropertiesTable
              properties={root.properties}
              onNavigate={handlePropertyNavigate}
              propertyHints={template?.ui?.propertyDisplay ?? {}}
            />
          </div>
        </div>
      )}

      {displayEntries.map(([templateName, groupNodes]) => (
          <SchemaCard
            key={templateName}
            title={templateName}
            nodes={groupNodes}
            allNodes={[root, ...descendants, ...includedNodes]}
            edges={edges}
            anchorIdForNode={anchorIdForNode}
            overlayFields={cluster.overlay ? cluster.overlay.fields : null}
            overlayRefs={cluster.overlay ? cluster.overlay.overlayRefs : null}
            compact={compact}
          />
        ))}
      {includedSchemaNodes.length > 0 && (
        <SchemaCard
          key="__shared-schemas__"
          title="Schema"
          nodes={includedSchemaNodes}
          allNodes={[root, ...descendants, ...includedNodes]}
          edges={edges}
          anchorIdForNode={anchorIdForNode}
          isShared={true}
          compact={compact}
        />
      )}
      {includedEnumNodes.length > 0 && (
        <SchemaCard
          key="__shared-enums__"
          title="EnumDefinition"
          nodes={includedEnumNodes}
          allNodes={[root, ...descendants, ...includedNodes]}
          edges={edges}
          anchorIdForNode={anchorIdForNode}
          isShared={true}
          compact={compact}
        />
      )}
    </div>
  );
}

function resolveTemplates(templates) {
  const map = new Map(templates.map(t => [t.name, t]));
  for (const t of templates) {
    const groupName = t.ui?.nav?.navGroup;
    if (!groupName || t.ui?.colour) continue;
    const groupColour = map.get(groupName)?.ui?.colour;
    if (groupColour) {
      t.ui = { ...t.ui, colour: groupColour };
    }
  }
  return templates;
}

function App() {
  const [templates, setTemplates] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [refreshToken, setRefreshToken] = useState(0);
  const [gitMode, setGitMode] = useState(false);
  const [branches, setBranches] = useState([]);
  const [branchResults, setBranchResults] = useState([]);
  const [viewingRef, setViewingRef] = useState(null);
  const [overlayRefs, setOverlayRefs] = useState([]);
  const [overlayMode, setOverlayMode] = useState('single');
  const [overlayIndicatorIds, setOverlayIndicatorIds] = useState(new Set());
  const [debugMode, setDebugMode] = useState(() => {
    try { return localStorage.getItem('corum:debugMode') === 'true'; } catch { return false; }
  });

  function handleDebugMode() {
    setDebugMode(prev => {
      const next = !prev;
      try { localStorage.setItem('corum:debugMode', String(next)); } catch {}
      return next;
    });
  }

  const refreshGraphData = useCallback((targetViewingRef = viewingRef) => {
    setError(null);
    const refParam = targetViewingRef ? `?ref=${encodeURIComponent(targetViewingRef)}` : '';
    return Promise.all([
      fetch(`/api/templates${refParam}`).then(response => response.ok ? response.json() : Promise.reject(response.status)),
      fetch(`/api/nodes${refParam}`).then(response => response.ok ? response.json() : Promise.reject(response.status)),
    ])
      .then(([templateData, nodeData]) => {
        setTemplates(resolveTemplates(templateData));
        setNodes(nodeData);
        setRefreshToken(token => token + 1);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, [viewingRef]);

  const refreshBranchState = useCallback(() => {
    return fetch('/api/branches')
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (!data) return null;
        setGitMode(true);
        setBranches(data.branches || []);
        setBranchResults(data.results || []);
        const urlRef = parseRoute(window.location.hash).branch;
        const validUrlRef = (data.branches || []).find(branch => branch.ref === urlRef);
        const validViewingRef = (data.branches || []).find(branch => branch.ref === viewingRef);
        const nextViewingRef = validUrlRef ? urlRef : (validViewingRef ? viewingRef : data.default);
        setViewingRef(nextViewingRef);
        return { nextViewingRef };
      })
      .catch(() => null);
  }, [viewingRef]);

  const refreshAllData = useCallback(() => {
    return refreshBranchState()
      .then(result => refreshGraphData(result?.nextViewingRef ?? viewingRef));
  }, [refreshBranchState, refreshGraphData, viewingRef]);

  useEffect(() => {
    if (!window.EventSource) return;
    const eventSource = new EventSource('/api/events');
    eventSource.addEventListener('graph-reloaded', refreshAllData);
    return () => {
      eventSource.removeEventListener('graph-reloaded', refreshAllData);
      eventSource.close();
    };
  }, [refreshAllData]);

  useEffect(() => {
    refreshBranchState();
  }, [refreshBranchState]);

  useEffect(() => {
    if (viewingRef !== null || !gitMode) {
      refreshGraphData();
    }
  }, [viewingRef, gitMode, refreshGraphData]);

  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const activeNodeId = route.pathname === '/node' ? route.params.get('id') : null;
  const activeSection = activeNodeId ? 'components' : (route.pathname.slice(1) || 'dashboard');
  const navTree = useMemo(() => buildNavTree(nodes, templates), [nodes, templates]);
  const showTree = activeSection === 'components' || activeNodeId;
  const activeOverlayRefs = useMemo(() =>
    overlayMode === 'single' ? [] :
    overlayMode === 'consolidated' ? branches.filter(branch => branch.ref !== viewingRef).map(branch => branch.ref) :
    overlayRefs,
  [overlayMode, branches, viewingRef, overlayRefs]);

  useEffect(() => {
    setOverlayRefs(prev => prev.filter(ref => ref !== viewingRef && branches.some(branch => branch.ref === ref)));
  }, [viewingRef, branches]);

  useEffect(() => {
    if (!viewingRef || activeOverlayRefs.length === 0) {
      setOverlayIndicatorIds(new Set());
      return;
    }
    fetch(`/api/overlay/${encodeURIComponent(viewingRef)}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => {
        setOverlayIndicatorIds(buildOverlayIndicatorIds(nodes, templates, data.nodes || [], activeOverlayRefs));
      })
      .catch(() => setOverlayIndicatorIds(new Set()));
  }, [viewingRef, overlayMode, overlayRefs, branches, nodes, templates]);

  function handleSection(section) {
    navigate(buildRoute({ pathname: `/${section}`, params: {}, branch: viewingRef }));
  }

  function handleNode(nodeId) {
    navigate(buildRoute({ pathname: '/node', params: { id: nodeId }, branch: viewingRef }));
  }

  let page;
  if (loading) {
    page = <div className="content"><p className="label-sm">Loading graph...</p></div>;
  } else if (error) {
    page = <div className="content"><p style={{ color: 'var(--warn)' }}>Error loading graph: {error}</p></div>;
  } else if (route.pathname === '/dashboard' || route.pathname === '/') {
    page = <DashboardPage />;
  } else if (route.pathname === '/components') {
    page = <ComponentsPage />;
  } else if (route.pathname === '/node') {
    page = (
      <NodePage
        nodeId={activeNodeId}
        templates={templates}
        onNavigate={handleNode}
        refreshToken={refreshToken}
        viewingRef={viewingRef}
        overlayRefs={activeOverlayRefs}
        compact={!debugMode}
      />
    );
  } else {
    page = <div className="content"><p className="label-sm">Page not found.</p></div>;
  }

  return (
    <>
      <TopBar />
      {gitMode && (
        <BranchBar
          branches={branches}
          branchResults={branchResults}
          viewingRef={viewingRef}
          overlayRefs={overlayRefs}
          overlayMode={overlayMode}
                  onViewingRef={ref => {
                        setViewingRef(ref);
                        navigate(buildRoute({ pathname: route.pathname, params: route.params, branch: ref }));
                      }}
                      onOverlayRefs={setOverlayRefs}
                      onOverlayMode={setOverlayMode}
                      onReload={() => {
                        fetch('/api/reload', { method: 'POST' })
                          .then(() => refreshAllData())
                          .catch(() => refreshAllData());
                      }}
                    />
                  )}
      <div className="main">
        <NavRail activeSection={activeSection} onSection={handleSection} debugMode={debugMode} onDebugMode={handleDebugMode} />
        {showTree && !loading && !error && (
          <NavTree
            navTree={navTree}
            templates={templates}
            activeNodeId={activeNodeId}
            onNode={handleNode}
            overlayIndicatorIds={overlayIndicatorIds}
          />
        )}
        {page}
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
