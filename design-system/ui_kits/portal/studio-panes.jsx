/* GAAhex Studio panes — the visual builder + config + publishing surfaces.
   Loaded after Studio.jsx; registers window.StudioPanes consumed by Studio(). */

const sec = (icon, title, hint, right) => (
  <div className="section-head" style={{ marginTop: 0 }}>
    <Icon name={icon} size={15} className="section-icon" />{title}
    {hint && <span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>· {hint}</span>}
    {right && <><span className="spacer" style={{ flex: 1 }} />{right}</>}
  </div>
);

/* 1 ── PAGE MANAGER ─────────────────────────────────────────────── */
function PageManager() {
  const TYPES = ['home','dashboard','list','form','detail','landing','checkout','profile','report'];
  const [pages, setPages] = React.useState([
    { id:'p1', name:'Operations Home', type:'home', status:'Published', updated:'2h ago' },
    { id:'p2', name:'Invoices', type:'list', status:'Published', updated:'1d ago' },
    { id:'p3', name:'New Order', type:'form', status:'Draft', updated:'3h ago' },
    { id:'p4', name:'Customer 360', type:'detail', status:'Published', updated:'5d ago' },
    { id:'p5', name:'Executive Dashboard', type:'dashboard', status:'Published', updated:'1w ago' },
    { id:'p6', name:'Upgrade Landing', type:'landing', status:'In review', updated:'30m ago' },
  ]);
  let _id = React.useRef(7);
  const add = () => { setPages(p => [{ id:'p'+(_id.current++), name:'Untitled page', type:'list', status:'Draft', updated:'now' }, ...p]); gxToast('Page created'); };
  const dup = (pg) => { setPages(p => [{ ...pg, id:'p'+(_id.current++), name:pg.name+' copy', status:'Draft', updated:'now' }, ...p]); gxToast('Page duplicated'); };
  const rename = (pg) => { const n = prompt('Rename page', pg.name); if (n) { setPages(p => p.map(x => x.id===pg.id?{...x,name:n,updated:'now'}:x)); gxToast('Renamed'); } };
  const del = (pg) => { setPages(p => p.filter(x => x.id!==pg.id)); gxToast('Page deleted','danger'); };
  const setType = (pg, t) => setPages(p => p.map(x => x.id===pg.id?{...x,type:t}:x));
  return (
    <div>
      {sec('files','Page Manager','create, duplicate, rename, delete pages', <button className="btn btn-primary btn-sm" onClick={add}><Icon name="plus" size={13} />New page</button>)}
      <div className="card" style={{ overflow:'hidden' }}>
        <table className="grid">
          <thead><tr><th>Page</th><th>Type</th><th>Status</th><th>Updated</th><th style={{width:120}}></th></tr></thead>
          <tbody>
            {pages.map(pg => (
              <tr key={pg.id} style={{ cursor:'default' }}>
                <td style={{ fontWeight:600 }}><span style={{display:'inline-flex',alignItems:'center',gap:8}}><Icon name="file" size={14} style={{color:'var(--gx-text-3)'}} />{pg.name}</span></td>
                <td><select className="inp inp-sm" style={{width:130}} value={pg.type} onChange={e=>setType(pg,e.target.value)}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></td>
                <td><span className={'pill ' + (pg.status==='Published'?'pill-success':pg.status==='Draft'?'pill-neutral':'pill-warning')}>{pg.status}</span></td>
                <td className="hint" style={{fontSize:11.5}}>{pg.updated}</td>
                <td><div style={{display:'flex',gap:2,justifyContent:'flex-end'}}>
                  <button className="btn btn-ghost btn-sm btn-icon" title="Rename" onClick={()=>rename(pg)}><Icon name="square-pen" size={14} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" title="Duplicate" onClick={()=>dup(pg)}><Icon name="copy" size={14} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" title="Delete" onClick={()=>del(pg)} style={{color:'var(--gx-danger-fg)'}}><Icon name="trash-2" size={14} /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* 2 ── LAYOUT BUILDER ───────────────────────────────────────────── */
function LayoutBuilder() {
  const PALETTE = [['rows-3','Section'],['columns-3','Columns'],['grid-3x3','Grid'],['square','Card'],['folder','Tabs'],['square-stack','Modal'],['minus','Divider'],['image','Media']];
  const [device, setDevice] = React.useState('desktop');
  const [blocks, setBlocks] = React.useState([
    { id:1, type:'Header', h:54 }, { id:2, type:'KPI Row · 4 cards', h:96 },
    { id:3, type:'Columns · Chart + List', h:180 }, { id:4, type:'Data Table', h:150 },
  ]);
  let _id = React.useRef(5);
  const addBlock = (t) => { setBlocks(b => [...b, { id:_id.current++, type:t, h:t==='Grid'?140:t==='Modal'?110:80 }]); gxToast(t+' added'); };
  const rm = (id) => setBlocks(b => b.filter(x => x.id!==id));
  const move = (i, d) => setBlocks(b => { const n=[...b]; const j=i+d; if(j<0||j>=n.length) return n; [n[i],n[j]]=[n[j],n[i]]; return n; });
  const W = device==='desktop'?'100%':device==='tablet'?620:340;
  return (
    <div>
      {sec('layout-template','Layout Builder','drag sections, columns, grids, cards, tabs, modals',
        <div className="seg">{[['desktop','monitor'],['tablet','tablet'],['mobile','smartphone']].map(d=><button key={d[0]} className={device===d[0]?'on':''} onClick={()=>setDevice(d[0])}><Icon name={d[1]} size={13} /></button>)}</div>)}
      <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:16 }}>
        <div>
          <div className="lbl" style={{fontSize:10,letterSpacing:'.12em',textTransform:'uppercase',color:'var(--gx-text-3)',marginBottom:8}}>Blocks</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {PALETTE.map(p => <button key={p[1]} className="palette-block" onClick={()=>addBlock(p[1])}><Icon name={p[0]} size={16} /><span>{p[1]}</span></button>)}
          </div>
          <p className="hint" style={{fontSize:11,marginTop:12,lineHeight:1.5}}>Click a block to drop it on the canvas. Reorder with the arrows; resize handles in full editor.</p>
        </div>
        <div className="card" style={{ padding:16, background:'var(--gx-bg-subtle)', minHeight:420 }}>
          <div style={{ width:W, margin:'0 auto', transition:'width var(--gx-dur-base)', display:'flex', flexDirection:'column', gap:10 }}>
            {blocks.map((b,i) => (
              <div key={b.id} className="canvas-block" style={{ height:b.h }}>
                <span className="canvas-tag">{b.type}</span>
                <div className="canvas-actions">
                  <button onClick={()=>move(i,-1)} title="Up"><Icon name="chevron-up" size={13} /></button>
                  <button onClick={()=>move(i,1)} title="Down"><Icon name="chevron-down" size={13} /></button>
                  <button onClick={()=>rm(b.id)} title="Remove" style={{color:'var(--gx-danger-fg)'}}><Icon name="x" size={13} /></button>
                </div>
              </div>
            ))}
            <button className="canvas-add" onClick={()=>addBlock('Section')}><Icon name="plus" size={14} />Add block</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 3 ── COMPONENTS LIBRARY ───────────────────────────────────────── */
function ComponentsLibrary() {
  const GROUPS = [
    ['Inputs', [['mouse-pointer-click','Button'],['text-cursor-input','Text field'],['list','Select'],['toggle-left','Toggle'],['calendar','Date picker']]],
    ['Data', [['table','Table'],['bar-chart-3','Chart'],['gauge','KPI tile'],['kanban','Board'],['list-tree','Tree']]],
    ['Layout', [['panel-top','Banner'],['menu','Menu'],['square','Card'],['folder','Tabs'],['rows-3','List']]],
    ['Content', [['file-text','Form'],['images','Gallery'],['badge-dollar-sign','Pricing card'],['quote','Testimonial'],['image','Media']]],
  ];
  const [q, setQ] = React.useState('');
  return (
    <div>
      {sec('blocks','Components Library','reusable blocks — drag into any page',
        <div className="tb-search" style={{width:200,height:30}}><Icon name="search" size={14} /><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search" style={{flex:1,background:'none',border:'none',outline:'none',color:'var(--gx-text-1)',fontSize:12.5,fontFamily:'var(--gx-font-sans)'}} /></div>)}
      {GROUPS.map(g => {
        const items = g[1].filter(c => !q || c[1].toLowerCase().includes(q.toLowerCase()));
        if (!items.length) return null;
        return (
          <div key={g[0]} style={{ marginBottom:18 }}>
            <div className="lbl" style={{fontSize:10,letterSpacing:'.12em',textTransform:'uppercase',color:'var(--gx-text-3)',marginBottom:10}}>{g[0]}</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(132px,1fr))', gap:10 }}>
              {items.map(c => (
                <button key={c[1]} className="comp-card" onClick={()=>gxToast(c[1]+' added to page')} draggable>
                  <span className="comp-ic"><Icon name={c[0]} size={18} /></span>
                  <span style={{fontSize:12.5,fontWeight:500}}>{c[1]}</span>
                  <Icon name="plus" size={13} className="comp-add" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* 4 ── CONTENT EDITOR ───────────────────────────────────────────── */
function ContentEditor() {
  const [tab, setTab] = React.useState('content');
  return (
    <div>
      {sec('type','Content Editor','text, images, links, labels & SEO',
        <div className="seg"><button className={tab==='content'?'on':''} onClick={()=>setTab('content')}>Content</button><button className={tab==='seo'?'on':''} onClick={()=>setTab('seo')}>SEO</button></div>)}
      {tab==='content' ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <label className="field"><span>Page title</span><input className="inp inp-sm" defaultValue="Operations Home" /></label>
          <label className="field"><span>Subtitle</span><input className="inp inp-sm" defaultValue="Yerevan Net · live across all modules" /></label>
          <label className="field" style={{gridColumn:'1 / -1'}}><span>Body text</span><textarea className="inp" rows={4} style={{height:'auto',padding:'10px 11px',lineHeight:1.6,resize:'vertical'}} defaultValue={"Welcome back. Here's your operations summary for today."} /></label>
          <label className="field"><span>Primary button label</span><input className="inp inp-sm" defaultValue="Create" /></label>
          <label className="field"><span>Button link</span><input className="inp inp-sm mono" defaultValue="/revenue/orders/new" /></label>
          <label className="field"><span>Image</span><div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'var(--gx-bg-subtle)',border:'1px dashed var(--gx-border-strong)',borderRadius:'var(--gx-radius-md)'}}><Icon name="image" size={18} style={{color:'var(--gx-text-3)'}} /><span className="hint" style={{fontSize:12}}>hero.png</span><button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>gxToast('Upload image')}><Icon name="upload" size={13} />Replace</button></div></label>
          <label className="field"><span>Placeholder text</span><input className="inp inp-sm" defaultValue="Search work items…" /></label>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:14, maxWidth:560 }}>
          <label className="field"><span>SEO title</span><input className="inp inp-sm" defaultValue="Operations Home · GAAhex" /><span className="hint" style={{fontSize:11}}>58 / 60 characters</span></label>
          <label className="field"><span>Meta description</span><textarea className="inp" rows={3} style={{height:'auto',padding:'10px 11px',lineHeight:1.6,resize:'vertical'}} defaultValue="Operations summary and quick actions for the GAAhex platform." /></label>
          <label className="field"><span>URL slug</span><input className="inp inp-sm mono" defaultValue="/home" /></label>
          <div className="seo-preview"><div style={{fontSize:13,color:'var(--azure-300)'}}>Operations Home · GAAhex</div><div className="mono" style={{fontSize:11,color:'var(--gx-success-fg)'}}>gaahex.app › home</div><div style={{fontSize:12,color:'var(--gx-text-2)',marginTop:2}}>Operations summary and quick actions for the GAAhex platform.</div></div>
        </div>
      )}
      <div style={{marginTop:18}}><button className="btn btn-primary btn-sm" onClick={()=>gxToast('Content saved')}><Icon name="check" size={13} />Save content</button></div>
    </div>
  );
}

/* 5 ── DATA BINDING ─────────────────────────────────────────────── */
function DataBinding() {
  const [showModel, setShowModel] = React.useState(false);
  const SOURCES = ['Customers','Orders','Invoices','Tickets','Devices','Subscriptions','Payments'];
  const [binds, setBinds] = React.useState([
    { comp:'KPI · Active subscribers', src:'Customers', field:'count(status=Active)' },
    { comp:'Table · Recent invoices', src:'Invoices', field:'list · sort by date desc' },
    { comp:'Chart · Revenue', src:'Payments', field:'sum(amount) by month' },
  ]);
  if (showModel) return (<div><button className="btn btn-ghost btn-sm" style={{marginBottom:12}} onClick={()=>setShowModel(false)}><Icon name="chevron-left" size={14} />Back to bindings</button><EntityBuilder /></div>);
  return (
    <div>
      {sec('database','Data Binding','connect components to database / API fields',
        <button className="btn btn-secondary btn-sm" onClick={()=>setShowModel(true)}><Icon name="boxes" size={13} />Manage data model</button>)}
      <div className="banner" style={{ marginBottom:16 }}>
        <Icon name="info" size={16} style={{ color:'var(--gx-primary)', flexShrink:0, marginTop:1 }} />
        <div><div className="bt">Bindings are live</div><div className="bm">Each component reads from an entity or API. Changes apply to every rendered instance.</div></div>
      </div>
      <div className="card" style={{ overflow:'hidden' }}>
        <table className="grid">
          <thead><tr><th>Component</th><th>Data source</th><th>Binding</th><th style={{width:40}}></th></tr></thead>
          <tbody>
            {binds.map((b,i) => (
              <tr key={i} style={{cursor:'default'}}>
                <td style={{fontWeight:600}}>{b.comp}</td>
                <td><select className="inp inp-sm" style={{width:140}} value={b.src} onChange={e=>setBinds(bs=>bs.map((x,j)=>j===i?{...x,src:e.target.value}:x))}>{SOURCES.map(s=><option key={s}>{s}</option>)}</select></td>
                <td className="mono" style={{fontSize:12,color:'var(--gx-text-2)'}}>{b.field}</td>
                <td><button className="btn btn-ghost btn-sm btn-icon"><Icon name="unlink" size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-primary btn-sm" style={{marginTop:14}} onClick={()=>gxToast('Add binding')}><Icon name="plus" size={13} />Bind a component</button>
    </div>
  );
}

/* 6 ── ACTIONS & LOGIC ──────────────────────────────────────────── */
function ActionsLogic() {
  const [rules, setRules] = React.useState([
    { on:'Button "Create" click', cond:'always', act:'Open form → New Order', en:true },
    { on:'Form submit', cond:'valid', act:'Save record + toast "Created"', en:true },
    { on:'Status = Overdue', cond:'amount > $500', act:'Notify collections team', en:true },
    { on:'Row click', cond:'role = Agent', act:'Open record drawer', en:false },
  ]);
  const toggle = (i) => setRules(r => r.map((x,j)=>j===i?{...x,en:!x.en}:x));
  return (
    <div>
      {sec('zap','Actions & Logic','button actions, submit behavior, navigation, conditions, visibility',
        <button className="btn btn-primary btn-sm" onClick={()=>gxToast('New rule')}><Icon name="plus" size={13} />New rule</button>)}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {rules.map((r,i) => (
          <div key={i} className="rule-card">
            <span className="rule-pill" style={{background:'var(--gx-primary-soft)',color:'var(--gx-info-fg)'}}><Icon name="bolt" size={12} />WHEN</span>
            <span style={{fontSize:12.5,fontWeight:600}}>{r.on}</span>
            <span className="rule-pill" style={{background:'var(--gx-warning-soft)',color:'var(--gx-warning-fg)'}}>IF</span>
            <span className="mono" style={{fontSize:12,color:'var(--gx-text-2)'}}>{r.cond}</span>
            <Icon name="arrow-right" size={14} style={{color:'var(--gx-text-3)'}} />
            <span className="rule-pill" style={{background:'var(--gx-success-soft)',color:'var(--gx-success-fg)'}}>DO</span>
            <span style={{fontSize:12.5}}>{r.act}</span>
            <span className="spacer" style={{flex:1}} />
            <button onClick={()=>toggle(i)} className={'gx-toggle'+(r.en?' on':'')}><span className="knob" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* 7 ── PERMISSIONS ──────────────────────────────────────────────── */
function Permissions() {
  const ROLES = ['Admin','Manager','Agent','Field Tech','Guest'];
  const PAGES = ['Operations Home','Invoices','New Order','Customer 360','Settings'];
  const lvl = (ri, pi) => { if (ri===0) return 'edit'; if (ri===4) return pi<2?'view':'none'; if (ri===1) return pi===4?'view':'edit'; if (ri===2) return pi===4?'none':'view'; return pi===0?'view':'none'; };
  const [grid, setGrid] = React.useState(() => PAGES.map((_,pi)=>ROLES.map((_,ri)=>lvl(ri,pi))));
  const cycle = (pi,ri) => setGrid(g => g.map((row,p)=>p===pi?row.map((c,r)=>r===ri?(c==='none'?'view':c==='view'?'edit':'none'):c):row));
  const dot = (v) => v==='edit'?['Edit','var(--gx-success)']:v==='view'?['View','var(--gx-warning)']:['—','var(--gx-text-3)'];
  return (
    <div>
      {sec('lock','Permissions','control who can view / edit each page or component')}
      <div className="card" style={{ overflow:'hidden' }}>
        <table className="grid">
          <thead><tr><th>Page</th>{ROLES.map(r=><th key={r} style={{textAlign:'center'}}>{r}</th>)}</tr></thead>
          <tbody>
            {PAGES.map((pg,pi) => (
              <tr key={pg} style={{cursor:'default'}}>
                <td style={{fontWeight:600}}>{pg}</td>
                {ROLES.map((_,ri) => { const d=dot(grid[pi][ri]); return (
                  <td key={ri} style={{textAlign:'center'}}>
                    <button className="perm-cell" onClick={()=>cycle(pi,ri)} style={{color:d[1]}} title="Click to cycle"><span style={{width:7,height:7,borderRadius:'50%',background:d[1]}} />{d[0]}</button>
                  </td>
                ); })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{fontSize:11.5,marginTop:10}}>Click a cell to cycle None → View → Edit. Enforced server-side by the auth kernel — UI hiding is not authorization.</p>
    </div>
  );
}

/* 8 ── PREVIEW MODE ─────────────────────────────────────────────── */
function PreviewMode() {
  const [device, setDevice] = React.useState('desktop');
  const [role, setRole] = React.useState('Admin');
  const W = device==='desktop'?'100%':device==='tablet'?640:360;
  return (
    <div>
      {sec('eye','Preview Mode','preview as device & as different user roles',
        <div style={{display:'flex',gap:8}}>
          <select className="inp inp-sm" style={{width:130}} value={role} onChange={e=>setRole(e.target.value)}>{['Admin','Manager','Agent','Field Tech','Guest'].map(r=><option key={r}>{r}</option>)}</select>
          <div className="seg">{[['desktop','monitor'],['tablet','tablet'],['mobile','smartphone']].map(d=><button key={d[0]} className={device===d[0]?'on':''} onClick={()=>setDevice(d[0])}><Icon name={d[1]} size={13} /></button>)}</div>
        </div>)}
      <div className="card" style={{ padding:16, background:'var(--gx-bg-subtle)' }}>
        <div style={{ width:W, margin:'0 auto', transition:'width var(--gx-dur-base)', background:'var(--gx-surface)', border:'1px solid var(--gx-border)', borderRadius:'var(--gx-radius-lg)', overflow:'hidden', boxShadow:'var(--gx-shadow-md)' }}>
          <div style={{ height:38, borderBottom:'1px solid var(--gx-border-subtle)', display:'flex', alignItems:'center', gap:8, padding:'0 12px' }}>
            <span style={{display:'flex',gap:5}}><span style={{width:8,height:8,borderRadius:'50%',background:'var(--gx-danger)'}} /><span style={{width:8,height:8,borderRadius:'50%',background:'var(--gx-warning)'}} /><span style={{width:8,height:8,borderRadius:'50%',background:'var(--gx-success)'}} /></span>
            <span className="mono" style={{fontSize:11,color:'var(--gx-text-3)'}}>gaahex.app/home</span>
            <span className="pill pill-gold" style={{marginLeft:'auto',height:18}}>as {role}</span>
          </div>
          <div style={{ padding:18 }}>
            <div style={{fontFamily:'var(--gx-font-display)',fontSize:18,fontWeight:600,marginBottom:12}}>Operations Home</div>
            <div style={{display:'grid',gridTemplateColumns: device==='mobile'?'1fr 1fr':'repeat(4,1fr)',gap:10,marginBottom:14}}>
              {['128,402','$1.84M','347','99.98%'].map((v,i)=><div key={i} className="tile" style={{padding:12}}><div className="lbl" style={{fontSize:9}}>Metric</div><div style={{fontFamily:'var(--gx-font-display)',fontSize:18,fontWeight:600,marginTop:4}}>{v}</div></div>)}
            </div>
            <div style={{height:80,borderRadius:'var(--gx-radius-md)',background:'linear-gradient(180deg,var(--gx-surface-2),var(--gx-bg-subtle))',border:'1px solid var(--gx-border-subtle)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--gx-text-3)',fontSize:12}}>{role==='Guest'?'Restricted — sign in to view data':'Chart · Revenue vs. churn'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 9 ── VERSION HISTORY ──────────────────────────────────────────── */
function VersionHistory() {
  const V = [
    { v:'v12', label:'Current draft', who:'Gevorg V.', t:'2h ago', tag:'Draft', cur:true },
    { v:'v11', label:'Added Revenue Assurance KPIs', who:'Ani H.', t:'1d ago', tag:'Published' },
    { v:'v10', label:'New invoice table columns', who:'Narek M.', t:'3d ago', tag:'Published' },
    { v:'v9', label:'Layout redesign', who:'Gevorg V.', t:'1w ago', tag:'Published' },
    { v:'v8', label:'Initial publish', who:'Gevorg V.', t:'2w ago', tag:'Published' },
  ];
  return (
    <div>
      {sec('history','Version History','save drafts, publish, rollback, compare',
        <button className="btn btn-secondary btn-sm" onClick={()=>gxToast('Comparing v12 ↔ v11')}><Icon name="git-compare" size={13} />Compare</button>)}
      <div className="timeline">
        {V.map((r,i) => (
          <div key={i} className="tl-item">
            <span className="tl-dot" style={{ background:r.cur?'var(--gx-primary-soft)':'var(--gx-surface-2)', color:r.cur?'var(--gx-primary)':'var(--gx-text-3)' }}><Icon name={r.cur?'pencil':'git-commit-horizontal'} size={13} /></span>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span className="mono" style={{fontSize:12,color:'var(--gx-link)'}}>{r.v}</span>
                <span style={{fontSize:13,fontWeight:600}}>{r.label}</span>
                <span className={'pill ' + (r.tag==='Draft'?'pill-neutral':'pill-success')} style={{height:18}}>{r.tag}</span>
                <span className="spacer" style={{flex:1}} />
                {!r.cur && <button className="btn btn-ghost btn-sm" onClick={()=>gxToast('Rolled back to '+r.v)}><Icon name="rotate-ccw" size={13} />Rollback</button>}
              </div>
              <div className="hint" style={{fontSize:11.5,marginTop:2}}>{r.who} · {r.t}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* 10 ── TEMPLATES ───────────────────────────────────────────────── */
function Templates() {
  const T = [
    ['layout-dashboard','Operations Dashboard','KPI tiles + charts + activity'],
    ['rows-3','Data List','Searchable table + filters'],
    ['file-text','Record Form','Two-column form + actions'],
    ['id-card','Customer 360','Profile + related records'],
    ['credit-card','Checkout','Cart + payment + summary'],
    ['rocket','Landing Page','Hero + features + CTA'],
    ['kanban','Work Board','Kanban columns by status'],
    ['bar-chart-3','Analytics Report','Charts + pivot + export'],
  ];
  return (
    <div>
      {sec('store','Templates','ready-made pages & reusable saved sections')}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))', gap:14 }}>
        {T.map(t => (
          <div key={t[1]} className="tpl-card">
            <div className="tpl-thumb"><Icon name={t[0]} size={26} /></div>
            <div style={{padding:'12px 14px'}}>
              <div style={{fontSize:13,fontWeight:600}}>{t[1]}</div>
              <div className="hint" style={{fontSize:11.5,marginTop:2,lineHeight:1.4}}>{t[2]}</div>
              <button className="btn btn-secondary btn-sm" style={{width:'100%',marginTop:10}} onClick={()=>gxToast('“'+t[1]+'” added')}><Icon name="plus" size={13} />Use template</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* 11 ── PUBLISH SETTINGS ────────────────────────────────────────── */
function PublishSettings() {
  const [status, setStatus] = React.useState('Draft');
  const [access, setAccess] = React.useState('Authenticated');
  const [code, setCode] = React.useState(false);
  return (
    <div>
      {sec('rocket','Publish Settings','slug, status, access, language, metadata, custom code')}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, maxWidth:680 }}>
        <label className="field"><span>URL slug</span><input className="inp inp-sm mono" defaultValue="/home" /></label>
        <label className="field"><span>Status</span><div className="seg" style={{width:'100%'}}>{['Draft','In review','Published'].map(s=><button key={s} className={status===s?'on':''} onClick={()=>setStatus(s)} style={{flex:1}}>{s}</button>)}</div></label>
        <label className="field"><span>Access level</span><select className="inp inp-sm" value={access} onChange={e=>setAccess(e.target.value)}>{['Public','Authenticated','Role-restricted','Admin only'].map(a=><option key={a}>{a}</option>)}</select></label>
        <label className="field"><span>Language</span><select className="inp inp-sm" defaultValue="Հայերեն (hy-AM)">{['Հայերեն (hy-AM)','English (en)','Русский (ru)'].map(l=><option key={l}>{l}</option>)}</select></label>
        <label className="field" style={{gridColumn:'1 / -1'}}><span>Page metadata (title / description)</span><input className="inp inp-sm" defaultValue="Operations Home · GAAhex" style={{marginBottom:8}} /><textarea className="inp" rows={2} style={{height:'auto',padding:'10px 11px',lineHeight:1.6,resize:'vertical'}} defaultValue="Operations summary and quick actions." /></label>
      </div>
      <div className="section-head"><Icon name="code" size={15} className="section-icon" />Custom code<span className="spacer" style={{flex:1}} /><button onClick={()=>setCode(c=>!c)} className={'gx-toggle'+(code?' on':'')}><span className="knob" /></button></div>
      {code && <textarea className="inp mono" rows={4} style={{height:'auto',padding:'10px 11px',lineHeight:1.6,resize:'vertical',fontSize:12}} placeholder="<!-- custom head/script injected on publish -->" defaultValue={'<script>/* analytics */</script>'} />}
      <div style={{display:'flex',gap:10,marginTop:18}}>
        <button className="btn btn-primary" onClick={()=>gxToast('Published to production')}><Icon name="rocket" size={14} />Publish now</button>
        <button className="btn btn-secondary" onClick={()=>gxToast('Saved as draft')}><Icon name="save" size={14} />Save draft</button>
      </div>
    </div>
  );
}

window.StudioPanes = { PageManager, LayoutBuilder, ComponentsLibrary, ContentEditor, DataBinding, ActionsLogic, Permissions, PreviewMode, VersionHistory, Templates, PublishSettings };
