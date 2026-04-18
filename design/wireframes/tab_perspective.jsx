/* Tab 3 — APIEndpoint perspective: POST /orders with full detail */

function TabPerspective({ tweaks }) {
  const lineage = tweaks.lineage;
  const signals = tweaks.signals;

  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <div className="content" style={{ paddingRight: signals === 'rail' ? 12 : 28 }}>
        <div className="pagehead">
          <div>
            <div className="label-xs">Components › orders › API Endpoints › POST /orders</div>
            <h1 style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 20, padding: '2px 10px', background: 'var(--ink)', color: 'var(--paper)', borderRadius: 4 }}>POST</span>
              <span className="mono" style={{ fontSize: 22 }}>/orders</span>
            </h1>
            <div className="sub" style={{ marginTop: 4 }}>Create an order. Owns <span className="mono">request</span> and <span className="mono">response</span> schemas; triggers <span className="mono">placeOrder</span>.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StateTag state="proposed"/>
            <StabilityTag stability="unstable"/>
            <button className="btn ghost">⋯</button>
            <button className="btn ghost">View graph</button>
            <button className="btn primary">Edit</button>
          </div>
        </div>

        {/* meta strip */}
        <div className="box-fill" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0, marginBottom: 14 }}>
          {[
            ['Template', <span className="mono">APIEndpoint</span>],
            ['Component', <span className="mono">orders</span>],
            ['Auth', <span className="mono">bearer · user</span>],
            ['Introduced by', <span>Epic · <span className="mono">Checkout v2</span></span>],
            ['Last modified', '2026-04-17 · by agent']
          ].map(([k, v], i) => (
            <div key={i} style={{ padding: '10px 14px', borderRight: i < 4 ? '1px dashed var(--rule)' : 'none' }}>
              <div className="label-xs">{k}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

{/* body: main column + optional right rail */}
        <div style={{ display: 'grid', gridTemplateColumns: signals === 'rail' ? '1fr 260px' : '1fr', gap: 18 }}>
          <div>
            {/* Request schema */}
            <SchemaBlock
              title="Request schema"
              subtitle="request · application/json"
              fields={[
                { n: 'customerId',     t: 'uuid',    req: 'required', state: 'agreed', sig: [], lineage: 'Customer.id' },
                { n: 'idempotencyKey', t: 'string',  req: 'required', state: 'proposed', sig: [{k:'thread'}], lineage: null, thread: true },
                { n: 'items[]',        t: 'object',  req: 'required', state: 'proposed', sig: [], lineage: null, open: true },
                { n: 'items[].sku',         t: 'string',  req: 'required', state: 'proposed', nested: true, lineage: 'Product.sku', sig: [] },
                { n: 'items[].quantity',    t: 'integer', req: 'required', state: 'proposed', nested: true, lineage: 'OrderLine.quantity', sig: [] },
                { n: 'items[].unitPrice',   t: 'decimal', req: 'required', state: 'draft', nested: true, lineage: null, sig: [{k:'drift'}], drift: true },
                { n: 'couponCode',     t: 'string',  req: 'optional', state: 'draft', sig: [], lineage: null },
                { n: 'shippingAddress',t: '→ Address', req: 'required', state: 'proposed', sig: [], lineage: 'Address' },
              ]}
              lineage={lineage}
              signals={signals}
              peekField="idempotencyKey"
            />

            {/* Response schema */}
            <div style={{ height: 18 }}/>
            <SchemaBlock
              title="Response schema · 201 Created"
              subtitle="response · application/json"
              fields={[
                { n: 'id',           t: 'uuid',      req: 'required', state: 'agreed', sig: [], lineage: 'Order.id' },
                { n: 'status',       t: '→ OrderStatus', req: 'required', state: 'agreed', sig: [], lineage: 'Order.status' },
                { n: 'total',        t: 'string',    req: 'required', state: 'proposed', sig: [{k:'drift'}], lineage: 'Order.totalAmount', drift: true },
                { n: 'createdAt',    t: 'datetime',  req: 'required', state: 'agreed', sig: [], lineage: 'Order.placedAt' },
              ]}
              lineage={lineage}
              signals={signals}
            />

            {/* Relationships */}
            <div style={{ height: 18 }}/>
            <RelationshipsBlock/>

            {/* Signals section — stacked, lives below content (Jon) */}
            {signals !== 'rail' && (<>
              <div style={{ height: 18 }}/>
              <StackedSignals/>
            </>)}
          </div>

          {/* Right rail signals */}
          {signals === 'rail' && <SignalRail/>}
        </div>
      </div>
    </div>
  );
}

function SchemaBlock({ title, subtitle, fields, lineage, signals, peekField }) {
  const peekIdx = peekField ? fields.findIndex(f => f.n === peekField) : -1;
  const peekTarget = peekIdx >= 0 ? fields[peekIdx] : null;

  return (
    <div className="box-fill" style={{ padding: 0 }}>
      <div className="panel-h">
        <div>
          <h2>{title}</h2>
          <div className="label-sm mono">{subtitle}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="label-xs">Lineage</span>
          <Seg
            options={[{value:'inline',label:'Inline'},{value:'peek',label:'Peek'},{value:'mini',label:'Mini'}]}
            value={lineage} onChange={() => {}}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: lineage === 'peek' && peekTarget ? '1.4fr 1fr' : '1fr' }}>
        <div>
          <div className="field-row" style={{ background: 'var(--paper-2)', fontWeight: 600 }}>
            <div/>
            <div className="label-xs">Name</div>
            <div className="label-xs">Type</div>
            <div className="label-xs">Req</div>
            <div className="label-xs">State</div>
            <div className="label-xs">{lineage === 'inline' ? 'Lineage (reads / maps-to)' : 'Links'}</div>
          </div>
          {fields.map((f, i) => (
            <FieldRow key={i} f={f} lineage={lineage} signals={signals} />
          ))}
        </div>

        {lineage === 'peek' && peekTarget && (
          <div className="peek" style={{ padding: '10px 14px', background: 'color-mix(in oklch, var(--accent) 4%, var(--paper))' }}>
            <div className="label-xs">Peek · linked node</div>
            <div className="hand" style={{ fontSize: 22, marginTop: 4 }}>Customer <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>· DomainModel</span></div>
            <div className="label-sm">customers component</div>
            <div className="hr-d"/>
            <div style={{ fontSize: 11.5 }}>Field <span className="mono">idempotencyKey</span> would map here? Not yet linked — agent asked a question.</div>
            <div className="hr-d"/>
            <div className="field-row" style={{ gridTemplateColumns: '18px 1fr 80px 60px', padding: '6px 0', borderBottom: 'none' }}>
              <div><SigDot kind="drift"/></div>
              <div><b>id</b></div>
              <div className="type">uuid</div>
              <div className="req">req</div>
            </div>
            <div className="field-row" style={{ gridTemplateColumns: '18px 1fr 80px 60px', padding: '6px 0', borderBottom: 'none' }}>
              <div/>
              <div><b>email</b></div>
              <div className="type">string</div>
              <div className="req">req</div>
            </div>
            <div className="field-row" style={{ gridTemplateColumns: '18px 1fr 80px 60px', padding: '6px 0', borderBottom: 'none' }}>
              <div/>
              <div><b>idempotencyKey</b></div>
              <div className="type">?</div>
              <div className="req">—</div>
            </div>
            <button className="btn ghost" style={{ marginTop: 8 }}>Open Customer →</button>
          </div>
        )}
      </div>

      {lineage === 'mini' && <MiniLineageGraph/>}
    </div>
  );
}

function FieldRow({ f, lineage, signals }) {
  const showGutter = signals !== 'rail'; // gutter dots also shown with stacked
  const hasThread = f.thread;
  const hasDrift = f.drift || (f.sig || []).some(s => s.k === 'drift');
  const sigKey = hasThread ? 'thread-' + f.n : hasDrift ? 'drift-' + f.n : null;
  const jump = (e) => {
    if (!sigKey) return;
    e.preventDefault();
    const t = document.getElementById('sig-' + sigKey);
    if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (t) { t.classList.add('sig-flash'); setTimeout(() => t.classList.remove('sig-flash'), 1400); }
  };
  return (
    <div className={'field-row ' + (f.nested ? 'nested' : '')}>
      <div className="gutter">
        {showGutter && hasThread && <a href={'#sig-' + sigKey} onClick={jump} title="jump to signal"><SigDot kind="thread"/></a>}
        {showGutter && hasDrift && !hasThread && <a href={'#sig-' + sigKey} onClick={jump} title="jump to signal"><SigDot kind="drift"/></a>}
      </div>
      <div className="name">{f.n}</div>
      <div className="type">{f.t}</div>
      <div className="req">{f.req}</div>
      <div className="state"><StateTag state={f.state}/></div>
      <div className="lineage">
        {lineage === 'inline' && f.lineage && (
          <span><Icon name="link" size={10}/> {f.lineage}</span>
        )}
        {lineage === 'inline' && !f.lineage && (
          <span className="label-sm" style={{ fontFamily: 'inherit' }}>—</span>
        )}
        {lineage !== 'inline' && f.lineage && (
          <button className="btn ghost" style={{ padding: '2px 6px' }}>{f.lineage}</button>
        )}
        {lineage !== 'inline' && !f.lineage && <span className="label-sm" style={{ fontFamily: 'inherit' }}>—</span>}
      </div>
    </div>
  );
}

function MiniLineageGraph() {
  return (
    <div style={{ padding: 14, borderTop: '1px solid var(--rule)' }}>
      <div className="label-xs" style={{ marginBottom: 8 }}>Lineage graph · current node centered</div>
      <div className="mg" style={{ height: 220, position: 'relative' }}>
        <svg viewBox="0 0 800 200" style={{ width: '100%', height: '100%' }}>
          <defs>
            <marker id="ah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)"/>
            </marker>
          </defs>
          {/* nodes */}
          <g>
            <rect x="20" y="40" width="140" height="46" rx="6" fill="var(--paper)" stroke="var(--rule-2)" strokeDasharray="4 3"/>
            <text x="90" y="60" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono">Customer</text>
            <text x="90" y="75" textAnchor="middle" fontSize="10" fill="var(--ink-3)">DomainModel</text>

            <rect x="20" y="120" width="140" height="46" rx="6" fill="var(--paper)" stroke="var(--rule-2)" strokeDasharray="4 3"/>
            <text x="90" y="140" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono">Product</text>
            <text x="90" y="155" textAnchor="middle" fontSize="10" fill="var(--ink-3)">DomainModel</text>

            <rect x="320" y="70" width="170" height="60" rx="8" fill="color-mix(in oklch, var(--accent) 12%, var(--paper))" stroke="var(--accent)" strokeWidth="1.4"/>
            <text x="405" y="92" textAnchor="middle" fontSize="12" fontFamily="JetBrains Mono" fontWeight="600">POST /orders</text>
            <text x="405" y="110" textAnchor="middle" fontSize="10" fill="var(--ink-3)">APIEndpoint · you are here</text>

            <rect x="640" y="20" width="140" height="46" rx="6" fill="var(--paper)" stroke="var(--rule-2)" strokeDasharray="4 3"/>
            <text x="710" y="40" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono">placeOrder</text>
            <text x="710" y="55" textAnchor="middle" fontSize="10" fill="var(--ink-3)">DomainOperation</text>

            <rect x="640" y="80" width="140" height="46" rx="6" fill="var(--paper)" stroke="var(--rule-2)" strokeDasharray="4 3"/>
            <text x="710" y="100" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono">Order</text>
            <text x="710" y="115" textAnchor="middle" fontSize="10" fill="var(--ink-3)">DomainModel</text>

            <rect x="640" y="140" width="140" height="46" rx="6" fill="var(--paper)" stroke="var(--rule-2)" strokeDasharray="4 3"/>
            <text x="710" y="160" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono">OrderPlaced</text>
            <text x="710" y="175" textAnchor="middle" fontSize="10" fill="var(--ink-3)">DomainEvent</text>
          </g>
          {/* edges */}
          <g className="arrow">
            <path d="M160 63 C 240 63, 260 95, 320 95" markerEnd="url(#ah)"/>
            <path d="M160 143 C 240 143, 260 110, 320 110" markerEnd="url(#ah)"/>
            <path d="M490 88 C 560 80, 580 45, 640 43" markerEnd="url(#ah)"/>
            <path d="M490 100 C 560 100, 580 103, 640 103" markerEnd="url(#ah)"/>
            <path d="M490 115 C 560 135, 580 162, 640 162" markerEnd="url(#ah)"/>
          </g>
          <g fontSize="9" fill="var(--accent)" fontFamily="Caveat, cursive" fontWeight="600">
            <text x="215" y="78">reads</text>
            <text x="215" y="130">reads</text>
            <text x="555" y="65">triggers</text>
            <text x="555" y="96">produces</text>
            <text x="555" y="152">produces</text>
          </g>
        </svg>
      </div>
      <div className="label-sm" style={{ marginTop: 6 }}>n+1 overlay · click a neighbour to load its fields alongside (n+2, n+3...)</div>
    </div>
  );
}

function RelationshipsBlock() {
  return (
    <div className="box-fill" style={{ padding: 0 }}>
      <div className="panel-h"><h2>Relationships</h2><div className="label-sm">5 edges · click to expand the linked node</div></div>
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { type: 'triggers', target: 'placeOrder', tt: 'DomainOperation', state: 'proposed' },
          { type: 'calls', target: 'inventory.reserveStock', tt: 'APIEndpoint (catalog)', state: 'proposed' },
          { type: 'produces', target: 'OrderPlaced', tt: 'DomainEvent', state: 'agreed' },
          { type: 'reads', target: 'Customer', tt: 'DomainModel', state: 'agreed' },
          { type: 'reads', target: 'Product', tt: 'DomainModel', state: 'agreed' },
        ].map((r, i) => (
          <div key={i} className="box" style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <Chip>{r.type}</Chip>
            <div style={{ flex: 1 }}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.target}</div>
              <div className="label-sm">{r.tt}</div>
            </div>
            <StateTag state={r.state}/>
            <button className="btn ghost">→</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StackedSignals() {
  const items = [
    { id: 'thread-idempotencyKey', kind: 'thread', prio: 1, title: <>Open question on <span className="mono">request.idempotencyKey</span></>, meta: '“Should this be required on retries?” · a.fisher · 2h ago · blocking agent', urgent: true },
    { id: 'drift-total', kind: 'drift', prio: 2, title: <>Drift · <span className="mono">response.total</span> differs from <span className="mono">Order.totalAmount</span></>, meta: 'Scalar type: decimal → string. Source: derived layer' },
    { id: 'drift-items[].unitPrice', kind: 'drift', prio: 3, title: <>Warning · <span className="mono">items[].unitPrice</span> is unstable</>, meta: 'No declared link to canonical price source' },
  ];
  return (
    <div className="box-fill" style={{ padding: 0 }}>
      <div className="panel-h"><h2>Signals on this node</h2><div className="label-sm">{items.length} · dots above link down here</div></div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(s => (
          <div key={s.id} id={'sig-' + s.id} className={'sigcard' + (s.urgent ? ' urgent' : '')}>
            <span className="prio">{s.prio}</span>
            <div>
              <div className="title"><SigDot kind={s.kind}/> {s.title}</div>
              <div className="meta">{s.meta}</div>
            </div>
            <button className="btn">Jump to field</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThreadsBlock() {
  return (
    <div className="box-fill" style={{ padding: 0 }}>
      <div className="panel-h"><h2>Threads</h2><div className="label-sm">2 open · 1 question blocking agent</div></div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="box" style={{ padding: 12, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Chip variant="accent">question</Chip>
            <span className="label-sm">on <span className="mono">request.idempotencyKey</span> · opened by agent · 2h</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>Should this be required on retries, or derived from a session header? Blocking extraction until resolved.</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button className="btn">Reply</button>
            <button className="btn primary">Resolve</button>
          </div>
        </div>
        <div className="box" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Chip>discussion</Chip>
            <span className="label-sm">on <span className="mono">response.total</span> · 3 replies</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>Should total be serialised as string (Stripe-style) or decimal? Leaning string for precision…</div>
        </div>
      </div>
    </div>
  );
}

function SignalRail() {
  return (
    <aside className="box-fill" style={{ padding: 0, alignSelf: 'flex-start', position: 'sticky', top: 140 }}>
      <div className="panel-h"><h2>Signals</h2><div className="label-sm">this node · 5</div></div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="sigcard urgent" style={{ gridTemplateColumns: '20px 1fr' }}>
          <SigDot kind="thread"/>
          <div><div className="title">Open question</div><div className="meta">request.idempotencyKey</div></div>
        </div>
        <div className="sigcard" style={{ gridTemplateColumns: '20px 1fr' }}>
          <SigDot kind="drift"/>
          <div><div className="title">Drift</div><div className="meta">response.total vs Order.totalAmount</div></div>
        </div>
        <div className="sigcard" style={{ gridTemplateColumns: '20px 1fr' }}>
          <SigDot kind="collision"/>
          <div><div className="title">Collision</div><div className="meta">Order.totalAmount across 2 branches</div></div>
        </div>
        <div className="sigcard" style={{ gridTemplateColumns: '20px 1fr' }}>
          <Icon name="thread" size={12}/>
          <div><div className="title">Discussion</div><div className="meta">response.total serialisation</div></div>
        </div>
        <div className="sigcard" style={{ gridTemplateColumns: '20px 1fr' }}>
          <Icon name="drift" size={12}/>
          <div><div className="title">Warning</div><div className="meta">items[].unitPrice not stable</div></div>
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { TabPerspective });
