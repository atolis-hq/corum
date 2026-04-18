/* Main app: router, nav shell, data loading, and node pages. */

const { useState, useEffect } = React;
const {
  BrandMark,
  Icon,
  StateTag,
  StabilityTag,
  TemplateBadge,
  PropertiesTable,
  SchemaCard,
} = window.CorumPrimitives;

function parseRoute() {
  const hash = window.location.hash.slice(1) || '/dashboard';
  const [pathname, search] = hash.split('?');
  return { pathname, params: new URLSearchParams(search) };
}

function navigate(path) {
  window.location.hash = path;
}

function displayName(id) {
  const parts = id.split('.');
  return parts[parts.length - 1];
}

function buildNavTree(nodes) {
  const tree = new Map();
  for (const node of nodes) {
    if (!tree.has(node.component)) tree.set(node.component, new Map());
    const component = tree.get(node.component);
    if (!component.has(node.template)) component.set(node.template, []);
    component.get(node.template).push(node);
  }
  for (const groups of tree.values()) {
    for (const groupNodes of groups.values()) {
      groupNodes.sort((a, b) => a.id.localeCompare(b.id));
    }
  }
  return tree;
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
    { id: 'dashboard', icon: 'grid', label: 'Dashboard' },
    { id: 'components', icon: 'cube', label: 'Components' },
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
  const [openComponents, setOpenComponents] = useState(() => {
    const initial = {};
    for (const component of navTree.keys()) initial[component] = true;
    return initial;
  });
  const templateMap = new Map(templates.map(template => [template.name, template]));

  function toggleComponent(component) {
    setOpenComponents(prev => ({ ...prev, [component]: !prev[component] }));
  }

  if (navTree.size === 0) {
    return <div className="nav-tree"><div className="empty-state">No graph nodes loaded.</div></div>;
  }

  return (
    <div className="nav-tree">
      {[...navTree.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([component, templateGroups]) => (
        <div key={component}>
          <div className="nav-section-head" onClick={() => toggleComponent(component)}>
            <span>{component}</span>
            <Icon name={openComponents[component] ? 'caret-down' : 'caret'} size={12} />
          </div>
          {openComponents[component] && [...templateGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([templateName, nodes]) => {
            const template = templateMap.get(templateName);
            const colour = template?.ui?.colour ?? 'var(--ink-4)';
            return (
              <div key={templateName}>
                <div className="nav-template-head">
                  <div className="nav-template-accent" style={{ background: colour }} />
                  <span>{templateName}</span>
                </div>
                {nodes.map(node => (
                  <div
                    key={node.id}
                    className={`nav-node-item${node.id === activeNodeId ? ' active' : ''}`}
                    onClick={() => onNode(node.id)}
                    title={node.id}
                  >
                    {displayName(node.id)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DashboardPage() {
  return <div className="content"><h1>Dashboard</h1></div>;
}

function ComponentsPage() {
  return <div className="content"><h1>Components</h1></div>;
}

function NodePage({ nodeId, templates }) {
  const [cluster, setCluster] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!nodeId) return;
    setCluster(null);
    setError(null);
    fetch(`/api/cluster?nodeId=${encodeURIComponent(nodeId)}`)
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(setCluster)
      .catch(err => setError(String(err)));
  }, [nodeId]);

  if (!nodeId) return <div className="content"><p className="label-sm">No node selected.</p></div>;
  if (error) return <div className="content"><p style={{ color: 'var(--warn)' }}>Error loading node: {error}</p></div>;
  if (!cluster) return <div className="content"><p className="label-sm">Loading...</p></div>;

  const { root, children } = cluster;
  const template = templates.find(item => item.name === root.template);
  const colour = template?.ui?.colour ?? null;
  const Plugin = window.CorumPlugins?.[root.template];
  if (Plugin) return <Plugin node={root} cluster={cluster} template={template} />;

  const displayChildren = new Map();
  for (const child of children) {
    if (!displayChildren.has(child.template)) displayChildren.set(child.template, []);
    displayChildren.get(child.template).push(child);
  }

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{displayName(root.id)}</h1>
          <TemplateBadge name={root.template} colour={colour} />
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
            <PropertiesTable properties={root.properties} />
          </div>
        </div>
      )}

      {[...displayChildren.entries()].map(([templateName, groupNodes]) => (
        <SchemaCard key={templateName} title={templateName} nodes={groupNodes} />
      ))}
    </div>
  );
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
        setTemplates(templateData);
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
  const navTree = buildNavTree(nodes);
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
    page = <NodePage nodeId={activeNodeId} templates={templates} />;
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
