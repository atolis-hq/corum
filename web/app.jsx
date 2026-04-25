/* Main app: router, nav shell, data loading, and node pages. */

const { useState, useEffect } = React;
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
const { buildNavTree } = window.CorumNav;

function parseRoute() {
  const hash = window.location.hash.slice(1) || '/dashboard';
  const [pathname, search] = hash.split('?');
  return { pathname, params: new URLSearchParams(search) };
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

function NavRail({ activeSection, onSection }) {
  const items = [
    { id: 'dashboard', icon: 'table-cells', label: 'Dashboard' },
    { id: 'components', icon: 'cube', label: 'Models' },
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
    </div>
  );
}

function NavTree({ navTree, templates, activeNodeId, onNode }) {
  const sortedComponents = [...navTree.keys()].sort((a, b) => a.localeCompare(b));
  const [openComponent, setOpenComponent] = useState();
  const templateMap = new Map(templates.map(template => [template.name, template]));

  useEffect(() => {
    if (openComponent === undefined) {
      setOpenComponent(sortedComponents[0] ?? null);
      return;
    }
    if (openComponent !== null && !navTree.has(openComponent)) {
      setOpenComponent(sortedComponents[0] ?? null);
    }
  }, [navTree, openComponent, sortedComponents]);

  function toggleComponent(component) {
    setOpenComponent(prev => prev === component ? null : component);
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
                return (
                  <div key={entry.groupTemplateName}>
                    <div className="nav-template-head">
                      {entry.icon && (
                        <i
                          className={`fa-solid fa-${entry.icon}`}
                          style={{ fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}
                        />
                      )}
                      <span>{entry.label}</span>
                    </div>
                    {entry.children.map(child => (
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
              return (
                <div key={entry.templateName}>
                  <div className="nav-template-head">
                    <i
                      className={`fa-solid fa-${template?.ui?.icon ?? 'circle'}`}
                      style={{ fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}
                    />
                    <span>{templateDisplayName(template)}</span>
                  </div>
                  {entry.nodes.map(node => {
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

function DashboardPage() {
  return <div className="content"><h1>Dashboard</h1></div>;
}

function ComponentsPage() {
  return <div className="content"><h1>Components</h1></div>;
}

function NodePage({ nodeId, templates, onNavigate }) {
  const [cluster, setCluster] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!nodeId) return;
    setCluster(null);
    setError(null);
    fetch(`/api/cluster?nodeId=${encodeURIComponent(nodeId)}&includeEdges=maps-to`)
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(setCluster)
      .catch(err => setError(String(err)));
  }, [nodeId]);

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
  ]);
  const rootSpecializedTemplates = new Set(['Schema', 'EnumDefinition']);
  const rootSpecializedNodes = rootSpecializedTemplates.has(root.template) ? [[root.template, [root]]] : [];
  const childDisplayEntries = [...displayChildren.entries()]
    .filter(([templateName]) => templateName !== 'Field' && templateName !== 'EnumValue');
  const displayEntries = [...rootSpecializedNodes, ...childDisplayEntries];

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
            <PropertiesTable properties={root.properties} onNavigate={handlePropertyNavigate} />
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
          />
        ))}
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
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    Promise.all([
      fetch('/api/templates').then(response => response.json()),
      fetch('/api/nodes').then(response => response.json()),
    ])
      .then(([templateData, nodeData]) => {
        setTemplates(resolveTemplates(templateData));
        setNodes(nodeData);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const activeNodeId = route.pathname === '/node' ? route.params.get('id') : null;
  const activeSection = activeNodeId ? 'components' : (route.pathname.slice(1) || 'dashboard');
  const navTree = buildNavTree(nodes, templates);
  const showTree = activeSection === 'components' || activeNodeId;

  function handleSection(section) {
    navigate(`/${section}`);
  }

  function handleNode(nodeId) {
    navigate(`/node?id=${encodeURIComponent(nodeId)}`);
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
    page = <NodePage nodeId={activeNodeId} templates={templates} onNavigate={handleNode} />;
  } else {
    page = <div className="content"><p className="label-sm">Page not found.</p></div>;
  }

  return (
    <>
      <TopBar />
      <div className="main">
        <NavRail activeSection={activeSection} onSection={handleSection} />
        {showTree && !loading && !error && (
          <NavTree
            navTree={navTree}
            templates={templates}
            activeNodeId={activeNodeId}
            onNode={handleNode}
          />
        )}
        {page}
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
