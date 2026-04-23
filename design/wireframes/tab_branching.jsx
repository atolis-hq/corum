/* Tab 4 — Branching & overlay mechanics */

function TabBranching({ tweaks }) {
  const mode = tweaks.overlay;
  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <div className="content" style={{ flex: 1 }}>
        <div className="pagehead">
          <div>
            <h1>Branching & overlays</h1>
            <div className="sub">The main view is <b>current branch + incoming</b> from other branches. Ghost is the default; flip to rich diff when reviewing.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Chip variant="active">main</Chip>
            <Chip variant="accent">feat/checkout-v2</Chip>
            <Chip variant="accent">feat/loyalty-api</Chip>
            <Chip variant="ghost">+ 2 more</Chip>
          </div>
        </div>

        {/* Branch switcher explanation */}
        <div className="box-fill" style={{ padding: 16, marginBottom: 18 }}>
          <div className="hand" style={{ fontSize: 24, marginBottom: 6 }}>Branch bar (persistent, top of app)</div>
          <div className="label-sm" style={{ marginBottom: 10 }}>Always visible. Three modes: Single branch · Selected subset · Consolidated (all in-flight). Selection persists across session.</div>
          <div className="branchbar" style={{ border: '1px dashed var(--rule-2)', borderRadius: 6 }}>
            <Icon name="branch" size={13}/>
            <span className="label-xs">Viewing</span>
            <Chip variant="active">main</Chip>
            <span className="label-sm">overlaid with</span>
            <Chip variant="accent">feat/checkout-v2</Chip>
            <Chip variant="accent">feat/loyalty-api</Chip>
            <div style={{ flex: 1 }}/>
            <Seg options={[{value:'s',label:'Single'},{value:'x',label:'Selected'},{value:'a',label:'Consolidated'}]} value="x" onChange={()=>{}}/>
          </div>
        </div>

        {/* Variant cards */}
        <div className="label-xs" style={{ marginBottom: 8 }}>Overlay rendering modes — <b>ghost</b> is the default (clean view of current state with incoming items alongside). Rich diff is a review-mode toggle; split is a fallback for heavy divergence. Currently: <b>{mode}</b></div>

        <div className="g-3" style={{ alignItems: 'stretch' }}>
          <OverlayVariant kind="ghost" active={mode==='ghost'} primary/>
          <OverlayVariant kind="diff" active={mode==='diff'}/>
          <OverlayVariant kind="split" active={mode==='split'}/>
        </div>

        {/* Large focused example */}
        <div style={{ height: 22 }}/>
        <div className="panel-h" style={{ border: '1px solid var(--rule-2)', borderRadius: '8px 8px 0 0', borderBottom: 'none' }}>
          <h2>Example · <span className="mono">Order</span> domain model with overlay = {mode}</h2>
          <div className="label-sm">changes shown relative to <span className="mono">main</span></div>
        </div>
        <div className="box-fill" style={{ padding: 0, borderRadius: '0 0 8px 8px' }}>
          {mode === 'ghost' && <OverlayGhost/>}
          {mode === 'diff' && <OverlayDiff/>}
          {mode === 'split' && <OverlaySplit/>}
        </div>

        {/* Collision callout */}
        <div style={{ height: 18 }}/>
        <div className="box-accent" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <SigDot kind="collision"/>
            <div>
              <div className="hand" style={{ fontSize: 22, color: 'var(--ink)' }}>Collision surfaces naturally in consolidated mode</div>
              <div className="label-sm">Two branches touched <span className="mono">Order.totalAmount</span>: <span className="mono">feat/checkout-v2</span> renamed it to <span className="mono">total</span>; <span className="mono">exp/events-redux</span> changed its type to <span className="mono">string</span>. Flag appears in the signal feed until reconciled.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverlayVariant({ kind, active, primary }) {
  const copy = {
    ghost: { t: 'Ghost (default)', d: 'Current branch is solid; fields present only in other branches render ghosted with a colored left stripe. Click to pull a ghosted field into this branch. Conflicts between branches are flagged inline.' },
    diff: { t: 'Rich diff (review toggle)', d: 'Added / changed / removed fields call out inline with green / amber / red. Toggle on when doing review work; not the default view.' },
    split: { t: 'Split pane (heavy divergence)', d: 'Each branch gets its own column. Use only when branches have diverged enough that ghost overlay gets noisy.' },
  }[kind];
  return (
    <div className="card" style={{ outline: active ? '2px solid var(--accent)' : 'none', position: 'relative' }}>
      {primary && <div style={{ position: 'absolute', top: -8, left: 12, background: 'var(--ink)', color: 'var(--paper)', fontSize: 9.5, letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 3 }}>PRIMARY</div>}
      <h3>{copy.t}</h3>
      <div className="label-sm" style={{ minHeight: 56 }}>{copy.d}</div>
      <div className="hr-d"/>
      <div className="box" style={{ padding: 8, fontSize: 11 }}>
        {kind === 'ghost' && (
          <>
            <div className="stripe-left" style={{ padding: '4px 8px' }}><span className="mono">total</span> <span className="label-sm">decimal · current</span></div>
            <div className="stripe-left b2 overlay-ghost" style={{ padding: '4px 8px', marginTop: 4 }}><span className="mono">couponCode</span> <span className="label-sm">string · incoming</span></div>
            <div className="stripe-left b2 overlay-ghost" style={{ padding: '4px 8px', marginTop: 4, outline: '1px dashed #c44', outlineOffset: -1 }}>⚠ <span className="mono">total</span> <span className="label-sm">string · conflicts with current</span></div>
          </>
        )}
        {kind === 'diff' && (
          <>
            <div className="diff-add" style={{ padding: '4px 8px' }}>+ <span className="mono">idempotencyKey</span></div>
            <div className="diff-change" style={{ padding: '4px 8px', marginTop: 4 }}>~ <span className="mono">total</span> <span className="label-sm">decimal → string</span></div>
            <div className="diff-remove" style={{ padding: '4px 8px', marginTop: 4 }}>- <span className="mono">legacyId</span></div>
          </>
        )}
        {kind === 'split' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div className="box" style={{ padding: 6, fontSize: 10 }}>
              <div className="label-xs">main</div>
              <div className="mono">total : decimal</div>
            </div>
            <div className="box stripe-left" style={{ padding: 6, fontSize: 10 }}>
              <div className="label-xs">checkout-v2</div>
              <div className="mono">total : string</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OverlayGhost() {
  return (
    <div>
      <div style={{ padding: '8px 14px', borderBottom: '1px dashed var(--rule)', display: 'flex', gap: 12, alignItems: 'center', background: 'var(--paper-2)', flexWrap: 'wrap' }}>
        <span className="label-xs">Legend</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: 'var(--paper)', border: '1px solid var(--ink)', borderLeft: '3px solid var(--ink)' }}/> <span className="label-sm">current · main</span></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: 'var(--paper-2)', borderLeft: '3px solid var(--accent)', opacity: 0.55 }}/> <span className="label-sm">incoming · feat/checkout-v2</span></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: 'var(--paper-2)', borderLeft: '3px solid #5c7aa8', opacity: 0.55 }}/> <span className="label-sm">incoming · exp/events-redux</span></span>
        <div style={{ flex: 1 }}/>
        <span className="label-sm" style={{ color: '#b04' }}>⚠ conflict</span>
        <button className="btn ghost" style={{ fontSize: 10.5 }}>Pull all incoming</button>
      </div>
      <div className="field-row" style={{ background: 'var(--paper-2)', fontWeight: 600 }}>
        <div/><div className="label-xs">Field</div><div className="label-xs">Type</div><div className="label-xs">Req</div><div className="label-xs">State</div><div className="label-xs">Branch / action</div>
      </div>
      {[
        { n:'id', t:'uuid', req:'req', state:'agreed', branch:'main', stripe:'' },
        { n:'customerId', t:'uuid', req:'req', state:'agreed', branch:'main', stripe:'' },
        { n:'totalAmount', t:'decimal', req:'req', state:'agreed', branch:'main', stripe:'', conflict:true },
        { n:'total', t:'string', req:'req', state:'proposed', branch:'exp/events-redux', stripe:'stripe-left b2', ghost:true, conflict:true, note:'conflicts with main.totalAmount' },
        { n:'idempotencyKey', t:'string', req:'req', state:'proposed', branch:'feat/checkout-v2', stripe:'stripe-left', ghost:true, pullable:true },
        { n:'couponCode', t:'string', req:'opt', state:'draft', branch:'feat/checkout-v2', stripe:'stripe-left', ghost:true, pullable:true },
        { n:'placedAt', t:'datetime', req:'req', state:'agreed', branch:'main', stripe:'' },
      ].map((f, i) => (
        <div key={i} className={'field-row ' + f.stripe + (f.ghost ? ' overlay-ghost' : '')} style={f.conflict ? { background: 'color-mix(in oklch, #c44 6%, var(--paper))' } : undefined}>
          <div style={{ textAlign: 'center' }}>{f.conflict ? <span style={{ color: '#b04', fontWeight: 700 }}>⚠</span> : null}</div>
          <div className="name">{f.n}{f.note && <span className="label-sm" style={{ marginLeft: 8, color: '#b04', fontFamily: 'inherit' }}>· {f.note}</span>}</div>
          <div className="type">{f.t}</div>
          <div className="req">{f.req}</div>
          <div className="state"><StateTag state={f.state}/></div>
          <div className="lineage" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 10.5 }}>{f.branch}</span>
            {f.pullable && <button className="btn ghost" style={{ padding: '1px 6px', fontSize: 10 }}>pull ←</button>}
            {f.conflict && <button className="btn ghost" style={{ padding: '1px 6px', fontSize: 10, color: '#b04' }}>resolve</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function OverlayDiff() {
  return (
    <div>
      <div className="field-row" style={{ background: 'var(--paper-2)', fontWeight: 600 }}>
        <div/><div className="label-xs">Δ</div><div className="label-xs">Field</div><div className="label-xs">Type</div><div className="label-xs">State</div><div className="label-xs">Note</div>
      </div>
      {[
        { d:'', n:'id', t:'uuid', s:'agreed', note:'' },
        { d:'', n:'customerId', t:'uuid', s:'agreed', note:'' },
        { d:'~', cls:'diff-change', n:'total', t:'decimal → string', s:'proposed', note:'renamed from totalAmount · type changed' },
        { d:'+', cls:'diff-add', n:'idempotencyKey', t:'string', s:'proposed', note:'introduced on feat/checkout-v2' },
        { d:'+', cls:'diff-add', n:'couponCode', t:'string', s:'draft', note:'introduced on feat/checkout-v2' },
        { d:'-', cls:'diff-remove', n:'legacyOrderRef', t:'string', s:'removed', note:'state → removed' },
        { d:'', n:'placedAt', t:'datetime', s:'agreed', note:'' },
      ].map((f, i) => (
        <div key={i} className={'field-row ' + (f.cls || '')}>
          <div className="gutter mono" style={{ fontWeight: 700 }}>{f.d}</div>
          <div className="name">{f.n}</div>
          <div className="type">{f.t}</div>
          <div/>
          <div><StateTag state={f.s}/></div>
          <div className="label-sm" style={{ fontFamily: 'inherit' }}>{f.note}</div>
        </div>
      ))}
    </div>
  );
}

function OverlaySplit() {
  const cols = [
    { name: 'main', stripe: '', fields: [
      ['id','uuid','agreed'], ['customerId','uuid','agreed'],
      ['totalAmount','decimal','agreed'], ['legacyOrderRef','string','agreed'],
      ['placedAt','datetime','agreed']
    ]},
    { name: 'feat/checkout-v2', stripe: 'stripe-left', fields: [
      ['id','uuid','agreed'], ['customerId','uuid','agreed'],
      ['total','decimal','proposed'], ['idempotencyKey','string','proposed'],
      ['couponCode','string','draft'], ['placedAt','datetime','agreed']
    ]},
    { name: 'exp/events-redux', stripe: 'stripe-left b2', fields: [
      ['id','uuid','agreed'], ['customerId','uuid','agreed'],
      ['total','string','proposed'], ['placedAt','datetime','agreed']
    ]},
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
      {cols.map(c => (
        <div key={c.name} className={c.stripe} style={{ borderRight: '1px dashed var(--rule)', padding: 0 }}>
          <div style={{ padding: '8px 12px', background: 'var(--paper-2)', borderBottom: '1px dashed var(--rule)' }}>
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{c.name}</span>
          </div>
          {c.fields.map(([n, t, s], i) => (
            <div key={i} style={{ padding: '7px 12px', borderBottom: '1px dashed var(--rule)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{n}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t}</div>
              <StateTag state={s}/>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { TabBranching });
