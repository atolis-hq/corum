/* Tab 1 — App at a glance / Dashboard */

function TabOverview() {
  return (
    <div className="content">
      <div className="pagehead">
        <div>
          <h1>Dashboard · feat/checkout-v2</h1>
          <div className="sub">Branch-scoped signal feed, plus what's changed vs <span className="mono">main</span>. Humans land here; agents write in the background.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost"><Icon name="filter" size={11}/> scope: this branch</button>
          <button className="btn"><Icon name="plus" size={11}/> new node</button>
        </div>
      </div>

      {/* Top KPI row */}
      <div className="g-3" style={{ marginBottom: 18 }}>
        <div className="card">
          <h3>Added on this branch</h3>
          <div className="big">14</div>
          <div className="label-sm">6 fields · 4 nodes · 4 edges · vs <span className="mono">main</span></div>
          <div className="hr-d"/>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag kind="state-proposed">proposed 9</Tag>
            <Tag kind="state-draft">draft 3</Tag>
            <Tag kind="state-agreed">agreed 2</Tag>
          </div>
        </div>
        <div className="card">
          <h3>Needs your attention</h3>
          <div className="big">7</div>
          <div className="label-sm">open questions, collisions, drift on stable nodes</div>
          <div className="hr-d"/>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--ink-3)' }}>
            <span><SigDot kind="thread"/> 2 questions</span>
            <span><SigDot kind="collision"/> 1 collision</span>
            <span><SigDot kind="drift"/> 4 drift</span>
          </div>
        </div>
        <div className="card">
          <h3>In-flight branches</h3>
          <div className="big">3</div>
          <div className="label-sm">simultaneous design work across the team</div>
          <div className="hr-d"/>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span className="mono">feat/checkout-v2</span><span className="label-sm">you · 14</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span className="mono">feat/loyalty-api</span><span className="label-sm">N.Patel · 6</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span className="mono">exp/events-redux</span><span className="label-sm">K.Chen · 21</span></div>
          </div>
        </div>
      </div>

      {/* Body 2-col */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
        {/* Signal feed */}
        <div>
          <div className="panel-h" style={{ borderRadius: '8px 8px 0 0', border: '1px solid var(--rule-2)', borderBottom: 'none' }}>
            <h2>Signal feed</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <Seg
                options={[{ value: 'prio', label: 'By priority' }, { value: 'type', label: 'By type' }]}
                value="prio" onChange={() => {}}
              />
            </div>
          </div>
          <div style={{ border: '1px solid var(--rule-2)', borderRadius: '0 0 8px 8px', borderTop: 'none', padding: 14, background: 'var(--paper)' }}>
            <div className="sigcard urgent">
              <span className="prio">1</span>
              <div>
                <div className="title"><SigDot kind="thread"/> Question · blocking agent</div>
                <div className="meta">"Should <span className="mono">idempotencyKey</span> be required on retries?" · on <span className="mono">POST /orders · request.idempotencyKey</span></div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn">Open</button>
              </div>
            </div>
            <div className="sigcard">
              <span className="prio">2</span>
              <div>
                <div className="title"><SigDot kind="collision"/> Collision · 2 branches</div>
                <div className="meta"><span className="mono">Order.totalAmount</span> renamed in this branch; changed type in <span className="mono">exp/events-redux</span></div>
              </div>
              <button className="btn">Compare</button>
            </div>
            <div className="sigcard">
              <span className="prio">3</span>
              <div>
                <div className="title">Reconciliation · design without code</div>
                <div className="meta"><span className="mono">DiscountApplied</span> event has no derived-layer counterpart</div>
              </div>
              <button className="btn">Review</button>
            </div>
            <div className="sigcard">
              <span className="prio">4</span>
              <div>
                <div className="title"><Icon name="thread" size={11}/> Instruction · unactioned</div>
                <div className="meta">"Rename <span className="mono">customer_id</span> → <span className="mono">customerId</span> across orders" · 2d ago</div>
              </div>
              <button className="btn">Open</button>
            </div>
            <div className="sigcard">
              <span className="prio">5</span>
              <div>
                <div className="title"><SigDot kind="drift"/> Drift · stable node</div>
                <div className="meta">Response schema of <span className="mono">GET /orders/{'{id}'}</span> differs from <span className="mono">Order</span> model on 3 fields</div>
              </div>
              <button className="btn">Open</button>
            </div>
            <div className="sigcard">
              <span className="prio">6</span>
              <div>
                <div className="title">Stability warning</div>
                <div className="meta">Breaking change on <span className="mono">stable</span> node <span className="mono">OrderPlaced.orderId</span> (uuid → string)</div>
              </div>
              <button className="btn">Review</button>
            </div>
            <div className="hr-d"/>
            <div className="label-sm" style={{ textAlign: 'center' }}>+ 3 open discussions · no immediate action</div>
          </div>
        </div>

        {/* Right: quick sections + analytics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <h3>Jump into</h3>
            <div className="g-2" style={{ gap: 10 }}>
              <div className="box" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="cube"/> <b>Components</b></div>
                <div className="label-sm" style={{ marginTop: 2 }}>5 apis · 4 models · 5 events · 3 read-models</div>
              </div>
              <div className="box" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="journey"/> <b>User Journeys</b></div>
                <div className="label-sm" style={{ marginTop: 2 }}>Checkout · Refund · Returns · +5</div>
              </div>
              <div className="box" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="delivery"/> <b>Delivery</b></div>
                <div className="label-sm" style={{ marginTop: 2 }}>Epic · Checkout v2 · 7 stories</div>
              </div>
              <div className="box" style={{ padding: 12, opacity: 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="graph"/> <b>Graph Explorer</b></div>
                <div className="label-sm" style={{ marginTop: 2 }}>coming soon</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Graph analytics</h3>
            {[
              { n: '12', l: 'Orphan fields (no lineage)', tone: 'warn' },
              { n: '4',  l: 'Fields marked stable w/o derived layer', tone: 'signal' },
              { n: '3',  l: 'Rename trails awaiting reconciliation' },
              { n: '18', l: 'Edges in proposed state on agreed nodes' },
              { n: '2',  l: 'Cross-component maps-to edges added this week' },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: i < 4 ? '1px dashed var(--rule)' : 'none' }}>
                <div className="mono" style={{ width: 28, textAlign: 'right', fontWeight: 600 }}>{r.n}</div>
                <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)' }}>{r.l}</div>
                {r.tone === 'warn' && <SigDot kind="collision"/>}
                {r.tone === 'signal' && <SigDot kind="drift"/>}
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Recent activity</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div><span className="mono label-sm">14:02</span> · agent added <span className="mono">Order.idempotencyKey</span> <StateTag state="draft"/></div>
              <div><span className="mono label-sm">13:40</span> · you resolved question on <span className="mono">POST /orders</span></div>
              <div><span className="mono label-sm">11:18</span> · N.Patel proposed <span className="mono">LoyaltyTier</span> enum</div>
              <div><span className="mono label-sm">09:05</span> · extractor reconciled <span className="mono">OrderPlaced</span> → implemented</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TabOverview });
