/* Shell: top bar, tabs, branch bar, nav, tweaks */

function BrandMark({ size = 24, color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 110 110" width={size} height={size} className="brand-mark" style={{ color }}>
      <g transform="translate(55 55)" stroke={color} fill={color} strokeLinecap="round">
        <path d="M43.8 3.8A44 44 0 0 1 38.1 22" fill="none" strokeWidth="7.5" opacity="0.55"/>
        <path d="M38.1 22a44 44 0 1 1-19.5-61" fill="none" strokeWidth="7.5"/>
        <circle r="3" opacity="0.3"/>
        <circle r="1.8"/>
        <path strokeWidth="3" d="M0 0v-26"/><circle cy="-26" r="4.5" opacity="0.85"/>
        <path strokeWidth="3" d="m0 0 13-22"/><circle cx="13" cy="-22" r="3.5" opacity="0.78"/>
        <path strokeWidth="3" d="m0 0 23-9"/><circle cx="23" cy="-9" r="4" opacity="0.72"/>
        <path strokeWidth="2.5" opacity="0.7" d="m0 0 21 11"/><circle cx="21" cy="11" r="3" opacity="0.6"/>
        <path strokeWidth="2.5" opacity="0.55" d="m0 0 9 23"/><circle cx="9" cy="23" r="3.5" opacity="0.5"/>
        <path strokeWidth="2.5" opacity="0.55" d="m0 0-11 22"/><circle cx="-11" cy="22" r="3" opacity="0.48"/>
        <path strokeWidth="3" d="m0 0-26 3"/><circle cx="-26" cy="3" r="4" opacity="0.75"/>
        <path strokeWidth="3" d="m0 0-20-17"/><circle cx="-20" cy="-17" r="4.5" opacity="0.85"/>
        <path strokeWidth="2" opacity="0.66" d="m0 0-8-23"/><circle cx="-8" cy="-23" r="3" opacity="0.62"/>
      </g>
    </svg>
  );
}

function TopBar({ tab }) {
  return (
    <div className="topbar">
      <div className="brand">
        <BrandMark size={22} color="#ffffff"/>
        <span>corum</span>
      </div>
      <div className="label-sm mono" style={{ paddingLeft: 4, borderLeft: '1px solid rgba(255,255,255,0.25)', marginLeft: 4 }}>acme/payments-graph</div>
      <div style={{ flex: 1 }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="box" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', minWidth: 240 }}>
          <Icon name="search" size={12}/>
          <span className="label-sm">Search graph…</span>
          <div style={{ flex: 1 }}/>
          <span className="mono label-sm" style={{ opacity: 0.75 }}>⌘K</span>
        </div>
        <button className="btn ghost"><Icon name="bell" size={12}/></button>
        <div className="chip">you</div>
      </div>
    </div>
  );
}

function SceneNav({ tab, setTab, tweaks, theme, setTheme }) {
  const scenes = [
    { id: 'overview', icon: 'graph', label: 'Dashboard' },
    { id: 'components', icon: 'cube', label: 'Components', count: 34 },
    { id: 'perspective', icon: 'api', label: 'POST /orders', sub: true },
    { id: 'journeys', icon: 'journey', label: 'User Journeys', count: 8 },
    { id: 'delivery-placeholder', icon: 'delivery', label: 'Delivery', count: 12, disabled: true },
    { id: 'branching', icon: 'branch', label: 'Branching & overlays' },
    { id: 'explorer', icon: 'graph', label: 'Graph Explorer', ghost: true },
  ];
  const showTree = tab === 'components' || tab === 'perspective';

  if (tweaks && tweaks.nav === 'twopane') {
    return (
      <aside style={{ display: 'flex', minHeight: '100%', borderRight: '1px dashed var(--rule-2)' }}>
        <div style={{ width: 72, background: 'var(--paper-2)', borderRight: '1px dashed var(--rule-2)', padding: '10px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {scenes.filter(s => !s.sub).map(s => (
            <div key={s.id} title={s.label} onClick={() => !s.disabled && setTab(s.id)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '8px 4px', borderRadius: 6,
              background: tab === s.id ? 'var(--ink)' : 'transparent',
              color: tab === s.id ? 'var(--paper)' : (s.ghost || s.disabled ? 'var(--ink-4)' : 'var(--ink-2)'),
              cursor: s.disabled ? 'default' : 'pointer', opacity: s.ghost ? 0.6 : 1
            }}>
              <Icon name={s.icon} size={16}/>
              <span style={{ fontSize: 9.5, letterSpacing: '0.04em', textAlign: 'center', lineHeight: 1.1 }}>{s.label.split(' ')[0]}</span>
            </div>
          ))}
          <div style={{ flex: 1 }}/>
          <NavFooter theme={theme} setTheme={setTheme} compact/>
        </div>
        {showTree && (
          <div className="navcol" style={{ borderRight: 'none', width: 220, minWidth: 220, display: 'flex', flexDirection: 'column' }}>
            <div className="navhead" style={{ padding: '4px 6px 8px' }}><span>Components</span><span className="count">34</span></div>
            <NavTree setTab={setTab} activeScene={tab}/>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="navcol" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>
        <div className="navsection">
          <div className="navhead"><span>Sections</span></div>
          {scenes.filter(s => !s.sub).map(s => (
            <div key={s.id}
                 className={'navitem' + (tab === s.id ? ' active' : '')}
                 onClick={() => !s.disabled && setTab(s.id)}
                 style={{ cursor: s.disabled ? 'default' : 'pointer', opacity: s.ghost ? 0.6 : 1 }}>
              <Icon name={s.icon}/>
              <span>{s.label}</span>
              {s.count != null && <span className="count">{s.count}</span>}
              {s.ghost && <span className="count label-sm">soon</span>}
            </div>
          ))}
        </div>
        {showTree && <NavTree setTab={setTab} activeScene={tab}/>}
      </div>
      <NavFooter theme={theme} setTheme={setTheme}/>
    </aside>
  );
}

function NavFooter({ theme, setTheme, compact }) {
  const isDark = theme === 'dark';
  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', paddingTop: 8, borderTop: '1px dashed var(--rule-2)' }}>
        <button className="btn ghost" onClick={() => setTheme(isDark ? 'light' : 'dark')} title={isDark ? 'Switch to light' : 'Switch to dark'} style={{ padding: 6, width: 32, height: 32, display: 'grid', placeItems: 'center' }}>
          <Icon name={isDark ? 'sun' : 'moon'} size={14}/>
        </button>
        <button className="btn ghost" title="Settings" style={{ padding: 6, width: 32, height: 32, display: 'grid', placeItems: 'center' }}>
          <Icon name="gear" size={14}/>
        </button>
      </div>
    );
  }
  return (
    <div style={{ paddingTop: 10, marginTop: 10, borderTop: '1px dashed var(--rule-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="navitem" onClick={() => setTheme(isDark ? 'light' : 'dark')} style={{ cursor: 'pointer' }}>
        <Icon name={isDark ? 'sun' : 'moon'}/>
        <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
        <span className="count mono" style={{ fontSize: 9.5 }}>⌥T</span>
      </div>
      <div className="navitem" style={{ cursor: 'pointer' }}>
        <Icon name="gear"/>
        <span>Settings</span>
      </div>
      <div className="navitem" style={{ cursor: 'pointer' }}>
        <Icon name="book"/>
        <span>Docs</span>
      </div>
      <div style={{ padding: '8px 8px 2px', fontSize: 10.5, color: 'var(--ink-4)', fontFamily: 'JetBrains Mono, monospace' }}>corum v0.1 · wireframes</div>
    </div>
  );
}

function BranchBar({ mode, setMode, selected, setSelected }) {
  return (
    <div className="branchbar">
      <Icon name="branch" size={13} />
      <span className="label-xs">Viewing</span>
      <Chip variant="active">main</Chip>
      {mode !== 'single' && (
        <>
          <span className="label-sm" style={{ color: 'var(--ink-4)' }}>overlaid with</span>
          <Chip variant="accent">feat/checkout-v2</Chip>
          {mode === 'all' && <Chip variant="accent">feat/loyalty-api</Chip>}
          {mode === 'all' && <Chip variant="accent">exp/events-redux</Chip>}
        </>
      )}
      <div style={{ flex: 1 }}/>
      <span className="label-xs">Mode</span>
      <Seg
        options={[
          { value: 'single', label: 'Single branch' },
          { value: 'selected', label: 'Selected' },
          { value: 'all', label: 'Consolidated (all)' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <button className="btn ghost"><Icon name="filter" size={11}/> pick branches</button>
    </div>
  );
}

function NavTree({ setTab, activeScene }) {
  const goPerspective = () => setTab && setTab('perspective');
  const isActive = activeScene === 'perspective';
  return (
    <>
      <div className="navsection">
        <div className="navhead"><span>orders</span><Icon name="caret-down" /></div>
        <div className="navitem sub"><Icon name="api" /><span>API Endpoints</span><span className="count">6</span></div>
        <div className="navitem sub2" onClick={goPerspective} style={{ cursor: 'pointer', color: isActive ? 'var(--paper)' : undefined, background: isActive ? 'var(--ink)' : undefined }}>POST /orders</div>
        <div className="navitem sub2">GET /orders/{'{id}'}</div>
        <div className="navitem sub2">PATCH /orders/{'{id}'}</div>
        <div className="navitem sub"><Icon name="model" /><span>Domain Models</span><span className="count">4</span></div>
        <div className="navitem sub2">Order</div>
        <div className="navitem sub2">OrderLine</div>
        <div className="navitem sub"><Icon name="event" /><span>Domain Events</span><span className="count">3</span></div>
        <div className="navitem sub2">OrderPlaced</div>
        <div className="navitem sub2">OrderCancelled</div>
        <div className="navitem sub"><Icon name="event" /><span>Integration Events</span><span className="count">2</span></div>
        <div className="navitem sub"><Icon name="model" /><span>Read Models</span><span className="count">3</span></div>
      </div>
      <div className="navsection"><div className="navhead"><span>customers</span><Icon name="caret" /></div></div>
      <div className="navsection"><div className="navhead"><span>catalog</span><Icon name="caret" /></div></div>
      <div className="navsection"><div className="navhead"><span>billing</span><Icon name="caret" /></div></div>
    </>
  );
}

function TweaksPanel({ tweaks, setTweak }) {
  return (
    <div className="tweaks">
      <h4>Tweaks</h4>
      <div className="row-t">
        <label>Fidelity</label>
        <Seg
          options={[{ value: 'clean', label: 'Clean' }, { value: 'sketchy', label: 'Sketchy' }]}
          value={tweaks.fidelity}
          onChange={v => setTweak('fidelity', v)}
        />
      </div>
      <div className="row-t">
        <label>Nav grouping</label>
        <Seg
          options={[{ value: 'tree', label: 'Tree' }, { value: 'twopane', label: '2-pane' }]}
          value={tweaks.nav}
          onChange={v => setTweak('nav', v)}
        />
      </div>
      <div className="row-t">
        <label>Branch overlay</label>
        <Seg
          options={[
            { value: 'ghost', label: 'Ghost' },
            { value: 'diff', label: 'Diff' },
            { value: 'split', label: 'Split' },
          ]}
          value={tweaks.overlay}
          onChange={v => setTweak('overlay', v)}
        />
      </div>
      <div className="row-t">
        <label>Lineage style</label>
        <Seg
          options={[
            { value: 'inline', label: 'Inline' },
            { value: 'peek', label: 'Peek' },
            { value: 'mini', label: 'Mini-graph' },
          ]}
          value={tweaks.lineage}
          onChange={v => setTweak('lineage', v)}
        />
      </div>
      <div className="row-t">
        <label>Signals</label>
        <Seg
          options={[
            { value: 'gutter', label: 'Gutter' },
            { value: 'stacked', label: 'Stacked' },
            { value: 'rail', label: 'Rail' },
          ]}
          value={tweaks.signals}
          onChange={v => setTweak('signals', v)}
        />
      </div>
    </div>
  );
}

/* SVG filter used by sketchy mode */
function SketchyFilter() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="wobble">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3"/>
        <feDisplacementMap in="SourceGraphic" scale="0.9"/>
      </filter>
    </svg>
  );
}

Object.assign(window, { TopBar, BranchBar, SceneNav, TweaksPanel, SketchyFilter });
