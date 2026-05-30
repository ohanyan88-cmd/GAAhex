/* GAAex Portal — Studio: the config + design engine (the heart of GAAex). */

const STUDIO_NAV = [
  { group:'Schema', items:[ {id:'entities',label:'Entities',icon:'rows-3'},{id:'fields',label:'Fields',icon:'square-pen'},{id:'workflows',label:'Statuses / Workflows',icon:'arrow-right'} ] },
  { group:'UI', items:[ {id:'dashboards',label:'Dashboards',icon:'bar-chart-3'},{id:'views',label:'Views',icon:'layout-dashboard'},{id:'reports',label:'Reports',icon:'download'} ] },
  { group:'Logic', items:[ {id:'auto',label:'Automations',icon:'sparkles'} ] },
  { group:'Tenant', items:[ {id:'appear',label:'Appearance',icon:'palette'},{id:'perms',label:'Roles & Permissions',icon:'lock'} ] },
];

function Studio() {
  const [section, setSection] = React.useState('entities');
  return (
    <div className="view-inner fade" style={{ maxWidth: 1240 }}>
      <ViewHead icon="wand-2" title="Studio" sub="Configuration engine · zero-code entity, workflow & UI builder"
        actions={<button className="btn btn-secondary btn-sm"><Icon name="download" size={14} />Export config</button>} />
      <div className="studio">
        <aside className="studio-nav">
          {STUDIO_NAV.map(g => (
            <div key={g.group}>
              <div className="studio-nav-sec">{g.group}</div>
              {g.items.map(it => (
                <button key={it.id} className={'studio-nav-item' + (section===it.id?' on':'')} onClick={()=>setSection(it.id)}>
                  <Icon name={it.icon} size={14} />{it.label}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <section className="studio-pane">
          {section === 'entities' ? <EntityBuilder />
            : section === 'appear' ? <AppearancePane />
            : <StudioPlaceholder section={section} />}
        </section>
      </div>
    </div>
  );
}

function EntityBuilder() {
  const [label, setLabel] = React.useState('Opportunity');
  const [labelPlural, setLabelPlural] = React.useState('Opportunities');
  const [key, setKey] = React.useState('opportunity');
  const [slug, setSlug] = React.useState('opportunities');
  const [fields, setFields] = React.useState([
    { key:'name', label:'Name', type:'text', required:true, extra:'' },
    { key:'account', label:'Account', type:'ref', required:true, extra:'customer' },
    { key:'amount', label:'Amount', type:'money', required:false, extra:'' },
    { key:'stage', label:'Stage', type:'status', required:true, extra:'' },
  ]);
  const [statuses, setStatuses] = React.useState([
    { key:'NEW', label:'New', is_initial:true },
    { key:'QUALIFIED', label:'Qualified', is_initial:false },
    { key:'WON', label:'Won', is_initial:false },
  ]);
  const [created, setCreated] = React.useState(false);

  const upd = (i, patch) => setFields(f => f.map((r,j)=> j===i ? {...r,...patch} : r));
  const addField = () => setFields(f => [...f, { key:'', label:'', type:'text', required:false, extra:'' }]);
  const rmField = (i) => setFields(f => f.filter((_,j)=>j!==i));

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', marginBottom:18 }}>
        <div>
          <h3 style={{ margin:'0 0 4px', fontFamily:'var(--gx-font-sans)', fontSize:16, fontWeight:600 }}>New entity</h3>
          <p className="hint" style={{ margin:0 }}>Define an entity as configuration. No code, no SQL — it appears in the sidebar instantly.</p>
        </div>
        <span className="spacer" />
      </div>

      {created && (
        <div className="banner" style={{ marginBottom:16, borderLeftColor:'var(--gx-success)', background:'var(--gx-success-soft)' }}>
          <Icon name="check-circle-2" size={16} style={{ color:'var(--gx-success)', flexShrink:0, marginTop:1 }} />
          <div><div className="bt">Done</div><div className="bm">Created “{labelPlural}” — it's now in the sidebar and fully working.</div></div>
        </div>
      )}

      <div className="section-head" style={{ marginTop:0 }}><Icon name="square-pen" size={15} className="section-icon" />Identity</div>
      <div className="rec-form">
        <label className="field"><span>Key (snake_case) *</span><input className="inp inp-sm mono" value={key} onChange={e=>setKey(e.target.value)} /></label>
        <label className="field"><span>Label *</span><input className="inp inp-sm" value={label} onChange={e=>setLabel(e.target.value)} /></label>
        <label className="field"><span>Label plural</span><input className="inp inp-sm" value={labelPlural} onChange={e=>setLabelPlural(e.target.value)} /></label>
        <label className="field"><span>Route slug (kebab) *</span><input className="inp inp-sm mono" value={slug} onChange={e=>setSlug(e.target.value)} /></label>
        <label className="field"><span>Icon</span><input className="inp inp-sm" defaultValue="git-branch" /></label>
      </div>

      <div className="section-head"><Icon name="square-pen" size={15} className="section-icon" />Fields<span className="spacer" /><button className="btn btn-primary btn-sm" onClick={addField}><Icon name="plus" size={13} />Add field</button></div>
      <div className="card" style={{ overflow:'hidden' }}>
        <table className="grid">
          <thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Required</th><th>Options / ref</th><th></th></tr></thead>
          <tbody>
            {fields.map((f,i)=>(
              <tr key={i} style={{ cursor:'default' }}>
                <td><input className="inp inp-sm mono" value={f.key} onChange={e=>upd(i,{key:e.target.value})} /></td>
                <td><input className="inp inp-sm" value={f.label} onChange={e=>upd(i,{label:e.target.value})} /></td>
                <td><select className="inp inp-sm" value={f.type} onChange={e=>upd(i,{type:e.target.value})}>{FIELD_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></td>
                <td><input type="checkbox" checked={f.required} onChange={e=>upd(i,{required:e.target.checked})} /></td>
                <td><input className="inp inp-sm mono" value={f.extra} placeholder={f.type==='select'?'a, b, c':f.type==='ref'?'customer':''} onChange={e=>upd(i,{extra:e.target.value})} /></td>
                <td><button className="btn btn-ghost btn-sm btn-icon" onClick={()=>rmField(i)} aria-label="Remove"><Icon name="x" size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-head"><Icon name="arrow-right" size={15} className="section-icon" />Statuses</div>
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        {statuses.map((s,i)=>(
          <React.Fragment key={s.key}>
            <span className="pill" style={{ background:'var(--gx-surface-2)', border:'1px solid var(--gx-border)', height:26, color:'var(--gx-text-1)' }}>
              {s.is_initial && <span className="d" style={{ background:'var(--gx-gold)' }} />}<span className="mono">{s.key}</span>
            </span>
            {i<statuses.length-1 && <Icon name="arrow-right" size={14} style={{ color:'var(--gx-text-3)' }} />}
          </React.Fragment>
        ))}
        <button className="btn btn-ghost btn-sm"><Icon name="plus" size={13} />Status</button>
      </div>

      {/* Live preview — config becomes UI. Drives home "designable from Studio". */}
      <div className="section-head"><Icon name="eye" size={15} className="section-icon" />Live preview <span className="hint" style={{ fontWeight:400, marginLeft:6 }}>· what this config renders</span></div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <div className="card card-pad">
          <div className="lbl" style={{ marginBottom:12, fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Generated record form</div>
          <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
            {fields.filter(f=>f.key).map(f=>(
              <label className="field" key={f.key}><span>{f.label||f.key}{f.required && <span style={{ color:'var(--gx-danger)' }}> *</span>}</span>
                {f.type==='status'
                  ? <select className="inp inp-sm">{statuses.map(s=><option key={s.key}>{s.label}</option>)}</select>
                  : f.type==='boolean'
                  ? <div className="seg" style={{ alignSelf:'flex-start' }}><button className="on">Yes</button><button>No</button></div>
                  : <input className={'inp inp-sm'+(f.type==='money'||f.type==='number'?' mono':'')} placeholder={f.type==='money'?'$0.00':f.type==='ref'?('Pick a '+f.extra):f.type} />}
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop:14 }}><Icon name="check" size={13} />Save {label}</button>
        </div>
        <div className="card" style={{ overflow:'hidden' }}>
          <div className="card-head" style={{ padding:'10px 14px' }}><h3 style={{ fontSize:13 }}>{labelPlural}</h3><span className="spacer" /><span className="pill pill-neutral">list view</span></div>
          <table className="grid">
            <thead><tr>{fields.filter(f=>f.key).slice(0,4).map(f=><th key={f.key}>{f.label||f.key}</th>)}</tr></thead>
            <tbody>
              {[['Acme Fiber Rollout','Acme Corp','$48,000','QUALIFIED'],['City Mesh Expansion','Metro Gov','$120,000','NEW']].map((row,ri)=>(
                <tr key={ri} style={{ cursor:'default' }}>{fields.filter(f=>f.key).slice(0,4).map((f,ci)=>(
                  <td key={f.key} className={f.type==='money'?'mono tnum':''}>{f.type==='status'?<span className="pill pill-info">{row[ci]}</span>:row[ci]}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="banner" style={{ margin:'20px 0 18px' }}>
        <Icon name="info" size={16} style={{ color:'var(--gx-primary)', flexShrink:0, marginTop:1 }} />
        <div><div className="bt">Schema is config — no code change required</div>
          <div className="bm">Changes write to <code className="codez">studio_config</code>. Existing records validate lazily on next read. Destructive changes require confirmation with an impact summary.</div></div>
      </div>

      <button className="btn btn-gold btn-md" onClick={()=>{ setCreated(true); }}><Icon name="check" size={14} />Create entity</button>
    </div>
  );
}

const ACCENTS = [
  { name:'Azure', val:'#3B7BE0', hover:'#5293F2', active:'#2C63BC', soft:'rgba(59,123,224,.16)' },
  { name:'Cobalt', val:'#2A5187', hover:'#3A6299', active:'#1C3B68', soft:'rgba(42,81,135,.20)' },
  { name:'Gold', val:'#C5A059', hover:'#D2B06E', active:'#AC8847', soft:'rgba(197,160,89,.18)' },
  { name:'Emerald', val:'#1F9D57', hover:'#34C77B', active:'#16804A', soft:'rgba(31,157,87,.16)' },
  { name:'Violet', val:'#8B6FD6', hover:'#A78BE6', active:'#6F52BD', soft:'rgba(139,111,214,.18)' },
  { name:'Teal', val:'#2A9DB5', hover:'#41B4CC', active:'#1F8398', soft:'rgba(42,157,181,.18)' },
];
const RADII = [ ['Sharp',4],['Soft',8],['Rounded',13],['Pill',999] ];

function AppearancePane() {
  const [accent, setAccent] = React.useState(ACCENTS[0]);
  const [radius, setRadius] = React.useState(8);
  const [density, setDensity] = React.useState('Comfortable');
  const [paneTheme, setPaneTheme] = React.useState('Dark');
  const pad = density === 'Compact' ? '0 12px' : density === 'Spacious' ? '0 22px' : '0 16px';
  const ht = density === 'Compact' ? 28 : density === 'Spacious' ? 42 : 34;
  // live style vars scoped to the preview only
  const live = {
    '--gx-primary': accent.val, '--gx-primary-hover': accent.hover, '--gx-primary-active': accent.active, '--gx-primary-soft': accent.soft,
  };

  return (
    <div>
      <div style={{ marginBottom:18 }}>
        <h3 style={{ margin:'0 0 4px', fontFamily:'var(--gx-font-sans)', fontSize:16, fontWeight:600 }}>Appearance</h3>
        <p className="hint" style={{ margin:0 }}>Tenant branding. Set it once here — every rendered screen across all 18 modules updates. No code.</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'300px 1fr', gap:20 }}>
        {/* controls */}
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <div>
            <div className="lbl" style={{ marginBottom:9, fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Button / accent color</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {ACCENTS.map(a => (
                <button key={a.name} onClick={()=>setAccent(a)} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:'var(--gx-radius-md)', border:'1px solid '+(accent.name===a.name?a.val:'var(--gx-border)'), background:accent.name===a.name?'var(--gx-surface-2)':'transparent', cursor:'pointer', boxShadow:accent.name===a.name?('0 0 0 2px '+a.soft):'none' }}>
                  <span style={{ width:18, height:18, borderRadius:'50%', background:a.val, flexShrink:0 }} />
                  <span style={{ fontSize:12, color:'var(--gx-text-1)', fontWeight:accent.name===a.name?600:400 }}>{a.name}</span>
                </button>
              ))}
            </div>
            <div className="mono-chip" style={{ marginTop:10, fontFamily:'var(--gx-font-mono)', fontSize:12, background:'var(--gx-bg-subtle)', border:'1px solid var(--gx-border)', borderRadius:'var(--gx-radius-sm)', padding:'4px 9px', display:'inline-flex', gap:8, alignItems:'center', color:'var(--gx-text-1)' }}>
              <span style={{ width:12, height:12, borderRadius:3, background:accent.val }} />{accent.val.toUpperCase()}
            </div>
          </div>

          <div>
            <div className="lbl" style={{ marginBottom:9, fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Corner radius</div>
            <div className="seg" style={{ width:'100%' }}>{RADII.map(r => <button key={r[0]} className={radius===r[1]?'on':''} onClick={()=>setRadius(r[1])} style={{ flex:1 }}>{r[0]}</button>)}</div>
          </div>

          <div>
            <div className="lbl" style={{ marginBottom:9, fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Density</div>
            <div className="seg" style={{ width:'100%' }}>{['Compact','Comfortable','Spacious'].map(d => <button key={d} className={density===d?'on':''} onClick={()=>setDensity(d)} style={{ flex:1 }}>{d}</button>)}</div>
          </div>

          <div>
            <div className="lbl" style={{ marginBottom:9, fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Default theme</div>
            <div className="seg" style={{ width:'100%' }}>{['Dark','Light'].map(t => <button key={t} className={paneTheme===t?'on':''} onClick={()=>setPaneTheme(t)} style={{ flex:1 }}><Icon name={t==='Dark'?'moon':'sun'} size={13} />{t}</button>)}</div>
          </div>

          <div>
            <div className="lbl" style={{ marginBottom:9, fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Logo</div>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'var(--gx-bg-subtle)', border:'1px dashed var(--gx-border-strong)', borderRadius:'var(--gx-radius-md)' }}>
              <img src="../../assets/logo/GAAex-mark.svg" style={{ width:26, height:26 }} />
              <span className="hint" style={{ fontSize:12 }}>GAAex-mark.svg</span>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }}><Icon name="upload" size={13} />Replace</button>
            </div>
          </div>
        </div>

        {/* live preview */}
        <div data-theme={paneTheme.toLowerCase()} className="card card-pad" style={{ ...live, background:'var(--gx-surface)', display:'flex', flexDirection:'column', gap:18 }}>
          <div className="lbl" style={{ fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Live preview · applies everywhere</div>

          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
            <button style={{ height:ht, padding:pad, borderRadius:radius, border:'none', background:'var(--gx-primary)', color:'#fff', fontFamily:'var(--gx-font-sans)', fontWeight:600, fontSize:13, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:7 }}><Icon name="plus" size={14} />Primary</button>
            <button style={{ height:ht, padding:pad, borderRadius:radius, border:'1px solid var(--gx-border-strong)', background:'var(--gx-surface-2)', color:'var(--gx-text-1)', fontFamily:'var(--gx-font-sans)', fontWeight:600, fontSize:13, cursor:'pointer' }}>Secondary</button>
            <button style={{ height:ht, padding:pad, borderRadius:radius, border:'1px solid var(--gx-primary)', background:'transparent', color:'var(--gx-primary)', fontFamily:'var(--gx-font-sans)', fontWeight:600, fontSize:13, cursor:'pointer' }}>Outline</button>
            <button style={{ height:ht, width:ht, padding:0, borderRadius:radius, border:'none', background:'var(--gx-primary-soft)', color:'var(--gx-primary)', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="settings" size={15} /></button>
          </div>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <span style={{ display:'inline-flex', alignItems:'center', gap:6, height:22, padding:'0 9px', borderRadius:999, fontSize:11, fontWeight:600, background:'var(--gx-primary-soft)', color:'var(--gx-primary)' }}>Active</span>
            <span className="pill pill-success">Online</span><span className="pill pill-warning">Degraded</span><span className="pill pill-danger">SLA breached</span>
          </div>

          <label className="field"><span>Input field</span>
            <input className="inp inp-sm" defaultValue="Fiber 500" style={{ borderRadius:radius, height:ht }} onFocus={e=>{e.target.style.borderColor='var(--gx-primary)';e.target.style.boxShadow='0 0 0 3px var(--gx-primary-soft)';}} onBlur={e=>{e.target.style.borderColor='var(--gx-border)';e.target.style.boxShadow='none';}} />
          </label>

          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:radius, background:'var(--gx-bg-subtle)', border:'1px solid var(--gx-border)' }}>
            <span style={{ width:34, height:34, borderRadius:radius>20?'50%':radius, background:'var(--gx-primary-soft)', color:'var(--gx-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="users" size={17} /></span>
            <div><div style={{ fontSize:13, fontWeight:600 }}>Active subscribers</div><div className="hint" style={{ fontSize:11 }}>128,402 · +2.4%</div></div>
            <span style={{ marginLeft:'auto', fontFamily:'var(--gx-font-display)', fontSize:22, fontWeight:600, color:'var(--gx-primary)' }}>↗</span>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, marginTop:20 }}>
        <button className="btn btn-primary btn-md" style={{ background:accent.val }}><Icon name="check" size={14} />Save appearance</button>
        <button className="btn btn-ghost btn-md" onClick={()=>{setAccent(ACCENTS[0]);setRadius(8);setDensity('Comfortable');setPaneTheme('Dark');}}>Reset</button>
      </div>
    </div>
  );
}

function StudioPlaceholder({ section }) {
  const meta = {
    fields:['square-pen','Fields','Add, reorder and configure fields for any entity — type, validation, defaults, and conditional visibility (GXL).'],
    workflows:['arrow-right','Statuses / Workflows','Design status sets and the allowed transitions between them, each gated by an optional GXL guard expression.'],
    dashboards:['bar-chart-3','Dashboards','Compose KPI tiles, charts and lists onto a grid. Bind each widget to an entity, a metric and a filter — saved as config.'],
    views:['layout-dashboard','Views','Define table, board and calendar views per entity: columns, density, grouping, default sort and saved filters.'],
    reports:['download','Reports','Build tabular and pivot reports, schedule them, and pick export formats (CSV / XLSX / PDF).'],
    auto:['sparkles','Automations','Trigger → condition → action rules. Send notifications, move work items, call webhooks — all without code.'],
    appear:['palette','Appearance','Tenant branding: logo, accent, density and default theme. Applied across every rendered screen.'],
    perms:['lock','Roles & Permissions','Roles, field-level permissions and row-level access — enforced by the auth/authz kernel engine.'],
  }[section] || ['wand-2','Studio',''];
  return (
    <div className="stub" style={{ padding:'60px 20px' }}>
      <div className="si"><Icon name={meta[0]} size={26} /></div>
      <div style={{ fontSize:16, fontWeight:600, color:'var(--gx-text-1)' }}>{meta[1]}</div>
      <p className="hint" style={{ maxWidth:440, lineHeight:1.6 }}>{meta[2]}</p>
      <div className="seg"><button className="on"><Icon name="wand-2" size={13} />Builder</button><button><Icon name="code" size={13} />JSON</button></div>
    </div>
  );
}

Object.assign(window, { Studio });
