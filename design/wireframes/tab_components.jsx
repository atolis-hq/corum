/* Tab 2 — Components section: nav tree + template index + node list */

function TabComponents({ tweaks }) {
  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <div className="content">
        <div className="pagehead">
          <div>
            <div className="label-xs">Components › orders › API Endpoints</div>
            <h1>API Endpoints <span className="mono" style={{ fontSize: 14, color: 'var(--ink-3)' }}>(6)</span></h1>
            <div className="sub">All nodes using the <span className="mono">APIEndpoint</span> template in the <span className="mono">orders</span> component. Select one to open its perspective.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost">Group: by method</button>
            <button className="btn ghost">Filter</button>
            <button className="btn"><Icon name="plus" size={11}/> new endpoint</button>
          </div>
        </div>

        {/* Template summary strip */}
        <div className="box-fill" style={{ padding: '12px 16px', display: 'flex', gap: 18, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: "'Caveat', cursive", fontSize: 28, lineHeight: 1 }}>APIEndpoint</div>
          <div className="label-sm" style={{ maxWidth: 420 }}>
            HTTP contract boundary. Has <span className="mono">method</span>, <span className="mono">path</span>, <span className="mono">auth</span>, and owns <span className="mono">request</span> / <span className="mono">response</span> schema clusters.
          </div>
          <div style={{ flex: 1 }}/>
          <div className="label-sm">Supports edges:</div>
          <Chip>triggers →</Chip>
          <Chip>calls →</Chip>
          <Chip>produces →</Chip>
        </div>

        {/* Table */}
        <div className="box-fill" style={{ padding: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '18px 70px 1.6fr 1fr 110px 100px 80px', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
            <div/>
            <div className="label-xs">Method</div>
            <div className="label-xs">Path</div>
            <div className="label-xs">Summary</div>
            <div className="label-xs">State</div>
            <div className="label-xs">Stability</div>
            <div className="label-xs">Signals</div>
          </div>
          {[
            { m:'POST', p:'/orders', s:'Create an order', state:'proposed', stab:'unstable', sig:[{k:'thread'},{k:'drift'}], branch:'feat/checkout-v2' },
            { m:'GET',  p:'/orders/{id}', s:'Fetch order by id', state:'agreed', stab:'stable', sig:[{k:'drift'}] },
            { m:'GET',  p:'/orders', s:'List orders', state:'implemented', stab:'stable', sig:[] },
            { m:'PATCH',p:'/orders/{id}', s:'Update order (mutable fields)', state:'draft', stab:'unstable', sig:[{k:'thread'}] },
            { m:'POST', p:'/orders/{id}/cancel', s:'Cancel an order', state:'proposed', stab:'unstable', sig:[], branch:'feat/checkout-v2' },
            { m:'POST', p:'/orders/{id}/refund', s:'Issue refund', state:'future', stab:'unstable', sig:[] },
          ].map((r, i) => (
            <div key={i} className={'row-endpoint'} style={{ display: 'grid', gridTemplateColumns: '18px 70px 1.6fr 1fr 110px 100px 80px', gap: 12, padding: '11px 14px', borderBottom: i < 5 ? '1px dashed var(--rule)' : 'none', alignItems: 'center', background: r.branch ? 'color-mix(in oklch, var(--accent) 5%, var(--paper))' : 'transparent' }}>
              <div>{r.branch && <span className="sig thread" title={'on ' + r.branch}/>}</div>
              <div className="mono" style={{ fontWeight: 600, fontSize: 11.5 }}>{r.m}</div>
              <div className="mono" style={{ fontSize: 12.5 }}>{r.p}</div>
              <div style={{ color: 'var(--ink-2)' }}>{r.s}</div>
              <div><StateTag state={r.state}/></div>
              <div><StabilityTag stability={r.stab}/></div>
              <div style={{ display: 'flex', gap: 4 }}>{r.sig.map((s, j) => <SigDot key={j} kind={s.k}/>)}</div>
            </div>
          ))}
        </div>

        {/* Template types panel beneath */}
        <div style={{ marginTop: 24 }}>
          <div className="label-xs" style={{ marginBottom: 8 }}>Other template types in this component</div>
          <div className="g-3">
            {[
              { t: 'DomainModel', n: 4, ex: 'Order · OrderLine · Address · Money' },
              { t: 'DomainEvent', n: 3, ex: 'OrderPlaced · OrderCancelled · ItemReturned' },
              { t: 'ReadModel', n: 3, ex: 'OrderSummary · CustomerOrders · DailyRevenue' },
              { t: 'IntegrationEvent', n: 2, ex: 'OrderConfirmed.external · RefundIssued.external' },
              { t: 'DomainOperation', n: 7, ex: 'placeOrder · cancelOrder · …' },
              { t: 'ValueObject', n: 3, ex: 'Money · Address · IdempotencyKey' },
            ].map(tt => (
              <div key={tt.t} className="box" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div className="mono" style={{ fontWeight: 600 }}>{tt.t}</div>
                  <span className="label-sm">{tt.n} nodes</span>
                </div>
                <div className="label-sm" style={{ marginTop: 4 }}>{tt.ex}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TabComponents });
