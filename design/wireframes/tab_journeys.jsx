/* Tab 5 — Journeys & Delivery sketches */

function TabJourneys() {
  return (
    <div className="content">
      <div className="pagehead">
        <div>
          <h1>User Journeys & Delivery</h1>
          <div className="sub">Sketch of the journey swimlane builder plus the Delivery section. Both are top-level sections alongside Components.</div>
        </div>
      </div>

      {/* Journey header */}
      <div className="box-fill" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="hand" style={{ fontSize: 28 }}>Journey · Customer places an order</div>
        <div className="label-sm">7 steps · 4 components · 12 linked nodes</div>
        <div style={{ flex: 1 }}/>
        <Seg options={[{value:'a',label:'Swimlane'},{value:'b',label:'List'}]} value="a" onChange={()=>{}}/>
        <button className="btn ghost">+ step</button>
        <button className="btn primary">Edit</button>
      </div>

      {/* Swimlane */}
      <Swimlane/>

      {/* Delivery split */}
      <div style={{ height: 26 }}/>
      <div className="label-xs" style={{ marginBottom: 8 }}>Delivery section</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <div className="box-fill" style={{ padding: 0 }}>
          <div className="panel-h"><h2>Epics</h2><div className="label-sm">linked to nodes this epic introduces or changes</div></div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { t: 'Checkout v2', s: 'in flight', c: '14 nodes · 6 edges · 3 open questions', state: 'proposed' },
              { t: 'Loyalty programme', s: 'proposed', c: '6 nodes · 2 edges', state: 'proposed' },
              { t: 'Events redux (platform)', s: 'in flight', c: '21 nodes · 11 edges · 2 collisions', state: 'proposed' },
              { t: 'Refund self-service', s: 'future', c: '4 nodes (future)', state: 'future' },
            ].map(e => (
              <div key={e.t} className="box" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="grip"/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{e.t}</div>
                  <div className="label-sm">{e.c}</div>
                </div>
                <StateTag state={e.state}/>
                <button className="btn ghost">→</button>
              </div>
            ))}
          </div>
        </div>

        <div className="box-fill" style={{ padding: 0 }}>
          <div className="panel-h"><h2>Impact analysis · this epic</h2><div className="label-sm">Checkout v2</div></div>
          <div style={{ padding: 12 }}>
            <div className="label-xs">Introduces</div>
            <ul style={{ margin: '6px 0 10px 18px', fontSize: 12.5, color: 'var(--ink-2)' }}>
              <li><span className="mono">POST /orders</span> · request.idempotencyKey</li>
              <li><span className="mono">POST /orders/{'{id}'}/cancel</span></li>
              <li><span className="mono">DiscountApplied</span> event</li>
              <li>5 new fields on <span className="mono">Order</span></li>
            </ul>
            <div className="label-xs">Touches stable contracts</div>
            <ul style={{ margin: '6px 0 10px 18px', fontSize: 12.5, color: 'var(--ink-2)' }}>
              <li><SigDot kind="drift"/> <span className="mono">Order.totalAmount</span> · type change</li>
              <li><SigDot kind="collision"/> conflicts with <span className="mono">exp/events-redux</span></li>
            </ul>
            <div className="label-xs">Downstream consumers</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <Chip>billing.invoices</Chip>
              <Chip>analytics.orders_daily</Chip>
              <Chip>notifications.email</Chip>
              <Chip>partner-sync</Chip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Swimlane() {
  const steps = [
    { name: 'Browse cart', who: 'Customer' },
    { name: 'Submit order', who: 'Customer' },
    { name: 'Validate & reserve', who: 'System' },
    { name: 'Charge payment', who: 'System' },
    { name: 'Confirm', who: 'Customer' },
    { name: 'Fulfil', who: 'System' },
  ];
  const lanes = [
    { name: 'storefront', color: 'oklch(0.9 0.05 80)' },
    { name: 'orders', color: 'oklch(0.9 0.06 40)' },
    { name: 'payments', color: 'oklch(0.9 0.06 160)' },
    { name: 'fulfilment', color: 'oklch(0.9 0.06 240)' },
  ];

  // cells[lane][step] = cluster or null
  const clusters = {
    'storefront:0': [{ t:'Cmd', n:'ViewCart' }, { t:'Read', n:'CartSummary' }],
    'storefront:1': [{ t:'Cmd', n:'PlaceOrder' }],
    'storefront:4': [{ t:'Read', n:'OrderConfirmation' }],
    'orders:1': [{ t:'API', n:'POST /orders' }, { t:'Op', n:'placeOrder' }, { t:'Agg', n:'Order' }],
    'orders:2': [{ t:'Op', n:'validateOrder' }, { t:'Evt', n:'OrderValidated' }],
    'orders:3': [{ t:'Evt', n:'OrderPlaced' }],
    'orders:5': [{ t:'Evt', n:'OrderFulfilled' }],
    'payments:3': [{ t:'API', n:'POST /charges' }, { t:'Agg', n:'Charge' }, { t:'Evt', n:'PaymentAuthorised' }],
    'fulfilment:5': [{ t:'API', n:'POST /shipments' }, { t:'Agg', n:'Shipment' }],
  };

  const gridCols = `160px repeat(${steps.length}, 1fr)`;

  return (
    <div className="lane" style={{ gridTemplateColumns: gridCols }}>
      {/* header row */}
      <div className="lcol lhead lrow-label" style={{ fontSize: 12, color: 'var(--ink-3)' }}>component ↓ / step →</div>
      {steps.map((s, i) => (
        <div key={i} className="lcol lhead" style={{ padding: '10px 12px' }}>
          <div className="label-xs">Step {i+1}</div>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{s.name}</div>
          <div className="label-sm">by {s.who}</div>
        </div>
      ))}

      {/* body rows */}
      {lanes.map(lane => (
        <React.Fragment key={lane.name}>
          <div className="lrow-label" style={{ background: lane.color, borderRight: '1px dashed var(--rule)' }}>
            {lane.name}
          </div>
          {steps.map((_, i) => {
            const key = `${lane.name}:${i}`;
            const cs = clusters[key];
            return (
              <div key={key} className="lcol" style={{ padding: 8, minHeight: 100 }}>
                {cs && (
                  <div className="box" style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4, borderStyle: 'solid' }}>
                    {cs.map((c, j) => (
                      <div key={j} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                        <span className="chip" style={{ padding: '1px 6px', fontSize: 9, fontFamily: 'Inter, sans-serif' }}>{c.t}</span>
                        <span className="mono">{c.n}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}

      {/* arrow overlay — cheap: dashed arrows between column centers */}
      <div style={{ gridColumn: `1 / span ${steps.length + 1}`, position: 'relative', height: 0 }}>
        <svg style={{ position: 'absolute', left: 0, top: -340, width: '100%', height: 340, pointerEvents: 'none' }}>
          <defs>
            <marker id="jah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)"/>
            </marker>
          </defs>
          <g className="arrow">
            <path d="M 160 60 C 230 60, 240 150, 300 150" markerEnd="url(#jah)"/>
            <path d="M 440 160 C 470 160, 470 230, 500 230" markerEnd="url(#jah)"/>
            <path d="M 620 235 C 660 235, 660 165, 690 165" markerEnd="url(#jah)"/>
          </g>
        </svg>
      </div>
    </div>
  );
}

Object.assign(window, { TabJourneys });
