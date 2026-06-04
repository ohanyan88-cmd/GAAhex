/* GAAhex — Dashboard, Work Items, Module stub */

function ViewHead({ icon, title, sub, actions }) {
  return (
    <div className="view-head">
      <div className="vh-ic"><Icon name={icon} size={20} /></div>
      <div>
        <h1>{title}</h1>
        <div className="sub">{sub}</div>
      </div>
      <span className="spacer" />
      {actions}
    </div>
  );
}

function Spark({ color = 'var(--gx-primary)', pts = '0,18 14,14 28,16 42,8 56,11 70,4 84,9 98,2' }) {
  return <svg width="100" height="22" viewBox="0 0 100 22" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Dashboard({ crumb }) {
  return (
    <div className="view-inner fade">
      <div className="crumbs"><span>Home</span><span className="sep">/</span><span style={{ color:'var(--gx-text-1)' }}>{crumb}</span></div>
      <ViewHead icon="layout-dashboard" title="Operations Dashboard" sub="Yerevan Net · live across all modules"
        actions={<><div className="seg"><button className="on">30d</button><button>QTD</button><button>YTD</button></div><button className="btn btn-ghost btn-sm" onClick={()=>window.gxGoStudio&&window.gxGoStudio()} title="Every screen is config — edit this one in Studio"><Icon name="wand-2" size={14} style={{color:'var(--gx-gold)'}} />Configure page</button><button className="btn btn-secondary btn-sm"><Icon name="download" size={14} />Export</button></>} />

      <div className="kpis">
        {KPIS.map(k => (
          <div className="kpi" key={k.lbl}>
            <div style={{ display:'flex', alignItems:'center' }}>
              <span className="klbl">{k.lbl}</span><span className="spacer" />
              <span style={{ color: k.accent ? 'var(--gx-gold)' : 'var(--gx-text-3)' }}><Icon name={k.icon} size={16} /></span>
            </div>
            <div className="kval tnum">{k.val}</div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span className={'pill ' + (k.up ? 'pill-success' : 'pill-danger')}><Icon name={k.up ? 'trending-up' : 'trending-down'} size={12} />{k.delta}</span>
              <Spark color={k.accent ? 'var(--gx-gold)' : (k.up ? 'var(--gx-success)' : 'var(--gx-danger)')} />
            </div>
          </div>
        ))}
      </div>

      <div className="cols">
        <div className="card">
          <div className="card-head"><Icon name="bar-chart-3" size={16} style={{ color:'var(--gx-text-3)' }} /><h3>Revenue vs. churn</h3><span className="spacer" /><span className="pill pill-neutral">monthly</span></div>
          <div className="card-pad"><BarChart /></div>
        </div>
        <div className="card">
          <div className="card-head"><Icon name="activity" size={16} style={{ color:'var(--gx-text-3)' }} /><h3>Recent activity</h3></div>
          <div style={{ padding:'6px 0' }}>
            {ACTIVITY.map((a,i) => (
              <div key={i} style={{ display:'flex', gap:11, alignItems:'flex-start', padding:'10px 18px' }}>
                <span style={{ width:28, height:28, borderRadius:'var(--gx-radius-sm)', background:'var(--gx-surface-2)', display:'flex', alignItems:'center', justifyContent:'center', color:a.tone, flexShrink:0 }}><Icon name={a.icon} size={15} /></span>
                <div style={{ fontSize:12.5, lineHeight:1.5 }}>
                  <span style={{ fontWeight:600 }}>{a.who}</span> <span style={{ color:'var(--gx-text-2)' }}>{a.act}</span> <span className="mono" style={{ color:'var(--gx-link)' }}>{a.obj}</span>
                  <div className="hint" style={{ fontSize:11 }}>{a.t}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head"><Icon name="inbox" size={16} style={{ color:'var(--gx-text-3)' }} /><h3>Tickets needing attention</h3><span className="spacer" /><button className="btn btn-ghost btn-sm">View all<Icon name="arrow-right" size={14} /></button></div>
        <WorkTable rows={WORKITEMS.slice(0,4)} compact />
      </div>
    </div>
  );
}

function BarChart() {
  const data = [62,70,58,80,74,90,84,96,88,104,98,118];
  const max = 130;
  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:160, padding:'4px 0' }}>
        {data.map((v,i) => (
          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end', gap:2, height:'100%' }}>
            <div style={{ height: (v/max*100)+'%', background:'linear-gradient(180deg,var(--azure-400),var(--azure-600))', borderRadius:'4px 4px 0 0' }} />
            <div style={{ height: (v*0.18/max*100)+'%', background:'var(--gx-gold)', borderRadius:'0 0 4px 4px', opacity:.85 }} />
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:18, marginTop:12, fontSize:11, color:'var(--gx-text-3)' }}>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:9, height:9, borderRadius:2, background:'var(--azure-500)' }} />Revenue</span>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:9, height:9, borderRadius:2, background:'var(--gx-gold)' }} />Churn</span>
      </div>
    </div>
  );
}

function WorkTable({ rows, compact }) {
  const [sel, setSel] = React.useState('TK-4821');
  return (
    <div style={{ overflowX:'auto' }}>
      <table className="grid">
        <thead><tr>
          <th>Ticket</th><th>Subject</th>{!compact && <th>Customer</th>}<th>Status</th><th>SLA</th><th>Priority</th><th>Owner</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className={sel===r.id?'sel':''} onClick={()=>setSel(r.id)}>
              <td className="mono" style={{ color:'var(--gx-link)' }}>{r.id}</td>
              <td style={{ maxWidth:280 }}>{r.subject}</td>
              {!compact && <td style={{ color:'var(--gx-text-2)' }}>{r.cust}</td>}
              <td><span className={'pill '+r.sk}>{r.status}</span></td>
              <td className="mono tnum" style={{ color: r.sla==='—'?'var(--gx-text-3)':(r.sla<'01:00'?'var(--gx-danger-fg)':'var(--gx-text-2)') }}>{r.sla}</td>
              <td><span className={'pill '+r.pk}>{r.prio}</span></td>
              <td><span className="avatar" style={{ width:24, height:24, fontSize:10 }}>{r.assignee}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkItems() {
  const [view, setView] = React.useState('table');
  return (
    <div className="view-inner fade">
      <div className="crumbs"><span>Support</span><span className="sep">/</span><span style={{ color:'var(--gx-text-1)' }}>Work Items</span></div>
      <ViewHead icon="rows-3" title="Work Items" sub="347 open · 12 breaching SLA"
        actions={<>
          <div className="seg">
            <button className={view==='table'?'on':''} onClick={()=>setView('table')}><Icon name="rows-3" size={13} />Table</button>
            <button className={view==='board'?'on':''} onClick={()=>setView('board')}><Icon name="columns-3" size={13} />Board</button>
          </div>
          <button className="btn btn-secondary btn-sm"><Icon name="filter" size={14} />Filter</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>window.gxGoStudio&&window.gxGoStudio()} title="Every screen is config — edit this one in Studio"><Icon name="wand-2" size={14} style={{color:'var(--gx-gold)'}} />Configure page</button>
          <button className="btn btn-primary btn-sm"><Icon name="plus" size={14} />New work item</button>
        </>} />
      {view === 'table'
        ? <div className="card" style={{ overflow:'hidden' }}><WorkTable rows={WORKITEMS} /></div>
        : <Board />}
    </div>
  );
}

function Board() {
  const cols = [
    { k:'Open', tone:'var(--gx-neutral)', items: WORKITEMS.filter(w=>w.status==='Open') },
    { k:'In progress', tone:'var(--gx-warning)', items: WORKITEMS.filter(w=>w.status==='In progress') },
    { k:'Blocked', tone:'var(--gx-danger)', items: WORKITEMS.filter(w=>w.status==='Blocked') },
    { k:'Resolved', tone:'var(--gx-success)', items: WORKITEMS.filter(w=>w.status==='Resolved') },
  ];
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
      {cols.map(c => (
        <div key={c.k} style={{ background:'var(--gx-bg-subtle)', border:'1px solid var(--gx-border-subtle)', borderRadius:'var(--gx-radius-lg)', padding:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 6px 12px' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:c.tone }} />
            <span style={{ fontSize:12, fontWeight:600 }}>{c.k}</span>
            <span className="badge" style={{ background:'var(--gx-surface-2)', color:'var(--gx-text-3)', marginLeft:'auto' }}>{c.items.length}</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {c.items.map(it => (
              <div key={it.id} className="card" style={{ padding:12, cursor:'grab', boxShadow:'var(--gx-shadow-xs)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <span className="mono" style={{ fontSize:11, color:'var(--gx-link)' }}>{it.id}</span>
                  <span className={'pill '+it.pk} style={{ marginLeft:'auto', height:18 }}>{it.prio}</span>
                </div>
                <div style={{ fontSize:12.5, lineHeight:1.45, marginBottom:10 }}>{it.subject}</div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span className="avatar" style={{ width:22, height:22, fontSize:9 }}>{it.assignee}</span>
                  <span className="hint" style={{ fontSize:11, marginLeft:'auto', display:'flex', alignItems:'center', gap:4 }}><Icon name="clock" size={12} />{it.sla}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stub({ item }) {
  return (
    <div className="view-inner fade">
      <ViewHead icon={item.icon} title={item.label} sub="Configuration-driven page" />
      <div className="card"><div className="stub">
        <div className="si"><Icon name={item.icon} size={26} /></div>
        <div style={{ fontSize:15, fontWeight:600, color:'var(--gx-text-1)' }}>{item.label}</div>
        <p className="hint" style={{ maxWidth:380, lineHeight:1.6 }}>This page renders from configuration. Open <strong style={{ color:'var(--gx-gold)' }}>Studio</strong> to define its fields, workflow, columns and dashboards — no code required.</p>
        <button className="btn btn-gold btn-sm" onClick={()=>window.gxGoStudio&&window.gxGoStudio()}><Icon name="wand-2" size={14} />Configure in Studio</button>
      </div></div>
    </div>
  );
}

Object.assign(window, { ViewHead, Dashboard, WorkItems, WorkTable, Stub, Spark, BarChart, Board });
