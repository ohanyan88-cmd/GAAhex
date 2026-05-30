/* GAAex Studio — full platform tree (SuperAdmin only).
   9 groups → modules → leaves. Marquee leaves use rich builders (window.StudioPanes,
   AppearancePane, EntityBuilder); the rest render branded archetype panes — never empty stubs.
   Overrides window.Studio (loaded after Studio.jsx + studio-panes.jsx). */

// compact tree: [groupLabel, icon, modulesOrItems]
// module = [moduleLabel, icon, [leaf,...]]; a group can hold flat [leaf,...] instead of modules.
const G = (label, icon, body) => ({ label, icon, body });
const M = (label, icon, items) => ({ label, icon, items });

const STUDIO_TREE = [
  G('Experience', 'monitor', [
    M('Pages', 'files', ['Page Registry','Page Builder','Routing','Navigation','Breadcrumbs','Meta Tags','SEO','Redirects','Dynamic Pages','Page States','Access Mapping','Visibility Rules','Page Versioning','Page Analytics']),
    M('Components', 'blocks', ['Component Registry','Component Builder','Component Categories','Variants','Slots','Properties','Events','Behaviors','State Management','Component Permissions','Component Versioning','Component Marketplace']),
    M('Layouts', 'layout-template', ['Grid System','Containers','Sections','Responsive Rules','Breakpoints','Layout Templates','Layout Library','Layout Conditions','Layout Inheritance']),
    M('Templates', 'store', ['CRM','ERP','HRM','LMS','E-Commerce','Portals','Dashboards','Landing Pages','Websites','Custom Templates']),
    M('Themes', 'palette', ['Brand Identity','Logos','Colors','Typography','Icons','Shadows','Border Radius','Spacing Scale','Animations','Light Mode','Dark Mode','Design Tokens','Theme Inheritance']),
  ]),
  G('Data', 'database', [
    M('Models', 'boxes', ['Entities','Fields','Relationships','Constraints','Validation','Enumerations','Calculated Fields','Virtual Fields','Audit Fields','Schema Versioning']),
    M('Data Sources', 'server', ['PostgreSQL','MySQL','MongoDB','SQL Server','Oracle','Firebase','External APIs','CSV','Excel','Data Warehouses']),
    M('APIs', 'code', ['REST','GraphQL','gRPC','Webhooks','API Gateway','API Policies','API Security','Rate Limits','API Monitoring','API Documentation']),
    M('Integrations', 'blocks', ['Payments','Messaging','Email','AI Providers','CRM Systems','ERP Systems','Identity Providers','Cloud Services','Analytics Tools','Custom Connectors']),
    M('Assets', 'image', ['Images','Videos','Documents','Fonts','Icons','Audio','Media Optimization','CDN','Asset Versioning']),
  ]),
  G('Logic', 'zap', [
    M('Workflows', 'git-branch', ['Workflow Designer','Process Maps','Approval Chains','State Machines','Workflow Variables','Workflow Templates','Workflow Versions','Workflow Logs','Workflow Metrics']),
    M('Automations', 'bolt', ['Triggers','Conditions','Actions','Schedules','Jobs','Queues','Retries','Notifications','Automation History']),
    M('Rules Engine', 'scale', ['Business Rules','Validation Rules','Decision Trees','Formula Builder','Rule Testing','Rule Versions','Rule Audit']),
    M('Events', 'radio', ['Event Registry','Event Bus','Event Consumers','Event Producers','Event Replay','Event Logs','Event Monitoring','Dead Letter Queue']),
  ]),
  G('Security', 'shield', ['Roles','Permissions','Policies','Authentication','Authorization','MFA','SSO','OAuth','Session Policies','Password Policies','Secrets Vault','Encryption','Certificates','IP Restrictions','Geo Restrictions','Device Trust','Threat Detection']),
  G('Intelligence', 'sparkles', [
    M('AI', 'sparkles', ['Models','Providers','Agents','Prompts','Knowledge Bases','RAG','Embeddings','Tool Registry','AI Workflows','Usage Tracking','Cost Monitoring']),
    M('Analytics', 'bar-chart-3', ['Dashboards','Reports','KPIs','Funnels','Cohorts','Usage Metrics','Revenue Metrics','Custom Metrics']),
    M('Monitoring', 'activity', ['Health Checks','Logs','Errors','Traces','Performance','Alerts','Incidents','SLA Tracking']),
  ]),
  G('Quality', 'check-check', ['Testing','Accessibility','Preview','Versioning','QA Pipelines','Test Data','Regression Testing','Load Testing','Security Testing','Release Validation']),
  G('Release', 'rocket', ['Deployment','Environments','Feature Flags','Release Channels','Blue-Green Deployment','Canary Deployment','Rollbacks','Deployment Pipelines','Release Approvals']),
  G('Governance', 'gavel', ['Audit Logs','Activity History','Compliance','Policies','Data Retention','Legal Documents','Change Management','Risk Management','Data Classification','Governance Reports']),
  G('System Control', 'settings', ['Platform Settings','Global Configuration','Tenant Management','Multi-Tenancy','Subscription Plans','Billing Engine','Usage Limits','Quotas','Backup Center','Disaster Recovery','Infrastructure','Services','Storage','Cache','Queues','Cron Jobs','Environment Variables','License Management','Maintenance Mode','System Health','Emergency Controls','Danger Zone']),
  G('Marketplace', 'store', ['Plugins','Extensions','App Templates','Connector Store']),
  G('Developer', 'code', ['Custom Code','SDK','CLI','Webhooks','API Docs']),
  G('Notifications', 'bell', ['Email Templates','SMS Templates','Push Notifications','In-App Notifications','Notification Rules']),
  G('Search', 'search', ['Global Search','Search Indexes','Search Ranking','Search Permissions']),
  G('Import / Export', 'arrow-left-right', ['Data Import','Data Export','Template Export','Migration Tools']),
  G('Documentation', 'book-open', ['System Docs','User Guides','API Docs','Changelog']),
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// flatten → [{ id, leaf, group, groupIcon, module, moduleIcon }]
const STUDIO_LEAVES = [];
STUDIO_TREE.forEach(g => {
  const flat = Array.isArray(g.body) && typeof g.body[0] === 'string';
  const mods = flat ? [{ label: null, icon: g.icon, items: g.body }] : g.body;
  mods.forEach(m => m.items.forEach(leaf => {
    STUDIO_LEAVES.push({ id: slug(g.label) + '.' + (m.label ? slug(m.label) + '.' : '') + slug(leaf), leaf, group: g.label, groupIcon: g.icon, module: m.label, moduleIcon: m.icon });
  }));
});
const LEAF_BY_ID = Object.fromEntries(STUDIO_LEAVES.map(l => [l.id, l]));

/* ── rich-pane routing: leaf label → existing builder ── */
function richPaneFor(leaf) {
  const P = window.StudioPanes || {};
  const map = {
    'Page Registry': P.PageManager, 'Page Builder': P.LayoutBuilder, 'Dynamic Pages': P.PageManager,
    'Page Versioning': P.VersionHistory, 'Component Registry': P.ComponentsLibrary, 'Component Builder': P.ComponentsLibrary,
    'Component Marketplace': P.ComponentsLibrary, 'Grid System': P.LayoutBuilder, 'Layout Templates': P.LayoutBuilder,
    'Layout Library': P.Templates, 'Custom Templates': P.Templates, 'Brand Identity': window.AppearancePane,
    'Colors': window.AppearancePane, 'Design Tokens': window.AppearancePane, 'Theme Inheritance': window.AppearancePane,
    'Entities': window.EntityBuilder, 'Fields': window.EntityBuilder, 'External APIs': P.DataBinding,
    'REST': P.DataBinding, 'GraphQL': P.DataBinding, 'Triggers': P.ActionsLogic, 'Conditions': P.ActionsLogic,
    'Actions': P.ActionsLogic, 'Business Rules': P.ActionsLogic, 'Permissions': P.Permissions,
    'Component Permissions': P.Permissions, 'Access Mapping': P.Permissions, 'Preview': P.PreviewMode,
    'Versioning': P.VersionHistory, 'Workflow Versions': P.VersionHistory, 'Deployment': P.PublishSettings,
    'SEO': P.ContentEditor, 'Meta Tags': P.ContentEditor,
  };
  return map[leaf] || null;
}

/* ── archetype detection for everything else ── */
function archetypeFor(leaf) {
  const s = leaf.toLowerCase();
  if (/typography|shadow|radius|spacing|icons|animation|logos/.test(s)) return 'tokens';
  if (/logs|monitoring|metrics|traces|errors|health|performance|alerts|incidents|usage|tracking|analytics|sla|history|audit|replay/.test(s)) return 'monitor';
  if (/designer|process maps|decision trees|formula|state machines|grid|builder|maps/.test(s)) return 'canvas';
  if (/registry|categories|library|marketplace|sources|providers|connectors|channels|environments|plans|documents|warehouses|pipelines|consumers|producers|certificates|agents|prompts|knowledge|tool registry|reports|dashboards|kpis|funnels|cohorts|templates|variants|slots|properties|events|jobs|queues|schedules|services|infrastructure|integrations|systems|plugins|extensions|connector|store|webhooks|indexes|push|in-app|guides|docs|sdk|cli/.test(s)) return 'table';
  if (/changelog/.test(s)) return 'monitor';
  return 'form';
}

const TONE = ['var(--azure-400)','var(--gx-gold)','var(--gx-success)','var(--violet-400)','var(--gx-warning)','#2A9DB5'];

function StudioGenericPane({ leaf }) {
  const arch = archetypeFor(leaf.leaf);
  const desc = {
    tokens: 'Define and preview design tokens. Changes cascade to every rendered surface.',
    monitor: 'Live observability — status, throughput and recent events for this surface.',
    canvas: 'Visual builder canvas. Drag nodes/blocks; connect and configure on the right.',
    table: 'Registry of configured items. Create, edit, version and govern each entry.',
    form: 'Configuration for this capability. Settings are saved to config and audited.',
  }[arch];
  return (
    <div>
      <div className="crumbs" style={{ marginTop: 0 }}>
        <span>{leaf.group}</span>{leaf.module && <><span className="sep">/</span><span>{leaf.module}</span></>}
        <span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{leaf.leaf}</span>
      </div>
      <div className="section-head" style={{ marginTop: 6 }}>
        <Icon name={leaf.moduleIcon || leaf.groupIcon} size={16} className="section-icon" />{leaf.leaf}
        <span className="spacer" style={{ flex: 1 }} />
        {arch === 'form' && <button className="btn btn-primary btn-sm" onClick={() => gxToast(leaf.leaf + ' saved')}><Icon name="check" size={13} />Save</button>}
      </div>
      <p className="hint" style={{ marginTop: -4, marginBottom: 16 }}>{desc}</p>
      {arch === 'table' && <ArchTable leaf={leaf} />}
      {arch === 'tokens' && <ArchTokens leaf={leaf} />}
      {arch === 'monitor' && <ArchMonitor leaf={leaf} />}
      {arch === 'canvas' && <ArchCanvas leaf={leaf} />}
      {arch === 'form' && <ArchForm leaf={leaf} />}
    </div>
  );
}

function ArchTable({ leaf }) {
  const single = leaf.leaf.replace(/s$/, '');
  const seed = Array.from({ length: 6 }, (_, i) => ({
    __id: 'a' + i, name: single + ' ' + (i + 1), type: ['Default','Custom','System','Shared'][i % 4],
    status: ['Active','Active','Draft','Active','Disabled','Active'][i], updated: ['2h ago','1d ago','3d ago','1w ago','2w ago','1mo ago'][i],
  }));
  const [rows, setRows] = React.useState(seed);
  React.useEffect(() => { setRows(seed); }, [leaf.id]);
  const _n = React.useRef(7);
  const add = () => { setRows(r => [{ __id:'n'+(_n.current++), name: single + ' ' + _n.current, type:'Custom', status:'Draft', updated:'now' }, ...r]); gxToast(single + ' created'); };
  const del = (id) => { setRows(r => r.filter(x => x.__id !== id)); gxToast('Deleted','danger'); };
  const dup = (row) => { setRows(r => [{ ...row, __id:'n'+(_n.current++), name: row.name + ' copy', status:'Draft', updated:'now' }, ...r]); gxToast('Duplicated'); };
  const cycle = (id) => setRows(r => r.map(x => x.__id===id ? { ...x, status: x.status==='Active'?'Draft':x.status==='Draft'?'Disabled':'Active' } : x));
  const rename = (row) => { const n = prompt('Rename', row.name); if (n) setRows(r => r.map(x => x.__id===row.__id?{...x,name:n,updated:'now'}:x)); };
  return (
    <div>
      <div style={{ display:'flex', marginBottom:10 }}>
        <span className="spacer" style={{ flex:1 }} />
        <button className="btn btn-primary btn-sm" onClick={add}><Icon name="plus" size={13} />New {single.toLowerCase()}</button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="grid">
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Updated</th><th style={{ width: 44 }}></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.__id} style={{ cursor: 'default' }}>
                <td style={{ fontWeight: 600 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: TONE[i % TONE.length] }} />{r.name}</span></td>
                <td style={{ color: 'var(--gx-text-2)' }}>{r.type}</td>
                <td><button className={'pill ' + (r.status === 'Active' ? 'pill-success' : r.status === 'Draft' ? 'pill-neutral' : 'pill-danger')} style={{ border:'none', cursor:'pointer' }} onClick={() => cycle(r.__id)} title="Click to change">{r.status}</button></td>
                <td className="hint" style={{ fontSize: 11.5 }}>{r.updated}</td>
                <td><RowMenu onView={()=>gxToast('Open '+r.name)} onEdit={()=>rename(r)} onDup={()=>dup(r)} onDelete={()=>del(r.__id)} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', padding:'34px', color:'var(--gx-text-3)' }}>No items yet — click “New {single.toLowerCase()}”.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArchTokens({ leaf }) {
  const s = leaf.leaf.toLowerCase();
  if (/radius/.test(s)) return <div className="wrap">{[['xs',5],['sm',8],['md',12],['lg',16],['xl',22]].map(r => <div key={r[0]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}><div style={{ width: 60, height: 60, background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border-strong)', borderRadius: r[1] }} /><span className="mono muted" style={{ fontSize: 10 }}>{r[0]} · {r[1]}</span></div>)}</div>;
  if (/spacing/.test(s)) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[2,4,8,12,16,24,32].map(v => <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="mono muted" style={{ width: 56, fontSize: 11 }}>{v}px</span><div style={{ height: 14, width: v * 3, background: 'var(--gx-primary)', borderRadius: 2 }} /></div>)}</div>;
  if (/shadow/.test(s)) return <div className="wrap" style={{ gap: 18 }}>{['sm','md','lg','xl'].map(e => <div key={e} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}><div style={{ width: 90, height: 56, background: 'var(--gx-surface)', borderRadius: 'var(--gx-radius-md)', boxShadow: 'var(--gx-shadow-' + e + ')' }} /><span className="mono muted" style={{ fontSize: 10 }}>{e}</span></div>)}</div>;
  if (/typography/.test(s)) return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[['Display',30,'var(--gx-font-display)',600],['Heading',20,'var(--gx-font-sans)',600],['Body',14,'var(--gx-font-sans)',400],['Mono',13,'var(--gx-font-mono)',400]].map(t => <div key={t[0]} style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}><span className="mono muted" style={{ width: 70, fontSize: 11 }}>{t[0]}</span><span style={{ fontFamily: t[2], fontSize: t[1], fontWeight: t[3] }}>The quick brown fox</span></div>)}</div>;
  // colors/icons/logos/animations → swatches
  return <div className="wrap">{['var(--cobalt-700)','var(--azure-500)','var(--gx-gold)','var(--gx-success)','var(--gx-warning)','var(--gx-danger)','var(--violet-500)','#2A9DB5'].map((c, i) => <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ width: 70, height: 50, background: c, borderRadius: 'var(--gx-radius-md)', border: '1px solid var(--gx-border)' }} /></div>)}</div>;
}

function ArchMonitor({ leaf }) {
  const stat = [['Status','Healthy','var(--gx-success)'],['Throughput','1,284/min','var(--gx-text-1)'],['Errors (24h)','3','var(--gx-warning)'],['p95 latency','142ms','var(--gx-text-1)']];
  const logs = ['ok   event.processed id=evt_9241','ok   job.completed queue=default 38ms','warn retry attempt=2 svc=billing-adapter','ok   health.check all green','err  timeout upstream=olt-yvn-12 (recovered)','ok   trace span=4821 closed'];
  const tone = (l) => l.startsWith('err') ? 'var(--gx-danger-fg)' : l.startsWith('warn') ? 'var(--gx-warning-fg)' : 'var(--gx-success-fg)';
  return (
    <div>
      <div className="kpi-strip" style={{ marginBottom: 14 }}>
        {stat.map((s, i) => <div className="kpi" key={i}><span className="klbl">{s[0]}</span><div className="kval" style={{ fontSize: 22, color: s[2], margin: '6px 0 0' }}>{s[1]}</div></div>)}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head" style={{ padding: '10px 14px' }}><Icon name="terminal" size={15} style={{ color: 'var(--gx-text-3)' }} /><h3 style={{ fontSize: 13 }}>Live stream</h3><span className="spacer" /><span className="pill pill-success"><span className="d" style={{ background: 'var(--gx-online)' }} />live</span></div>
        <div style={{ padding: 12, fontFamily: 'var(--gx-font-mono)', fontSize: 12, lineHeight: 1.9, background: 'var(--gx-code-bg)' }}>
          {logs.map((l, i) => <div key={i} style={{ color: tone(l) }}><span style={{ color: 'var(--gx-text-3)' }}>{String(10 + i).padStart(2, '0')}:4{i} </span>{l}</div>)}
        </div>
      </div>
    </div>
  );
}

function ArchCanvas({ leaf }) {
  const PALETTE = [['Trigger','var(--gx-success)'],['Condition','var(--gx-gold)'],['Action','var(--violet-400)'],['Branch','var(--azure-400)'],['Delay','var(--gx-text-2)']];
  const [nodes, setNodes] = React.useState([['Start','var(--gx-success)'],['Validate','var(--azure-400)'],['Decision','var(--gx-gold)'],['Action','var(--violet-400)'],['End','var(--gx-text-3)']]);
  React.useEffect(() => { setNodes([['Start','var(--gx-success)'],['Validate','var(--azure-400)'],['Decision','var(--gx-gold)'],['Action','var(--violet-400)'],['End','var(--gx-text-3)']]); }, [leaf.id]);
  const add = (n) => { setNodes(ns => { const copy = [...ns]; copy.splice(Math.max(1, copy.length - 1), 0, [n[0], n[1]]); return copy; }); gxToast(n[0] + ' node added'); };
  const rm = (i) => setNodes(ns => ns.filter((_, j) => j !== i));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 16 }}>
      <div>
        <div className="lbl" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', marginBottom: 8 }}>Nodes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PALETTE.map(n => <button key={n[0]} className="palette-block" style={{ flexDirection: 'row', justifyContent: 'flex-start', gap: 8, padding: '9px 11px' }} onClick={() => add(n)}><span style={{ width: 8, height: 8, borderRadius: '50%', background: n[1] }} />{n[0]}</button>)}
        </div>
      </div>
      <div className="card" style={{ background: 'var(--gx-bg-subtle)', padding: 20, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', justifyContent: 'center' }}>
          {nodes.map((n, i) => (
            <React.Fragment key={i}>
              <div className="flow-node" style={{ borderColor: n[1] }} onClick={() => rm(i)} title="Click to remove">{n[0]}<Icon name="x" size={11} className="flow-x" /></div>
              {i < nodes.length - 1 && <div style={{ width: 24, height: 2, background: 'var(--gx-border-strong)' }} />}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArchForm({ leaf }) {
  const danger = /danger|emergency|disaster|maintenance/.test(leaf.leaf.toLowerCase());
  return (
    <div style={{ maxWidth: 620 }}>
      {danger && <div className="banner" style={{ marginBottom: 16, borderLeftColor: 'var(--gx-danger)', background: 'var(--gx-danger-soft)' }}><Icon name="triangle-alert" size={16} style={{ color: 'var(--gx-danger)', flexShrink: 0, marginTop: 1 }} /><div><div className="bt">Sensitive controls</div><div className="bm">Actions here affect the whole platform. Changes are audited and may require a second approver.</div></div></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <label className="field"><span>Enabled</span><div className="seg" style={{ width: '100%' }}><button className="on" style={{ flex: 1 }}>On</button><button style={{ flex: 1 }}>Off</button></div></label>
        <label className="field"><span>Scope</span><select className="inp inp-sm"><option>This environment</option><option>All environments</option></select></label>
        <label className="field"><span>Mode</span><select className="inp inp-sm"><option>Standard</option><option>Strict</option><option>Permissive</option></select></label>
        <label className="field"><span>Owner</span><input className="inp inp-sm" defaultValue="Platform Team" /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Notes</span><textarea className="inp" rows={3} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} placeholder={'Configuration notes for ' + leaf.leaf} /></label>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className={'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-primary')} onClick={() => gxToast(leaf.leaf + ' saved')}><Icon name="check" size={13} />Save changes</button>
        <button className="btn btn-ghost btn-sm" onClick={() => gxToast('Reset')}>Reset</button>
      </div>
    </div>
  );
}

/* ── relational overview (the 9-layer architecture) ── */
const STUDIO_LAYERS = [
  ['Experience', 'monitor', 'What users see', 'uses', 'var(--azure-400)'],
  ['Data', 'database', 'What users store', 'controlled by', 'var(--gx-success)'],
  ['Logic', 'zap', 'What the system does', 'protected by', 'var(--gx-gold)'],
  ['Security', 'shield', 'Who can do it', 'enhanced by', 'var(--gx-danger)'],
  ['Intelligence', 'sparkles', 'How the system thinks', 'verified by', 'var(--violet-400)'],
  ['Quality', 'check-check', 'How changes are tested', 'published by', '#2A9DB5'],
  ['Release', 'rocket', 'How changes go live', 'tracked by', 'var(--gx-warning)'],
  ['Governance', 'gavel', 'How changes are tracked', 'managed by', 'var(--cobalt-400)'],
  ['System Control', 'settings', 'How the platform runs', null, 'var(--gx-text-2)'],
];
function firstLeafOf(group) { const l = STUDIO_LEAVES.find(x => x.group === group); return l ? l.id : null; }
function groupCount(group) { return STUDIO_LEAVES.filter(x => x.group === group).length; }

const SUPPORT_GROUPS = [
  ['Marketplace', 'store', 'Plugins, extensions & connectors'],
  ['Developer', 'code', 'Code, SDK, CLI & API'],
  ['Notifications', 'bell', 'Email, SMS, push & rules'],
  ['Search', 'search', 'Indexes, ranking & access'],
  ['Import / Export', 'arrow-left-right', 'Data & migration tools'],
  ['Documentation', 'book-open', 'Docs, guides & changelog'],
];

function StudioOverview({ onPick }) {
  return (
    <div>
      <div className="section-head" style={{ marginTop: 0 }}><Icon name="layers" size={16} className="section-icon" />Platform architecture<span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>· nine layers, one connected system</span></div>
      <p className="hint" style={{ marginTop: -4, marginBottom: 18, maxWidth: 620 }}>Studio is not a collection of settings pages. Each layer is a visual management system that feeds the next — build the experience, store the data, drive the logic, protect it, make it intelligent, verify, ship, govern, and run.</p>
      <div className="layer-stack">
        {STUDIO_LAYERS.map((L, i) => (
          <React.Fragment key={L[0]}>
            <button className="layer-card" onClick={() => onPick(firstLeafOf(L[0]))} style={{ '--lt': L[4] }}>
              <span className="layer-ic" style={{ background: L[4] }}><Icon name={L[1]} size={20} /></span>
              <span className="layer-meta">
                <span className="layer-name">{L[0]}</span>
                <span className="layer-what">{L[2]}</span>
              </span>
              <span className="layer-count">{groupCount(L[0])} modules</span>
              <Icon name="arrow-right" size={16} className="layer-go" />
            </button>
            {L[3] && <span className="layer-rel"><span className="layer-rel-line" /><span className="layer-rel-verb">{L[3]}</span><Icon name="chevron-down" size={13} /></span>}
          </React.Fragment>
        ))}
      </div>
      <div className="section-head"><Icon name="puzzle" size={16} className="section-icon" />Platform capabilities<span className="hint" style={{ fontWeight: 400, marginLeft: 6 }}>· extend &amp; operate</span></div>
      <div className="support-grid">
        {SUPPORT_GROUPS.map(s => (
          <button key={s[0]} className="support-card" onClick={() => onPick(firstLeafOf(s[0]))}>
            <span className="support-ic"><Icon name={s[1]} size={18} /></span>
            <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s[0]}</span>
              <span className="hint" style={{ fontSize: 11.5 }}>{s[2]}</span>
            </span>
            <Icon name="arrow-right" size={14} style={{ color: 'var(--gx-text-3)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── tree nav + shell ── */
function StudioTree({ activeId, onPick }) {
  const [openG, setOpenG] = React.useState({ Experience: true });
  const [openM, setOpenM] = React.useState({ 'Experience.Pages': true });
  const [q, setQ] = React.useState('');
  const tgG = (k) => setOpenG(o => ({ ...o, [k]: !o[k] }));
  const tgM = (k) => setOpenM(o => ({ ...o, [k]: !o[k] }));

  if (q) {
    const hits = STUDIO_LEAVES.filter(l => (l.leaf + ' ' + l.group + ' ' + (l.module || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 40);
    return (
      <aside className="studio-nav tree">
        <div className="tree-search"><Icon name="search" size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search Studio" autoFocus /><button onClick={() => setQ('')}><Icon name="x" size={12} /></button></div>
        {hits.map(l => (
          <button key={l.id} className={'tree-leaf' + (activeId === l.id ? ' on' : '')} style={{ paddingLeft: 12 }} onClick={() => onPick(l.id)}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.leaf}</span>
            <span className="tree-leaf-ctx">{l.module || l.group}</span>
          </button>
        ))}
        {hits.length === 0 && <div className="hint" style={{ padding: '20px 12px', textAlign: 'center' }}>No matches.</div>}
      </aside>
    );
  }
  return (
    <aside className="studio-nav tree">
      <div className="tree-search"><Icon name="search" size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search Studio" /></div>
      <button className={'tree-leaf' + (activeId === 'overview' ? ' on' : '')} style={{ paddingLeft: 12, height: 32, fontWeight: 600, color: activeId === 'overview' ? undefined : 'var(--gx-text-1)' }} onClick={() => onPick('overview')}><Icon name="layout-grid" size={14} style={{ marginRight: 2 }} />Overview</button>
      {STUDIO_TREE.map(g => {
        const flat = Array.isArray(g.body) && typeof g.body[0] === 'string';
        const gOpen = openG[g.label];
        return (
          <div key={g.label} className="tree-group">
            <button className={'tree-g' + (gOpen ? ' open' : '')} onClick={() => tgG(g.label)}>
              <Icon name={g.icon} size={15} /><span>{g.label}</span><Icon name="chevron-right" size={13} className="chev" />
            </button>
            {gOpen && (flat
              ? g.body.map(leaf => { const id = slug(g.label) + '.' + slug(leaf); return (
                  <button key={id} className={'tree-leaf' + (activeId === id ? ' on' : '')} style={{ paddingLeft: 30 }} onClick={() => onPick(id)}>{leaf}</button>
                ); })
              : g.body.map(m => { const mk = g.label + '.' + m.label; const mOpen = openM[mk]; return (
                  <div key={mk}>
                    <button className={'tree-m' + (mOpen ? ' open' : '')} onClick={() => tgM(mk)}><Icon name={m.icon} size={13} /><span>{m.label}</span><Icon name="chevron-right" size={12} className="chev" /></button>
                    {mOpen && m.items.map(leaf => { const id = slug(g.label) + '.' + slug(m.label) + '.' + slug(leaf); return (
                      <button key={id} className={'tree-leaf' + (activeId === id ? ' on' : '')} style={{ paddingLeft: 42 }} onClick={() => onPick(id)}>{leaf}</button>
                    ); })}
                  </div>
                ); }))}
          </div>
        );
      })}
    </aside>
  );
}

function StudioV2() {
  const [activeId, setActiveId] = React.useState('overview');
  const leaf = LEAF_BY_ID[activeId];
  const Rich = leaf ? richPaneFor(leaf.leaf) : null;
  return (
    <div className="view-inner fade" style={{ maxWidth: 1320 }}>
      <ViewHead icon="wand-2" title="Studio" sub="Visual builder · configuration center · publishing control"
        actions={<>
          <span className="pill pill-gold" style={{ marginRight: 2 }}><Icon name="shield" size={12} />SuperAdmin</span>
          <span className="pill pill-warning"><span className="d" style={{ background: 'var(--gx-warning)' }} />Draft</span>
          <button className="btn btn-secondary btn-sm" onClick={() => gxToast('Preview opened')}><Icon name="eye" size={14} />Preview</button>
          <button className="btn btn-primary btn-sm" onClick={() => gxToast('Published to production')}><Icon name="rocket" size={14} />Publish</button>
        </>} />
      <div className="studio tree-studio">
        <StudioTree activeId={activeId} onPick={setActiveId} />
        <section className="studio-pane">
          {activeId === 'overview' ? <StudioOverview onPick={setActiveId} />
            : Rich ? <Rich /> : leaf ? <StudioGenericPane leaf={leaf} /> : null}
        </section>
      </div>
    </div>
  );
}

window.StudioTreeData = { STUDIO_TREE, STUDIO_LEAVES };
window.Studio = StudioV2;
