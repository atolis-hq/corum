/* Main app: router, nav shell, data loading, and node pages. */

if (!window.CorumHost) {
  // boot.js or an import-map module failed to load: say so instead of leaving a blank page.
  const box = document.getElementById('root');
  const message = document.createElement('div');
  message.setAttribute('data-testid', 'boot-error');
  message.style.cssText = 'padding:24px;font:14px/1.5 system-ui,sans-serif;color:#7f1d1d';
  message.textContent = 'Corum failed to start: the UI modules could not be loaded. Check the browser console and the server, then reload the page.';
  box.appendChild(message);
  throw new Error('window.CorumHost is not available (boot.js failed to load)');
}

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
  matchKeysFor,
  resolveNodeTarget,
  hrefForNode,
  hrefForAction,
  owningRoot,
} = window.CorumHost.sdk;
const hostRegistry = window.CorumHost.registry;

// Quick-link icons for node actions that opt into a surface ('header' or 'relations').
function QuickLinks({ nodeId, keys, surface, viewingRef }) {
  const actions = hostRegistry.nodeActionsFor(keys).filter(action => action.quick.includes(surface));
  return actions.map(action => (
    <a
      key={`${action.pluginId}/${action.id}`}
      className="quick-link"
      href={hrefForAction(action, nodeId, { branch: viewingRef })}
      title={action.label}
      aria-label={action.label}
      onClick={event => event.stopPropagation()}
    >
      <Icon name={action.icon ?? 'arrow-up-right-from-square'} size={12} />
    </a>
  ));
}
const { buildNavTree, buildOverlayIndicatorIds, groupNamespacesByKind, namespaceEdges } = window.CorumNav;
const { parseRoute, buildRoute } = window.CorumRouter;
const { kindColour } = window.CorumGraphUtils;
const { SearchModal } = window.CorumSearch;

// uses-type is excluded here: it's the auto-generated type-reference edge
// (schema/field-level), surfaced via SchemaCard node-ref links and the
// includedSchemaNodes panel instead of the root-to-root Connections list.
const PANEL_EDGE_TYPES = new Set(['triggers', 'produces', 'calls', 'implements', 'reads']);

const EDGE_TYPE_STYLES = {
  triggers: { background: '#fef3c7', color: '#b45309' },
  produces: { background: '#ccfbf1', color: '#0f766e' },
  calls: { background: '#ede9fe', color: '#6d28d9' },
  implements: { background: '#f1f5f9', color: '#475569' },
  reads: { background: '#dbeafe', color: '#1d4ed8' },
};

function classifyEdges(edges, clusterIds) {
  const inbound = [];
  const outbound = [];
  for (const edge of edges) {
    if (!PANEL_EDGE_TYPES.has(edge.type)) continue;
    if (clusterIds.has(edge.from) && !clusterIds.has(edge.to)) {
      outbound.push(edge);
    } else if (!clusterIds.has(edge.from) && clusterIds.has(edge.to)) {
      inbound.push(edge);
    }
  }
  return { inbound, outbound };
}

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

function TopBar({ onSearchOpen }) {
  const inputRef = React.useRef(null);

  function handleFocus() {
    inputRef.current?.blur();
    onSearchOpen();
  }

  return (
    <div className="topbar">
      <div className="brand">
        <BrandMark size={22} color="#fff" />
        <span>corum</span>
      </div>
      <div className="topbar-search-wrap">
        <i className="fa-solid fa-magnifying-glass topbar-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="topbar-search"
          placeholder="Search graph..."
          onFocus={handleFocus}
          readOnly
        />
        <span className="topbar-search-hint">⌘K</span>
      </div>
    </div>
  );
}

function pluginSectionId(page) {
  return `plugin:${page.pluginId}/${page.id}`;
}

function NavRail({ activeSection, onSection, pluginPages = [], debugMode, onDebugMode }) {
  const items = [
    { id: 'dashboard', icon: 'grip', label: 'Dashboard' },
    { id: 'namespaces', icon: 'circle-nodes', label: 'Models' },
    ...pluginPages.map(page => ({
      id: pluginSectionId(page),
      icon: page.icon ?? 'puzzle-piece',
      label: page.title,
      pluginPage: page,
    })),
  ];

  return (
    <div className="nav-rail">
      {items.map(item => (
        <button
          key={item.id}
          className={`nav-rail-item${activeSection === item.id ? ' active' : ''}`}
          onClick={() => onSection(item.id, item.pluginPage)}
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

function NavTree({ navTree, kindSections, templates, activeNodeId, onNode, onNamespace, overlayIndicatorIds }) {
  const sortedComponents = [...navTree.keys()].sort((a, b) => a.localeCompare(b));
  const [openComponent, setOpenComponent] = useState();
  const [openEntryKeys, setOpenEntryKeys] = useState(new Set());
  const [openGroupKeys, setOpenGroupKeys] = useState(new Set());
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

  // Auto-expand groups for the active node; collapse all others.
  useEffect(() => {
    if (!activeNodeId || !navTree.size) return;
    for (const entries of navTree.values()) {
      for (const entry of entries) {
        if (entry.kind === 'group') continue;
        for (const node of entry.nodes) {
          const isOwner =
            node.id === activeNodeId ||
            (node.navChildren ?? []).some(g => g.nodes.some(c => c.id === activeNodeId));
          if (isOwner) {
            setOpenGroupKeys(new Set((node.navChildren ?? []).map(g => `${node.id}:${g.label}`)));
            return;
          }
        }
      }
    }
    setOpenGroupKeys(new Set());
  }, [activeNodeId, navTree]);

  function toggleComponent(component, kind) {
    if (openComponent === component) { openComponentWithEntries(null); }
    else { openComponentWithEntries(component); }
    // Kinds other than the default have no dedicated view: open the generic namespace page.
    if (kind !== 'component') onNamespace(component);
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
    <div className="nav-tree" onKeyDown={event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.getAttribute('role') === 'button') {
        event.preventDefault();
        event.target.click();
      }
    }}>
      {kindSections.map(section => (
        <div key={section.kind} className="nav-kind-section" data-kind={section.kind}>
        {kindSections.length > 1 && <div className="nav-kind-head">{section.label}</div>}
      {section.namespaces.map(component => {
        const entries = navTree.get(component) ?? [];
        return (
          <div key={component}>
            <div className="nav-section-head" role="button" tabIndex={0} aria-expanded={openComponent === component} onClick={() => toggleComponent(component, section.kind)}>
              <span>{component}</span>
              <Icon name={openComponent === component ? 'chevron-down' : 'chevron-right'} size={12} />
            </div>
            {openComponent === component && entries.map(entry => {
              if (entry.kind === 'group') {
                const gKey = entryKey(entry);
                const gOpen = openEntryKeys.has(gKey);
                return (
                  <div key={entry.groupTemplateName}>
                    <div className="nav-template-head" role="button" tabIndex={0} aria-expanded={gOpen} onClick={() => toggleEntry(gKey)} style={{ cursor: 'pointer' }}>
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
                          role="button" tabIndex={0} aria-current={isActive ? 'true' : undefined}
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
                  <div className="nav-template-head" role="button" tabIndex={0} aria-expanded={tOpen} onClick={() => toggleEntry(tKey)} style={{ cursor: 'pointer' }}>
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
                              role="button" tabIndex={0} aria-current={isActive ? 'true' : undefined}
                          onClick={() => onNode(node.id)}
                          title={node.id}
                          style={isActive ? { '--nav-node-active-bg': colour } : undefined}
                        >
                          {displayName(node.id)}
                        </div>
                        {(node.navChildren ?? []).map(group => {
                          const groupKey = `${node.id}:${group.label}`;
                          const groupOpen = openGroupKeys.has(groupKey);
                          return (
                            <div className="nav-child-group" key={group.label}>
                              <div
                                className="nav-child-head"
                                role="button" tabIndex={0} aria-expanded={groupOpen}
                                style={{ cursor: 'pointer' }}
                                onClick={() => setOpenGroupKeys(prev => {
                                  const next = new Set(prev);
                                  next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
                                  return next;
                                })}
                              >
                                {group.label}
                                <Icon name={groupOpen ? 'chevron-down' : 'chevron-right'} size={10} />
                              </div>
                              {groupOpen && group.nodes.map(child => {
                                const childTemplate = templateMap.get(child.template);
                                const childColour = childTemplate?.ui?.colour ?? colour;
                                const childIsActive = child.id === activeNodeId;
                                return (
                                  <div
                                    key={child.id}
                                    className={`nav-node-item nav-node-child${childIsActive ? ' active' : ''}`}
                                    role="button" tabIndex={0} aria-current={childIsActive ? 'true' : undefined}
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
      })}
        </div>
      ))}
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

function HeroCard({ value, label }) {
  return (
    <div className="hero-card">
      <div className="hero-number">{value}</div>
      <div className="hero-label">{label}</div>
    </div>
  );
}

function DashboardPage({ nodes, templates, kinds, gitMode, viewingRef, branches, branchResults }) {
  const [stats, setStats] = useState(null);
  const [branchDiff, setBranchDiff] = useState(null);

  const defaultBranchRef = branches.find(b => b.isDefault)?.ref ?? null;
  const isOnNonDefaultBranch = gitMode && viewingRef && defaultBranchRef && viewingRef !== defaultBranchRef;

  useEffect(() => {
    const refParam = viewingRef ? `?ref=${encodeURIComponent(viewingRef)}` : '';
    fetch(`/api/stats${refParam}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(setStats)
      .catch(() => setStats(null));
  }, [viewingRef]);

  useEffect(() => {
    if (!isOnNonDefaultBranch) { setBranchDiff(null); return; }
    fetch(`/api/overlay/${encodeURIComponent(viewingRef)}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => {
        const added = (data.nodes || []).filter(n => n.ghostState === 'local').length;
        const removed = (data.nodes || []).filter(n => n.ghostState === 'default-only').length;
        setBranchDiff({ added, removed, defaultBranch: defaultBranchRef });
      })
      .catch(() => setBranchDiff(null));
  }, [isOnNonDefaultBranch, viewingRef, defaultBranchRef]);

  const totalEdges = stats ? Object.values(stats.edgesByType).reduce((a, b) => a + b, 0) : '…';

  const templateMap = new Map(templates.map(t => [t.name, t]));

  const nodesByTemplate = stats
    ? Object.entries(stats.nodesByTemplate).sort((a, b) => b[1] - a[1])
    : [];

  const kindLabels = new Map((kinds ?? []).map(kind => [kind.id, kind.label]));
  const namespacesByKind = stats
    ? Object.entries(stats.namespacesByKind ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : [];

  const nodesByComponent = stats
    ? Object.entries(stats.nodesByNamespace).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : [];

  const nodesByState = stats
    ? Object.entries(stats.nodesByState).sort((a, b) => b[1] - a[1])
    : [];

  const nodesByStability = stats
    ? Object.entries(stats.nodesByStability).sort((a, b) => b[1] - a[1])
    : [];

  const edgeRows = stats
    ? Object.entries(stats.edgesByType).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1])
    : [];

  const orphanRows = stats
    ? Object.entries(stats.orphansByTemplate).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="content">
      <div className="dashboard-hero">
        <HeroCard value={stats ? stats.namespaceCount : '…'} label="Namespaces" />
        <HeroCard value={stats ? stats.nodeCount : '…'} label="Nodes" />
        <HeroCard value={totalEdges} label="Edges" />
        <HeroCard value={stats ? stats.orphanNodeCount : '…'} label="Orphan Nodes" />
      </div>

      {branchDiff && (
        <div className="branch-diff-callout">
          <span className="branch-diff-branch">⎇ {viewingRef}</span>
          <span className="branch-diff-label">vs {branchDiff.defaultBranch}</span>
          {branchDiff.added > 0 && <span className="branch-diff-added">+{branchDiff.added} added</span>}
          {branchDiff.removed > 0 && <span className="branch-diff-removed">−{branchDiff.removed} removed</span>}
          {branchDiff.added === 0 && branchDiff.removed === 0 && (
            <span className="branch-diff-label">No changes</span>
          )}
        </div>
      )}

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="card-head">Nodes by Type</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {nodesByTemplate.map(([name, count]) => {
              const tmpl = templateMap.get(name);
              const colour = tmpl?.ui?.colour ?? 'var(--ink-4)';
              return (
                <div key={name} className="stat-row">
                  <span className="stat-row-label">
                    <span className="stat-colour-dot" style={{ background: colour }} />
                    {tmpl?.ui?.displayName ?? name}
                  </span>
                  <span className="stat-row-value">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Namespaces by Kind</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {namespacesByKind.map(([kind, count]) => (
              <div key={kind} className="stat-row">
                <span className="stat-row-label">
                  <span className="stat-colour-dot" style={{ background: kindColour(kind) }} />
                  {kindLabels.get(kind) ?? kind}
                </span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Nodes by Namespace</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {nodesByComponent.map(([name, count]) => (
              <div key={name} className="stat-row">
                <span className="stat-row-label">{name}</span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Orphan Nodes by Type</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {stats !== null && orphanRows.length === 0 && <div className="label-sm">No orphan nodes.</div>}
            {orphanRows.map(([name, count]) => {
              const tmpl = templateMap.get(name);
              const colour = tmpl?.ui?.colour ?? 'var(--ink-4)';
              return (
                <div key={name} className="stat-row">
                  <span className="stat-row-label">
                    <span className="stat-colour-dot" style={{ background: colour }} />
                    {tmpl?.ui?.displayName ?? name}
                  </span>
                  <span className="stat-row-value">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Edge Types</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {stats !== null && edgeRows.length === 0 && <div className="label-sm">No semantic edges.</div>}
            {edgeRows.map(([type, count]) => (
              <div key={type} className="stat-row">
                <span className="stat-row-label">
                  <span className="tag" style={EDGE_TYPE_STYLES[type] ?? {}}>{type}</span>
                </span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">State & Stability</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {nodesByState.map(([state, count]) => (
              <div key={state} className="stat-row">
                <span className="stat-row-label"><StateTag state={state} /></span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--rule-2)', margin: '8px 0' }} />
            {nodesByStability.map(([stability, count]) => (
              <div key={stability} className="stat-row">
                <span className="stat-row-label"><StabilityTag stability={stability} /></span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Diagnostics</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {stats !== null && stats.diagnosticCount > 0 && (
              <span style={{ color: 'var(--warn)' }}>
                {stats.diagnosticCount} load warning{stats.diagnosticCount !== 1 ? 's' : ''}
              </span>
            )}
            {stats !== null && stats.diagnosticCount === 0 && (
              <span style={{ color: 'var(--ok)' }}>No issues</span>
            )}
          </div>
        </div>

        {gitMode && (
          <div className="dashboard-panel">
            <div className="card-head">Branch Health</div>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              {branchResults.map(result => (
                <div key={result.ref} className="stat-row">
                  <span className="stat-row-label">
                    <Icon
                      name={result.status === 'loaded' ? 'circle-check' : 'circle-xmark'}
                      size={12}
                    />
                    <span>{result.ref}</span>
                  </span>
                  {result.status === 'failed' && (
                    <span className="label-sm" style={{ color: 'var(--warn)', maxWidth: 200, textAlign: 'right' }}>
                      {result.diagnostics?.[0]?.message ?? result.error ?? 'failed'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NamespacesPage() {
  return <div className="content"><h1>Models</h1></div>;
}

// Generic fallback view for any namespace: owned nodes plus inbound and outbound edges.
// Contains no knowledge of specific kinds; richer views are a separate plugin mechanism.
function NamespacePage({ namespace, nodes, templates, kinds, onNavigate, viewingRef }) {
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setGraph(null);
    setError(null);
    const refParam = viewingRef ? `?ref=${encodeURIComponent(viewingRef)}` : '';
    fetch(`/api/graph${refParam}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(setGraph)
      .catch(err => setError(String(err)));
  }, [namespace, viewingRef]);

  const owned = nodes.filter(node => node.namespace === namespace);
  if (owned.length === 0) {
    return <div className="content"><p className="label-sm">Namespace not found: {namespace}</p></div>;
  }
  const kind = owned[0].kind ?? 'component';
  const kindLabel = (kinds ?? []).find(k => k.id === kind)?.label ?? kind;
  const templateMap = new Map(templates.map(t => [t.name, t]));

  const byTemplate = new Map();
  for (const node of owned) {
    if (!byTemplate.has(node.template)) byTemplate.set(node.template, []);
    byTemplate.get(node.template).push(node);
  }

  const nodeMap = new Map((graph?.nodes ?? []).map(n => [n.id, n]));
  const { inbound, outbound } = namespaceEdges(graph?.edges ?? [], namespace);

  function NodeLink({ id }) {
    const node = nodeMap.get(id);
    const tmpl = node ? templateMap.get(node.template) : null;
    return (
      <span
        role="link" tabIndex={0}
        style={{ cursor: 'pointer' }}
        title={id}
        onClick={() => onNavigate(id)}
        onKeyDown={event => { if (event.key === 'Enter') onNavigate(id); }}
      >
        <span style={{ fontWeight: 500 }}>{displayName(id)}</span>
        {tmpl && <span className="label-sm"> · {templateDisplayName(tmpl)}</span>}
        <span className="label-sm mono"> {id}</span>
      </span>
    );
  }

  function EdgeList({ title, edges, endpoint }) {
    return (
      <div className="card" style={{ marginBottom: 16 }} data-testid={`namespace-${title.toLowerCase()}`}>
        <div className="card-head">{title} ({edges.length})</div>
        <div className="card-body" style={{ padding: '12px 16px' }}>
          {graph === null && !error && <div className="label-sm">Loading…</div>}
          {error && <div style={{ color: 'var(--warn)' }}>Error loading edges: {error}</div>}
          {graph !== null && edges.length === 0 && <div className="label-sm">None.</div>}
          {edges.map(edge => (
            <div key={edge.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
              <span className="tag" style={EDGE_TYPE_STYLES[edge.type] ?? {}}>{edge.type}</span>
              <NodeLink id={edge[endpoint]} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{namespace}</h1>
        <span className="ns-kind-pill" style={{ background: kindColour(kind) }}>{kindLabel}</span>
      </div>
      <div className="label-sm" style={{ marginBottom: 16 }}>Namespace · {owned.length} {owned.length === 1 ? 'node' : 'nodes'}</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">Owned nodes</div>
        <div className="card-body" style={{ padding: '12px 16px' }}>
          {[...byTemplate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([templateName, list]) => (
            <div key={templateName} style={{ marginBottom: 10 }}>
              <div className="label-xs" style={{ marginBottom: 4 }}>{templateDisplayName(templateMap.get(templateName)) || templateName}</div>
              {list.sort((a, b) => a.id.localeCompare(b.id)).map(node => (
                <div key={node.id} style={{ padding: '3px 0' }}><NodeLink id={node.id} /></div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <EdgeList title="Inbound" edges={inbound} endpoint="from" />
      <EdgeList title="Outbound" edges={outbound} endpoint="to" />
    </div>
  );
}

function EdgePanel({ inbound, outbound, allNodes, templates, onNavigate, viewingRef }) {
  const { useState: useLocalState } = React;
  const [open, setOpen] = useLocalState(() => {
    try { return localStorage.getItem('corum:edgePanelOpen') === 'true'; } catch { return false; }
  });

  if (inbound.length === 0 && outbound.length === 0) return null;

  function toggle() {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('corum:edgePanelOpen', String(next)); } catch {}
      return next;
    });
  }

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const templateMap = new Map(templates.map(t => [t.name, t]));

  function EdgeRow({ edge, linkedNodeId }) {
    const node = nodeMap.get(linkedNodeId);
    const tmpl = node ? templateMap.get(node.template) : null;
    const colour = tmpl?.ui?.colour ?? null;
    const name = linkedNodeId.split('.').pop();
    // Match the linked node by its owning cluster root, like node links do.
    const linkedKeys = matchKeysFor(owningRoot(linkedNodeId, nodeMap)?.template ?? node?.template, templateMap);
    return (
      <div
        data-testid="edge-row"
        onClick={() => onNavigate(linkedNodeId)}
        title={linkedNodeId}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}
      >
        <span className="tag" style={EDGE_TYPE_STYLES[edge.type] ?? {}}>{edge.type}</span>
        <TemplateBadge name={tmpl?.ui?.displayName ?? node?.template ?? '?'} colour={colour} />
        <span style={{ fontWeight: 500, fontSize: 13 }}>{name}</span>
        {node && <StateTag state={node.state} />}
        {node && <StabilityTag stability={node.stability} />}
        <span className="quick-links" style={{ marginLeft: 'auto' }}>
          <QuickLinks nodeId={linkedNodeId} keys={linkedKeys} surface="relations" viewingRef={viewingRef} />
        </span>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        className="card-head"
        onClick={toggle}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, userSelect: 'none' }}
      >
        <span>Connections</span>
        {inbound.length > 0 && <span className="label-sm">← {inbound.length} inbound</span>}
        {outbound.length > 0 && <span className="label-sm">→ {outbound.length} outbound</span>}
        <span style={{ marginLeft: 'auto' }}><Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} /></span>
      </div>
      {open && (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 16px' }}>
          {inbound.length > 0 && (
            <div>
              <div className="label-xs" style={{ marginBottom: 8 }}>Inbound</div>
              {inbound.map(edge => <EdgeRow key={edge.id} edge={edge} linkedNodeId={edge.from} />)}
            </div>
          )}
          {outbound.length > 0 && (
            <div>
              <div className="label-xs" style={{ marginBottom: 8 }}>Outbound</div>
              {outbound.map(edge => <EdgeRow key={edge.id} edge={edge} linkedNodeId={edge.to} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

class PluginErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error(`Plugin "${this.props.pluginId}" failed`, error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="content" data-testid="plugin-error">
          <h1>Plugin error</h1>
          <p style={{ color: 'var(--warn)' }}>
            Plugin "{this.props.pluginId}" failed: {this.state.error.message ?? String(this.state.error)}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function PluginMount({ page, hostState }) {
  const ref = React.useRef(null);
  const handleRef = React.useRef(null);
  const [error, setError] = useState(null);
  if (error) throw error;
  if (!handleRef.current) {
    handleRef.current = window.CorumHost.createContext(
      { pluginId: page.pluginId, pageId: page.id },
      hostState,
      setError,
    );
  }
  // Route, param, branch and template changes reach the mounted page through ctx.subscribe; no remount.
  useEffect(() => { handleRef.current.update(hostState); });
  useEffect(() => {
    const dispose = page.mount(ref.current, handleRef.current.ctx);
    return () => { if (typeof dispose === 'function') dispose(); };
  }, []);
  return <div ref={ref} className="plugin-host" data-plugin={page.pluginId} data-page={page.id} />;
}

function PluginUnavailablePage({ pluginId, reason, nodeId, viewingRef }) {
  return (
    <div className="content">
      <h1>Plugin unavailable</h1>
      <p>{reason ?? `Plugin "${pluginId}" is not available.`}</p>
      {nodeId && (
        <p>
          <a href={buildRoute({ pathname: '/node', params: { id: nodeId }, branch: viewingRef })}>
            Open the generic node page
          </a>
        </p>
      )}
    </div>
  );
}

function PluginPage({ route, templates, templatesByName, nodes, viewingRef }) {
  const { id: pluginId, page: pageId } = route.plugin;
  const page = hostRegistry.findPage(pluginId, pageId);
  if (!page) {
    const entry = hostRegistry.plugins().find(plugin => plugin.id === pluginId);
    let reason;
    if (!entry) reason = `Plugin "${pluginId}" is not installed.`;
    else if (entry.status !== 'enabled') reason = `Plugin "${pluginId}" is ${entry.status}${entry.reason ? `: ${entry.reason}` : '.'}`;
    else reason = `Plugin "${pluginId}" has no page "${pageId}".`;
    return (
      <PluginUnavailablePage pluginId={pluginId} reason={reason} nodeId={route.params.get('id')} viewingRef={viewingRef} />
    );
  }
  // Remount only when the plugin, page or viewed branch changes, never for query-param changes.
  const mountKey = `${pluginId}/${pageId}@${viewingRef ?? ''}`;
  const hostState = { route, viewingRef, templates, nodes, templatesByName };
  return (
    <PluginErrorBoundary key={mountKey} pluginId={pluginId}>
      <PluginMount page={page} hostState={hostState} />
    </PluginErrorBoundary>
  );
}

function OpenInMenu({ nodeId, claimants, actions, keys, viewingRef }) {
  const [open, setOpen] = useState(false);
  const wrapRef = React.useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const genericHref = buildRoute({ pathname: '/node', params: { id: nodeId }, branch: viewingRef });
  return (
    <div className="open-in" data-testid="open-in" ref={wrapRef}>
      <button
        type="button"
        className="open-in-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open in"
        title="Open in"
        onClick={() => setOpen(value => !value)}
      >
        <Icon name="ellipsis" size={12} />
      </button>
      {open && (
        <div className="open-in-menu" role="menu">
          {claimants.length > 0 && (
            <a className="open-in-item" role="menuitem" href={genericHref} onClick={() => setOpen(false)}>Default view</a>
          )}
          {claimants.map(claim => (
            <a
              key={`${claim.pluginId}/${claim.id}`}
              className="open-in-item"
              role="menuitem"
              href={hrefForNode(hostRegistry, nodeId, keys, { branch: viewingRef, via: claim.pluginId, page: claim.id })}
              onClick={() => setOpen(false)}
            >
              {claim.title}
            </a>
          ))}
          {claimants.length > 0 && actions.length > 0 && <div className="open-in-sep" role="separator" />}
          {actions.map(action => (
            <a
              key={`${action.pluginId}/${action.id}`}
              className="open-in-item"
              role="menuitem"
              href={hrefForAction(action, nodeId, { branch: viewingRef })}
              onClick={() => setOpen(false)}
            >
              {action.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function NodePage({ nodeId, templates, templatesByName, onNavigate, refreshToken, viewingRef, overlayRefs, compact = true }) {
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
    fetch(`/api/cluster?nodeId=${encodeURIComponent(nodeId)}&includeEdges=maps-to,reads,uses-type,triggers,produces,calls,implements${refParam}${overlayParam}`)
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(setCluster)
      .catch(err => setError(String(err)));
  }, [nodeId, refreshToken, viewingRef, overlayRefs]);

  const rootNode = cluster?.root ?? null;
  const matchKeys = useMemo(
    // Child nodes resolve through their owning cluster root (cluster.owner), like roots do.
    () => (rootNode ? matchKeysFor(cluster.owner?.template ?? rootNode.template, templatesByName) : []),
    [rootNode, cluster, templatesByName],
  );
  const target = useMemo(
    () => (matchKeys.length > 0 ? resolveNodeTarget(hostRegistry, matchKeys) : { kind: 'generic' }),
    [matchKeys],
  );

  useEffect(() => {
    if (target.kind !== 'page') return;
    location.replace(buildRoute({
      pathname: `/p/${target.pluginId}/${target.pageId}`,
      params: { id: rootNode.id },
      branch: viewingRef,
    }));
  }, [target, rootNode, viewingRef]);

  if (!nodeId) return <div className="content"><p className="label-sm">No node selected.</p></div>;
  if (error) return <div className="content"><p style={{ color: 'var(--warn)' }}>Error loading node: {error}</p></div>;
  if (!cluster || target.kind === 'page') return <div className="content"><p className="label-sm">Loading...</p></div>;

  const claimants = target.kind === 'chooser' ? target.claimants : [];
  const nodeActions = hostRegistry.nodeActionsFor(matchKeys);

  const { root, descendants, includedNodes, edges } = cluster;
  const clusterIds = new Set([root.id, ...descendants.map(d => d.id)]);
  const { inbound: panelInbound, outbound: panelOutbound } = classifyEdges(edges, clusterIds);
  const template = templates.find(item => item.name === root.template);
  const colour = template?.ui?.colour ?? null;
  const nestedSections = new Set((template?.ui?.nav?.nestOwned ?? []).map(item => item.section));

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
  // includedNodes now contains only directly-connected external nodes:
  // - Schema / EnumDefinition: with structural children (fields/values) and referenced types
  // - All other templates (DomainEvent, Command, etc.): root metadata only for connectivity panel
  // This is computed server-side via expandExternalNodes, so no client-side filtering is needed.
  const includedSchemaNodes = includedNodes.filter(n => n.template === 'Schema' && !n.parentId);
  const includedEnumNodes = includedNodes.filter(n => n.template === 'EnumDefinition' && !n.parentId);

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
        <div data-testid="node-title-row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{displayName(root.id)}</h1>
          <TemplateBadge name={templateDisplayName(template)} colour={colour} />
          <StateTag state={root.state} />
          <StabilityTag stability={root.stability} />
          <QuickLinks nodeId={root.id} keys={matchKeys} surface="header" viewingRef={viewingRef} />
          {(claimants.length > 0 || nodeActions.length > 0) && (
            <OpenInMenu nodeId={root.id} claimants={claimants} actions={nodeActions} keys={matchKeys} viewingRef={viewingRef} />
          )}
        </div>
        <div className="label-sm mono">{root.id}</div>
      </div>

      <EdgePanel
        inbound={panelInbound}
        outbound={panelOutbound}
        allNodes={[root, ...descendants, ...includedNodes]}
        templates={templates}
        onNavigate={onNavigate}
        viewingRef={viewingRef}
      />

      <div className="meta-strip">
        {[
          ['Namespace', root.namespace],
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
  const [kinds, setKinds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 780px)').matches);
  const retainedNode = React.useRef(null);
  const listPane = React.useRef(null);
  const detailPane = React.useRef(null);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [allTemplates, setAllTemplates] = useState([]);
  const [hostReady, setHostReady] = useState(false);

  useEffect(() => {
    window.CorumHost.ready.then(() => setHostReady(true));
  }, []);

  const nodesById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const templatesByName = useMemo(() => new Map(allTemplates.map(template => [template.name, template])), [allTemplates]);

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
      fetch(`/api/templates?includeCore=true${targetViewingRef ? `&ref=${encodeURIComponent(targetViewingRef)}` : ''}`).then(response => response.ok ? response.json() : Promise.reject(response.status)),
      fetch(`/api/nodes${refParam}`).then(response => response.ok ? response.json() : Promise.reject(response.status)),
      fetch(`/api/kinds${refParam}`).then(response => response.ok ? response.json() : Promise.reject(response.status)),
    ])
      .then(([templateData, allTemplateData, nodeData, kindData]) => {
        setTemplates(resolveTemplates(templateData));
        setAllTemplates(allTemplateData);
        setNodes(nodeData);
        setKinds(kindData.kinds ?? []);
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
    // The plugin registry is built once at boot, so a changed plugin list needs a full page reload.
    const onGraphReloaded = () => {
      window.CorumHost.pluginsChangedOnServer().then(changed => {
        if (changed) location.reload();
      });
      refreshAllData();
    };
    eventSource.addEventListener('graph-reloaded', onGraphReloaded);
    return () => {
      eventSource.removeEventListener('graph-reloaded', onGraphReloaded);
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
    let previous = parseRoute(window.location.hash);
    function syncHistory(next) {
      if (matchMedia('(max-width: 780px)').matches && (next.pathname === '/node' || next.pathname === '/namespace') && !history.state?.corumDetail) {
        // Seed a list entry behind direct links and nodes opened from other sections.
        const hash = location.hash;
        history.replaceState(null, '', buildRoute({ pathname: '/namespaces', branch: next.branch }));
        history.pushState({ corumDetail: true }, '', hash);
      }
    }
    syncHistory(previous);
    const handler = () => {
      const next = parseRoute(location.hash);
      if ((next.pathname === '/node' || next.pathname === '/namespace') && previous.pathname === '/namespaces') {
        history.replaceState({ corumDetail: true }, '');
      } else {
        syncHistory(next);
      }
      previous = next;
      setRoute(next);
    };
    const query = matchMedia('(max-width: 780px)');
    const resize = () => {
      setMobile(query.matches);
      syncHistory(parseRoute(location.hash));
    };
    query.addEventListener('change', resize);
    window.addEventListener('hashchange', handler);
    return () => {
      window.removeEventListener('hashchange', handler);
      query.removeEventListener('change', resize);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeNodeId = route.pathname === '/node' ? route.params.get('id') : null;
  if (activeNodeId) retainedNode.current = activeNodeId;
  const detailOpen = route.pathname === '/node' || route.pathname === '/namespace';
  const activeNamespace = route.pathname === '/namespace' ? route.params.get('name') : null;
  const activeSection = activeNodeId || activeNamespace
    ? 'namespaces'
    : route.plugin
      ? `plugin:${route.plugin.id}/${route.plugin.page}`
      : (route.pathname.slice(1) || 'dashboard');
  const pluginPages = hostReady ? hostRegistry.pages() : [];
  const navTree = useMemo(() => buildNavTree(nodes, templates), [nodes, templates]);
  const kindSections = useMemo(() => groupNamespacesByKind(nodes, kinds), [nodes, kinds]);
  const showTree = activeSection === 'namespaces' || activeNodeId;
  useEffect(() => {
    if (!mobile || !showTree) return;
    const pane = detailOpen ? detailPane.current : listPane.current;
    let frame;
    const observer = new MutationObserver(focusTarget);
    function focusTarget() {
      const target = pane?.querySelector(detailOpen ? 'h1' : '.nav-node-item.active');
      if (!target) return;
      target.tabIndex = detailOpen ? -1 : 0;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) {
        observer.disconnect();
      } else {
        // Visibility may still be changing as the pane starts its transition.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(focusTarget);
      }
    }
    // Node headings arrive asynchronously after the cluster request.
    if (pane) observer.observe(pane, { childList: true, subtree: true });
    focusTarget();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [mobile, detailOpen, activeNodeId, showTree]);

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

  function handleSection(section, pluginPage) {
    const pathname = pluginPage ? `/p/${pluginPage.pluginId}/${pluginPage.id}` : `/${section}`;
    navigate(buildRoute({ pathname, params: {}, branch: viewingRef }));
  }

  function handleNamespace(name) {
    navigate(buildRoute({ pathname: '/namespace', params: { name }, branch: viewingRef }));
  }

  function handleNode(nodeId) {
    navigate(buildRoute({ pathname: '/node', params: { id: nodeId }, branch: viewingRef }));
  }

  function handleSearchNode(nodeId, templateName) {
    const root = owningRoot(nodeId, nodesById);
    navigate(hrefForNode(hostRegistry, nodeId, matchKeysFor(root?.template ?? templateName, templatesByName), { branch: viewingRef }));
  }

  let page;
  if (loading || !hostReady) {
    page = <div className="content"><p className="label-sm">Loading graph...</p></div>;
  } else if (error) {
    page = <div className="content"><p style={{ color: 'var(--warn)' }}>Error loading graph: {error}</p></div>;
  } else if (route.pathname === '/dashboard' || route.pathname === '/') {
    page = (
      <DashboardPage
        nodes={nodes}
        templates={templates}
        kinds={kinds}
        gitMode={gitMode}
        viewingRef={viewingRef}
        branches={branches}
        branchResults={branchResults}
      />
    );
  } else if (route.pathname === '/namespaces') {
    page = <NamespacesPage />;
  } else if (route.pathname === '/namespace') {
    page = (
      <NamespacePage
        key={activeNamespace}
        namespace={activeNamespace}
        nodes={nodes}
        templates={templates}
        kinds={kinds}
        onNavigate={handleNode}
        viewingRef={viewingRef}
      />
    );
  } else if (route.pathname === '/node') {
    page = (
      <NodePage
        key={activeNodeId}
        nodeId={activeNodeId}
        templates={templates}
        templatesByName={templatesByName}
        onNavigate={handleNode}
        refreshToken={refreshToken}
        viewingRef={viewingRef}
        overlayRefs={activeOverlayRefs}
        compact={!debugMode}
      />
    );
  } else if (route.plugin) {
    page = <PluginPage route={route} templates={templates} templatesByName={templatesByName} nodes={nodes} viewingRef={viewingRef} />;
  } else {
    page = <div className="content"><p className="label-sm">Page not found.</p></div>;
  }

  return (
    <>
      {searchOpen && (
        <SearchModal
          nodes={nodes}
          templates={templates}
          onNavigate={handleSearchNode}
          onClose={() => setSearchOpen(false)}
        />
      )}
      <TopBar onSearchOpen={() => setSearchOpen(true)} />
      {hostReady && window.CorumHost.pluginsFailed && (
        <div
          data-testid="plugins-failed"
          role="status"
          style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 50, padding: '8px 12px', background: 'var(--paper-3)', border: '1px solid var(--rule-2)', borderRadius: 6, fontSize: 12, color: 'var(--warn)' }}
        >
          Plugins failed to load. Reload the page to retry.
        </div>
      )}
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
      <div className={`main${showTree ? ' master-detail' : ''}${detailOpen ? ' detail-open' : ''}`}>
        <div
          className="list-pane" ref={listPane}
          inert={mobile && showTree && detailOpen ? '' : undefined}
          aria-hidden={mobile && showTree && detailOpen ? true : undefined}
        >
          <NavRail activeSection={activeSection} onSection={handleSection} pluginPages={pluginPages} debugMode={debugMode} onDebugMode={handleDebugMode} />
          {mobile && showTree && !detailOpen && (loading || error) && page}
          {showTree && !loading && !error && (
            <NavTree
              navTree={navTree}
              kindSections={kindSections}
              templates={templates}
              activeNodeId={activeNodeId || retainedNode.current}
              onNode={handleNode}
              onNamespace={handleNamespace}
              overlayIndicatorIds={overlayIndicatorIds}
            />
          )}
        </div>
        <div
          className="detail-pane" ref={detailPane}
          inert={mobile && showTree && !detailOpen ? '' : undefined}
          aria-hidden={mobile && showTree && !detailOpen ? true : undefined}
        >
          {showTree && (
            <button type="button" className="mobile-back" onClick={() => history.back()}>
              <span aria-hidden="true">←</span> Back to models
            </button>
          )}
          {page}
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
