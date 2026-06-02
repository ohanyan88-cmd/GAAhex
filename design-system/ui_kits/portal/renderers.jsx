/* GAAhex Portal — generic renderers that turn a page config into a real screen.
   EntityPage · KanbanGeneric · ModuleDashboard · MapView · CalendarView · SettingsPage */

const STATUS_CLASS = (...a) => window.GXPages.STATUS_CLASS(...a);
const PRIO_CLASS = (...a) => window.GXPages.PRIO_CLASS(...a);
const entityConfig = (...a) => window.GXPages.entityConfig(...a);
const R = (...a) => window.GXPages.R(...a);
const money = (...a) => window.GXPages.money(...a);
const gen = (...a) => window.GXPages.gen(...a);

// ── KPI strip (compact) ───────────────────────────────────────────────
function KpiStrip({ kpis }) {
  if (!kpis) return null;
  return (
    <div className="kpi-strip">
      {kpis.map((k, i) => (
        <div className="kpi" key={i}>
          <span className="klbl">{k[0]}</span>
          <div className="kval tnum" style={{ fontSize: 24, color: k[4] ? 'var(--gx-gold)' : 'var(--gx-text-1)' }}>{k[1]}</div>
          {k[2] ? <span className={'pill ' + (k[3] ? 'pill-success' : 'pill-danger')}><Icon name={k[3] ? 'trending-up' : 'trending-down'} size={12} />{k[2]}</span> : <span className="hint" style={{ fontSize: 11 }}>—</span>}
        </div>
      ))}
    </div>
  );
}

// ── cell renderer ─────────────────────────────────────────────────────
function Cell({ col, val }) {
  switch (col.t) {
    case 'id': return <span className="mono" style={{ color: 'var(--gx-link)' }}>{val}</span>;
    case 'mono': return <span className="mono">{val}</span>;
    case 'sub': return <span style={{ color: 'var(--gx-text-2)' }}>{val}</span>;
    case 'strong': return <span style={{ fontWeight: 600 }}>{val}</span>;
    case 'money': return <span className="mono tnum">{val}</span>;
    case 'num': return <span className="tnum">{Number(val).toLocaleString('en-US')}</span>;
    case 'date': return <span className="mono" style={{ color: 'var(--gx-text-3)', fontSize: 11.5 }}>{val}</span>;
    case 'status': return <span className={'pill ' + STATUS_CLASS(val)}>{val}</span>;
    case 'prio': return <span className={'pill ' + PRIO_CLASS(val)}>{val}</span>;
    case 'avatar': return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{initials(val)}</span>{val}</span>;
    case 'progress': return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
        <span style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--gx-bg-subtle)', overflow: 'hidden', display: 'inline-block' }}>
          <span style={{ display: 'block', height: '100%', width: val + '%', background: val > 85 ? 'var(--gx-danger)' : val > 65 ? 'var(--gx-warning)' : 'var(--gx-success)' }} />
        </span>
        <span className="mono tnum" style={{ fontSize: 11 }}>{val}%</span>
      </span>
    );
    default: return <span>{val}</span>;
  }
}

// ── generic kanban (for kind='board') ─────────────────────────────────
function KanbanGeneric({ cfg, onOpen }) {
  const board = cfg.board || { statusKey: 'status', cols: [...new Set(cfg.rows.map(r => r.status))] };
  const tone = { 'Open':'var(--gx-neutral)','New':'var(--gx-info)','In progress':'var(--gx-warning)','Blocked':'var(--gx-danger)','Resolved':'var(--gx-success)','Qualified':'var(--gx-info)','Won':'var(--gx-success)' };
  const titleKey = cfg.columns.find(c => c.t === 'strong' || c.t === 'id')?.k || cfg.columns[0].k;
  return (
    <div className="board-grid">
      {board.cols.map(col => {
        const items = cfg.rows.filter(r => r[board.statusKey] === col);
        return (
          <div key={col} className="board-col">
            <div className="board-col-head"><span style={{ width: 8, height: 8, borderRadius: '50%', background: tone[col] || 'var(--gx-neutral)' }} /><span style={{ fontSize: 12, fontWeight: 600 }}>{col}</span><span className="badge" style={{ background: 'var(--gx-surface-2)', color: 'var(--gx-text-3)', marginLeft: 'auto' }}>{items.length}</span><button className="btn btn-ghost btn-sm btn-icon" style={{ width: 22, height: 22 }} onClick={() => window.gxToast && gxToast('Add to ' + col)}><Icon name="plus" size={13} /></button></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((r, i) => (
                <div key={i} className="board-card" onClick={() => onOpen && onOpen(r)}>
                  {r.id && <div className="mono" style={{ fontSize: 11, color: 'var(--gx-link)', marginBottom: 6 }}>{r.id}</div>}
                  <div style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 10 }}>{r[titleKey]}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.owner && <span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{initials(r.owner)}</span>}
                    {r.prio && <span className={'pill ' + PRIO_CLASS(r.prio)} style={{ marginLeft: 'auto', height: 18 }}>{r.prio}</span>}
                    {r.mrr && <span className="mono tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gx-text-2)' }}>{r.mrr}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── EntityPage (list / board) — fully interactive ─────────────────────
let _gxSeq = 9000;
function EntityPage({ item }) {
  const cfg = React.useMemo(() => entityConfig(item), [item.id]);
  const idKey = cfg.columns.find(c => c.t === 'id')?.k;
  const statusKey = cfg.columns.find(c => c.t === 'status')?.k;
  const [rows, setRows] = React.useState(() => cfg.rows.map((r, i) => ({ __id: 'r' + i, ...r })));
  React.useEffect(() => { setRows(cfg.rows.map((r, i) => ({ __id: 'r' + i, ...r }))); setPage(1); setSel({}); }, [item.id]);
  const [mode, setMode] = React.useState(item.kind === 'board' ? 'board' : 'table');
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState({ k: null, dir: 1 });
  const [sel, setSel] = React.useState({});
  const [page, setPage] = React.useState(1);
  const [drawer, setDrawer] = React.useState(null);
  const [modal, setModal] = React.useState(null); // {mode:'new'|'edit', row}
  const [confirm, setConfirm] = React.useState(null);
  const mod = ITEM_MODULE[item.id];
  const per = 8;

  let view = rows.filter(r => !q || Object.values(r).some(v => String(v).toLowerCase().includes(q.toLowerCase())));
  if (sort.k) view = [...view].sort((a, b) => { const x = a[sort.k], y = b[sort.k]; const nx = parseFloat(String(x).replace(/[^0-9.-]/g, '')), ny = parseFloat(String(y).replace(/[^0-9.-]/g, '')); const cmp = (!isNaN(nx) && !isNaN(ny)) ? nx - ny : String(x).localeCompare(String(y)); return cmp * sort.dir; });
  const pages = Math.max(1, Math.ceil(view.length / per));
  const pageRows = view.slice((page - 1) * per, page * per);
  const selIds = Object.keys(sel).filter(k => sel[k]);
  const allOnPage = pageRows.length > 0 && pageRows.every(r => sel[r.__id]);
  const canBoard = !!cfg.board || item.kind === 'board';

  const toggleSort = (k) => setSort(s => s.k === k ? { k, dir: -s.dir } : { k, dir: 1 });
  const toggleAll = () => { const n = { ...sel }; pageRows.forEach(r => n[r.__id] = !allOnPage); setSel(n); };
  const create = (data) => { setRows(rs => [{ __id: 'n' + (_gxSeq++), [idKey || '']: idKey ? (item.label.slice(0, 2).toUpperCase() + '-' + (_gxSeq)) : undefined, ...data }, ...rs]); gxToast('Created in ' + item.label); };
  const update = (row, data) => { setRows(rs => rs.map(r => r.__id === row.__id ? { ...r, ...data } : r)); gxToast('Saved changes'); };
  const dup = (row) => { setRows(rs => [{ ...row, __id: 'n' + (_gxSeq++) }, ...rs]); gxToast('Duplicated'); };
  const del = (ids) => { setRows(rs => rs.filter(r => !ids.includes(r.__id))); setSel({}); gxToast(ids.length + ' deleted', 'danger'); };
  const setStatus = (row, val) => { setRows(rs => rs.map(r => r.__id === row.__id ? { ...r, [statusKey]: val } : r)); if (drawer) setDrawer(d => ({ ...d, [statusKey]: val })); gxToast('Status → ' + val); };

  return (
    <div className="view-inner fade">
      <div className="crumbs"><span>{mod?.secLabel}</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{item.label}</span></div>
      <ViewHead icon={item.icon} title={item.label} sub={`Configuration-driven ${item.label.toLowerCase()} · Yerevan Net`}
        actions={<>
          <button className="btn btn-ghost btn-sm hide-sm" onClick={() => window.gxGoStudio && window.gxGoStudio()} title="Every screen is config — edit this one in Studio"><Icon name="wand-2" size={14} style={{ color: 'var(--gx-gold)' }} />Configure page</button>
          <button className="btn btn-secondary btn-sm hide-sm" onClick={() => gxToast('Exported ' + view.length + ' rows to CSV')}><Icon name="download" size={14} />Export</button>
          <button className="btn btn-primary btn-sm" onClick={() => setModal({ mode: 'new' })}><Icon name="plus" size={14} />New</button>
        </>} />
      <KpiStrip kpis={cfg.kpis} />
      <div className="toolbar">
        <div className="tb-search" style={{ width: 280 }}><Icon name="search" size={15} /><input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder={'Search ' + item.label.toLowerCase()} style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13, fontFamily: 'var(--gx-font-sans)' }} /></div>
        <button className="btn btn-secondary btn-sm" onClick={() => gxToast('Filter builder — configure in Studio', 'info')}><Icon name="filter" size={14} />Filter</button>
        <span className="spacer" />
        {canBoard && <div className="seg"><button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}><Icon name="rows-3" size={13} />Table</button><button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}><Icon name="columns-3" size={13} />Board</button></div>}
      </div>

      {mode === 'board'
        ? <KanbanGeneric cfg={{ ...cfg, rows }} onOpen={(r) => setDrawer(r)} />
        : (<div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {selIds.length > 0 && (
              <div className="bulkbar fade-fast">
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{selIds.length} selected</span>
                <span className="spacer" />
                <button className="btn btn-ghost btn-sm" onClick={() => gxToast('Exported ' + selIds.length + ' rows')}><Icon name="download" size={14} />Export</button>
                {statusKey && <button className="btn btn-ghost btn-sm" onClick={() => { setRows(rs => rs.map(r => sel[r.__id] ? { ...r, [statusKey]: 'Resolved' } : r)); setSel({}); gxToast('Marked resolved'); }}><Icon name="check" size={14} />Resolve</button>}
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--gx-danger-fg)' }} onClick={() => setConfirm({ ids: selIds })}><Icon name="trash-2" size={14} />Delete</button>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSel({})}><Icon name="x" size={15} /></button>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead><tr>
                  <th style={{ width: 32 }}><input type="checkbox" checked={allOnPage} onChange={toggleAll} /></th>
                  {cfg.columns.map(c => (
                    <th key={c.k} onClick={() => toggleSort(c.k)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{c.l}{sort.k === c.k ? <Icon name={sort.dir > 0 ? 'arrow-up' : 'arrow-down'} size={12} style={{ color: 'var(--gx-primary)' }} /> : <Icon name="chevrons-up-down" size={12} style={{ opacity: .35 }} />}</span>
                    </th>
                  ))}
                  <th style={{ width: 40 }}></th>
                </tr></thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.__id} className={sel[r.__id] ? 'sel' : ''} onClick={() => setDrawer(r)} style={{ cursor: 'pointer' }}>
                      <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={!!sel[r.__id]} onChange={() => setSel(s => ({ ...s, [r.__id]: !s[r.__id] }))} /></td>
                      {cfg.columns.map(c => <td key={c.k}>{c.k === statusKey ? <span onClick={e => e.stopPropagation()}><InlineStatus value={r[c.k]} onChange={v => setStatus(r, v)} /></span> : <Cell col={c} val={r[c.k]} />}</td>)}
                      <td onClick={e => e.stopPropagation()}><RowMenu onView={() => setDrawer(r)} onEdit={() => setModal({ mode: 'edit', row: r })} onDup={() => dup(r)} onDelete={() => setConfirm({ ids: [r.__id] })} /></td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && <tr><td colSpan={cfg.columns.length + 2} style={{ textAlign: 'center', padding: '40px', color: 'var(--gx-text-3)' }}>No matching records.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span className="hint">Showing {view.length ? (page - 1) * per + 1 : 0}–{Math.min(page * per, view.length)} of {view.length}</span>
              <span className="spacer" />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><Icon name="chevron-left" size={15} /></button>
                {gen(pages, i => i + 1).slice(0, 5).map(p => <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>)}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><Icon name="chevron-right" size={15} /></button>
              </div>
            </div>
          </div>)}

      {drawer && <RecordDrawer item={item} cfg={cfg} row={rows.find(r => r.__id === drawer.__id) || drawer} onClose={() => setDrawer(null)} onEdit={() => { setModal({ mode: 'edit', row: drawer }); }} onDelete={() => { setConfirm({ ids: [drawer.__id] }); }} onStatus={v => setStatus(drawer, v)} />}
      {modal && <RecordModal cfg={cfg} title={modal.mode === 'new' ? ('New ' + item.label.replace(/s$/, '')) : ('Edit ' + item.label.replace(/s$/, ''))} initial={modal.row} onSave={data => modal.mode === 'new' ? create(data) : update(modal.row, data)} onClose={() => setModal(null)} />}
      {confirm && <ConfirmDialog danger title="Delete records?" body={`This will permanently remove ${confirm.ids.length} record(s). In production, deletes are soft and audited.`} confirmLabel="Delete" onConfirm={() => { del(confirm.ids); if (drawer && confirm.ids.includes(drawer.__id)) setDrawer(null); }} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function InlineStatus({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => { if (!open) return; const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const opts = ['Open', 'In progress', 'Blocked', 'Resolved', 'Active', 'Pending', 'Overdue', 'Paid'];
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className={'pill ' + STATUS_CLASS(value)} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>{value}<Icon name="chevron-down" size={11} /></button>
      {open && <div className="menu fade-fast" style={{ position: 'absolute', left: 0, top: '100%', marginTop: 4 }}>{opts.map(o => <button key={o} className="menu-item" onClick={() => { onChange(o); setOpen(false); }}><span className={'pill ' + STATUS_CLASS(o)} style={{ height: 18 }}>{o}</span></button>)}</div>}
    </span>
  );
}

// ── ModuleDashboard ───────────────────────────────────────────────────
const MOD_DASH = {
  crm:   { k:[['Pipeline value','$4.2M','+12%',true,true],['Win rate','31%','+3pt',true],['New leads','1,284','+8%',true],['Churn risk','142','-5%',true]], chart:'New vs. won deals' },
  support:{ k:[['Open tickets','347','-8%',false],['Avg handle','14m','-2m',true],['CSAT','94%','+1pt',true,true],['SLA met','98.2%','',true]], chart:'Tickets by day' },
  billing:{ k:[['MRR','$1.84M','+5.1%',true,true],['Collected','$1.71M','',true],['Overdue','$184K','-4%',true],['ARPU','$28.40','+1.2%',true]], chart:'Revenue vs. churn' },
  network:{ k:[['Uptime','99.98%','30d',true,true],['Devices online','99.2%','',true],['Active alarms','21','+4',false],['Capacity','78%','+2%',true]], chart:'Bandwidth utilization' },
  finance:{ k:[['Revenue','$2.41M','+6%',true,true],['Expenses','$1.38M','+2%',false],['Net margin','42.7%','+1.4pt',true],['Cash','$3.9M','',true]], chart:'Revenue vs. expenses' },
  field:  { k:[['Installs today','64','+8',true],['Techs active','38','',true,true],['On-time','92%','+3pt',true],['Open WOs','118','-6',true]], chart:'Installs completed' },
  inventory:{ k:[['SKUs','1,942','',true],['Stock value','$1.2M','+3%',true,true],['Low stock','34','+6',false],['Turns','5.2x','',true]], chart:'Stock movements' },
  hr:     { k:[['Headcount','1,284','+12',true,true],['Attrition','4.1%','-0.3pt',true],['Open roles','28','',true],['Avg tenure','3.4y','',true]], chart:'Headcount trend' },
  orders: { k:[['In queue','412','+6%',false],['Activated 30d','3,108','+9%',true,true],['Failed','42','-5',true],['Avg cycle','2.1d','-0.3d',true]], chart:'Orders by stage' },
};
function ModuleDashboard({ item }) {
  const mod = ITEM_MODULE[item.id];
  const conf = MOD_DASH[mod?.sec] || { k:[['Total records','12,402','+3%',true,true],['Active','98%','',true],['This month','1,204','+9%',true],['Issues','12','-4',true]], chart:item.label };
  const [range, setRange] = React.useState('30d');
  const dist = [['Active', 62, 'var(--gx-success)'], ['Pending', 21, 'var(--gx-warning)'], ['At-risk', 11, 'var(--azure-400)'], ['Closed', 6, 'var(--gx-neutral)']];
  const baseA = [62,70,58,80,74,90,84,96,88,104,98,118];
  const baseB = [40,46,42,52,49,58,55,63,60,69,66,78];
  const mul = range === '30d' ? 1 : range === 'QTD' ? 1.18 : 1.4;
  return (
    <div className="view-inner fade">
      <div className="crumbs"><span>{mod?.secLabel}</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{item.label}</span></div>
      <ViewHead icon={item.icon} title={`${mod?.secLabel} · ${item.label}`} sub="Live across the module · Yerevan Net"
        actions={<><div className="seg">{['30d', 'QTD', 'YTD'].map(r => <button key={r} className={(range === r ? 'on' : '') + (r !== '30d' ? ' hide-sm' : '')} onClick={() => setRange(r)}>{r}</button>)}</div><button className="btn btn-ghost btn-sm hide-sm" onClick={() => window.gxGoStudio && window.gxGoStudio()}><Icon name="wand-2" size={14} style={{ color: 'var(--gx-gold)' }} />Configure page</button></>} />
      <div className="kpis">
        {conf.k.map((k, i) => (
          <div className="kpi" key={i}>
            <div style={{ display: 'flex', alignItems: 'center' }}><span className="klbl">{k[0]}</span><span className="spacer" /><span style={{ color: k[4] ? 'var(--gx-gold)' : 'var(--gx-text-3)' }}><Icon name={item.icon} size={16} /></span></div>
            <div className="kval tnum">{k[1]}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{k[2] ? <span className={'pill ' + (k[3] ? 'pill-success' : 'pill-danger')}><Icon name={k[3] ? 'trending-up' : 'trending-down'} size={12} />{k[2]}</span> : <span className="hint" style={{ fontSize: 11 }}>—</span>}<Spark color={k[4] ? 'var(--gx-gold)' : (k[3] ? 'var(--gx-success)' : 'var(--gx-danger)')} /></div>
          </div>
        ))}
      </div>
      <div className="cols">
        <div className="card"><div className="card-head"><Icon name="trending-up" size={16} style={{ color: 'var(--gx-text-3)' }} /><h3>{conf.chart}</h3><span className="spacer" /><div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--gx-text-3)' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--azure-500)' }} />Current</span><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gx-gold)' }} />Prior</span></div></div><div className="card-pad"><LineChart series={[{ pts: baseA.map(v => v * mul), color: 'var(--azure-500)', fill: true }, { pts: baseB.map(v => v * mul), color: 'var(--gx-gold)' }]} /></div></div>
        <div className="card"><div className="card-head"><Icon name="chart-pie" size={16} style={{ color: 'var(--gx-text-3)' }} /><h3>Breakdown</h3></div><div className="card-pad"><Donut data={dist} /></div></div>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head"><Icon name="activity" size={16} style={{ color: 'var(--gx-text-3)' }} /><h3>Recent activity</h3><span className="spacer" /><button className="btn btn-ghost btn-sm" onClick={() => gxToast('Opening full activity log')}>View all<Icon name="arrow-right" size={14} /></button></div>
        <div style={{ padding: '6px 0' }}>{ACTIVITY.map((a, i) => (<div key={i} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '10px 18px', borderBottom: i < ACTIVITY.length - 1 ? '1px solid var(--gx-border-subtle)' : 'none' }}><span style={{ width: 28, height: 28, borderRadius: 'var(--gx-radius-sm)', background: 'var(--gx-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: a.tone, flexShrink: 0 }}><Icon name={a.icon} size={15} /></span><div style={{ fontSize: 12.5 }}><span style={{ fontWeight: 600 }}>{a.who}</span> <span style={{ color: 'var(--gx-text-2)' }}>{a.act}</span> <span className="mono" style={{ color: 'var(--gx-link)' }}>{a.obj}</span></div><span className="hint" style={{ marginLeft: 'auto', fontSize: 11 }}>{a.t}</span></div>))}</div>
      </div>
    </div>
  );
}

// ── MapView (topology / coverage) ─────────────────────────────────────
function MapView({ item }) {
  const mod = ITEM_MODULE[item.id];
  const nodes = [[50,90,'core'],[160,50,'pop'],[160,140,'pop'],[270,30,'olt'],[270,90,'olt'],[270,150,'olt'],[270,200,'olt'],[380,60,'on'],[380,120,'on'],[380,180,'on']];
  const links = [[0,1],[0,2],[1,3],[1,4],[2,5],[2,6],[3,7],[4,8],[6,9]];
  const col = { core:'var(--gx-gold)', pop:'var(--azure-400)', olt:'var(--gx-success)', on:'var(--gx-text-3)' };
  return (
    <div className="view-inner fade">
      <div className="crumbs"><span>{mod?.secLabel}</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{item.label}</span></div>
      <ViewHead icon={item.icon} title={item.label} sub="Live topology · illustrative"
        actions={<><button className="btn btn-secondary btn-sm hide-sm"><Icon name="maximize-2" size={14} />Fullscreen</button><button className="btn btn-secondary btn-sm"><Icon name="layers" size={14} />Layers</button></>} />
      <KpiStrip kpis={[['Nodes','3,842','',true],['Online','99.2%','',true,true],['Active alarms','21','+4',false],['Coverage','86%','+2%',true]]} />
      <div className="cols">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head"><Icon name="network" size={16} style={{ color: 'var(--gx-text-3)' }} /><h3>{item.label}</h3><span className="spacer" /><span className="pill pill-success"><span className="d" style={{ background: 'var(--gx-success)' }} />live</span></div>
          <div style={{ position: 'relative', height: 320, background: 'radial-gradient(120% 120% at 30% 20%, var(--gx-surface-2), var(--gx-bg))' }}>
            <svg viewBox="0 0 440 240" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {links.map((l, i) => <line key={i} x1={nodes[l[0]][0]} y1={nodes[l[0]][1]} x2={nodes[l[1]][0]} y2={nodes[l[1]][1]} stroke="var(--gx-border-strong)" strokeWidth="1.5" />)}
              {nodes.map((n, i) => <g key={i}><circle cx={n[0]} cy={n[1]} r={n[2]==='core'?9:n[2]==='pop'?7:5} fill={col[n[2]]} /><circle cx={n[0]} cy={n[1]} r={n[2]==='core'?9:n[2]==='pop'?7:5} fill="none" stroke={col[n[2]]} strokeWidth="6" opacity="0.18" /></g>)}
            </svg>
          </div>
          <div className="card-pad" style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--gx-text-3)' }}>
            {[['Core','var(--gx-gold)'],['POP','var(--azure-400)'],['OLT','var(--gx-success)'],['ONT','var(--gx-text-3)']].map(l => <span key={l[0]} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: l[1] }} />{l[0]}</span>)}
          </div>
        </div>
        <div className="card"><div className="card-head"><Icon name="triangle-alert" size={16} style={{ color: 'var(--gx-warning)' }} /><h3>Active alarms</h3></div><div style={{ padding: '4px 0' }}>
          {gen(5, i => ({ n: R(['olt-yvn-0012','rtr-gym-04','bts-van-02','sw-yvn-19','ont-arm-77'], i), m: R(['LOS — fiber cut','High CPU 94%','Power fail','Port flapping','Signal low -31dBm'], i), s: R(['Critical','High','Critical','Normal','High'], i) })).map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: '1px solid var(--gx-border-subtle)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: a.s === 'Critical' ? 'var(--gx-danger)' : 'var(--gx-warning)' }} /><div style={{ fontSize: 12.5 }}><span className="mono" style={{ color: 'var(--gx-link)' }}>{a.n}</span><div className="hint" style={{ fontSize: 11 }}>{a.m}</div></div><span className={'pill ' + PRIO_CLASS(a.s)} style={{ marginLeft: 'auto' }}>{a.s}</span></div>
          ))}
        </div></div>
      </div>
    </div>
  );
}

// ── CalendarView (full, functional) ───────────────────────────────────
const CAL_TYPES = [
  { k:'install', l:'Installs', tone:'var(--gx-success)' },
  { k:'maint', l:'Maintenance', tone:'var(--gx-warning)' },
  { k:'dispatch', l:'Dispatch', tone:'var(--azure-400)' },
  { k:'sla', l:'SLA reviews', tone:'var(--gx-gold)' },
  { k:'outage', l:'Outages', tone:'var(--gx-danger)' },
  { k:'ops', l:'Operations', tone:'var(--violet-400)' },
];
const TONE = Object.fromEntries(CAL_TYPES.map(t => [t.k, t.tone]));
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function eventsFor(y, m) {
  // deterministic per-month event map: day(1..) -> [{l,k,time}]
  const seed = (y * 12 + m);
  const out = {};
  const add = (d, l, k, time) => { (out[d] = out[d] || []).push({ l, k, time }); };
  const titles = {
    install: ['Install · Acme Corp','Install · Metro Gov','Fiber install ×4','New site survey','Install · Sevan Resorts'],
    maint: ['Maintenance window','Firmware upgrade','Splice repair','OLT card swap'],
    dispatch: ['Dispatch ×3','Tech dispatch · Gyumri','Emergency dispatch','Route optimization'],
    sla: ['SLA review','Enterprise QBR','SLA breach review'],
    outage: ['Outage drill','Planned outage · POP-3','Storm response'],
    ops: ['Payroll run','Capacity planning','Team standup','Inventory count'],
  };
  // spread ~14 events through the month
  const days = [2,3,5,6,9,11,12,14,16,18,19,22,23,25,27,29];
  days.forEach((d, idx) => {
    const ks = Object.keys(titles);
    const k = ks[(seed + idx) % ks.length];
    const arr = titles[k];
    add(d, arr[(seed + idx) % arr.length], k, ['08:00','09:30','11:00','14:00','15:30','16:00'][(idx) % 6]);
    if (idx % 4 === 1) { const k2 = ks[(seed + idx + 2) % ks.length]; add(d, titles[k2][(idx) % titles[k2].length], k2, '13:00'); }
    if (idx % 5 === 2) { const k3 = ks[(seed + idx + 4) % ks.length]; add(d, titles[k3][(idx + 1) % titles[k3].length], k3, '17:00'); }
  });
  return out;
}
function MiniCal({ y, m, today, sel, onPick }) {
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  return (
    <div className="minical">
      <div className="minical-grid">
        {['M','T','W','T','F','S','S'].map((d, i) => <span key={i} className="minical-h">{d}</span>)}
        {gen(42, i => { const day = i - first + 1; const inM = day >= 1 && day <= dim; const isToday = inM && day === today.d && m === today.m && y === today.y;
          return <button key={i} className={'minical-d' + (isToday ? ' today' : '') + (sel === day && inM ? ' sel' : '')} style={{ visibility: inM ? 'visible' : 'hidden' }} onClick={() => onPick(day)}>{inM ? day : ''}</button>; })}
      </div>
    </div>
  );
}
function CalendarView({ item }) {
  const mod = ITEM_MODULE[item.id];
  const today = { y: 2026, m: 4, d: 29 };
  const [y, setY] = React.useState(today.y);
  const [m, setM] = React.useState(today.m);
  const [sel, setSel] = React.useState(today.d);
  const [on, setOn] = React.useState(Object.fromEntries(CAL_TYPES.map(t => [t.k, true])));
  const ev = React.useMemo(() => eventsFor(y, m), [y, m]);
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const prevDim = new Date(y, m, 0).getDate();
  const go = (d) => { let nm = m + d, ny = y; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } setM(nm); setY(ny); };
  const toToday = () => { setY(today.y); setM(today.m); setSel(today.d); };
  const visible = (list) => (list || []).filter(e => on[e.k]);
  const upcoming = Object.entries(ev).filter(([d]) => +d >= (m === today.m && y === today.y ? today.d : 1)).flatMap(([d, l]) => visible(l).map(e => ({ ...e, d: +d }))).slice(0, 6);
  return (
    <div className="comms-shell fade">
      <div className="comms-head">
        <div className="vh-ic"><Icon name="calendar" size={20} /></div>
        <div><h1 style={{ fontFamily:'var(--gx-font-display)', fontSize:21, fontWeight:600, margin:0, letterSpacing:'-.02em' }}>{item.label}</h1><div className="sub" style={{ color:'var(--gx-text-3)', fontSize:12.5 }}>{MONTHS[m]} {y} · Yerevan Net</div></div>
        <span className="spacer" />
        <div className="cal-nav"><button className="tb-icon" onClick={() => go(-1)}><Icon name="chevron-left" size={18} /></button><button className="btn btn-secondary btn-sm" onClick={toToday}>Today</button><button className="tb-icon" onClick={() => go(1)}><Icon name="chevron-right" size={18} /></button></div>
        <div className="seg hide-sm"><button className="on">Month</button><button>Week</button><button>Day</button></div>
        <button className="btn btn-primary btn-sm"><Icon name="plus" size={14} />New event</button>
      </div>
      <div className="cal-layout">
        <aside className="cal-rail hide-sm">
          <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}><span style={{ fontWeight:600, fontSize:13 }}>{MONTHS[m]} {y}</span><span className="spacer" /><button className="tb-icon" style={{ width:26, height:26 }} onClick={() => go(-1)}><Icon name="chevron-left" size={15} /></button><button className="tb-icon" style={{ width:26, height:26 }} onClick={() => go(1)}><Icon name="chevron-right" size={15} /></button></div>
          <MiniCal y={y} m={m} today={today} sel={sel} onPick={setSel} />
          <div className="lbl" style={{ fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)', margin:'18px 0 8px' }}>Calendars</div>
          {CAL_TYPES.map(t => (
            <label key={t.k} className="cal-cal" onClick={() => setOn(o => ({ ...o, [t.k]: !o[t.k] }))}>
              <span className="cal-check" style={{ background: on[t.k] ? t.tone : 'transparent', borderColor: t.tone }}>{on[t.k] && <Icon name="check" size={11} style={{ color:'#0A1120' }} />}</span>
              <span style={{ fontSize:12.5, color: on[t.k] ? 'var(--gx-text-1)' : 'var(--gx-text-3)' }}>{t.l}</span>
            </label>
          ))}
          <div className="lbl" style={{ fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)', margin:'18px 0 8px' }}>Upcoming</div>
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {upcoming.map((e, i) => (
              <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:TONE[e.k], marginTop:5, flexShrink:0 }} />
                <div style={{ fontSize:12 }}><div style={{ fontWeight:500 }}>{e.l}</div><div className="hint" style={{ fontSize:11 }}>{MONTHS[m].slice(0,3)} {e.d} · {e.time}</div></div>
              </div>
            ))}
          </div>
        </aside>
        <div className="card" style={{ overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <div className="cal-grid full">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="cal-h">{d}</div>)}
            {gen(42, i => {
              const day = i - first + 1; const inM = day >= 1 && day <= dim;
              const shown = inM ? day : day < 1 ? prevDim + day : day - dim;
              const isToday = inM && day === today.d && m === today.m && y === today.y;
              const list = inM ? visible(ev[day]) : [];
              return (
                <div key={i} className={'cal-cell big' + (inM ? '' : ' off') + (sel === day && inM ? ' sel' : '')} onClick={() => inM && setSel(day)}>
                  <span className={'cal-day' + (isToday ? ' today' : '')}>{shown}</span>
                  <div className="cal-evs">
                    {list.slice(0, 3).map((e, j) => (
                      <span key={j} className="cal-ev" style={{ background: TONE[e.k] + '22', color: TONE[e.k], borderLeft: '2px solid ' + TONE[e.k] }}><span className="mono" style={{ fontSize:9, opacity:.85, marginRight:4 }}>{e.time}</span>{e.l}</span>
                    ))}
                    {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SettingsPage ──────────────────────────────────────────────────────
function Toggle({ on }) { const [v, setV] = React.useState(on); return <button onClick={() => setV(!v)} className={'gx-toggle' + (v ? ' on' : '')}><span className="knob" /></button>; }
function SettingsPage({ item }) {
  const mod = ITEM_MODULE[item.id];
  const secs = [
    { t: 'General', rows: [['Display name', 'input', 'Yerevan Net'], ['Default locale', 'select', 'Հայերեն (hy-AM)'], ['Time zone', 'select', 'Asia/Yerevan (UTC+4)']] },
    { t: 'Behavior', rows: [['Require 2FA for staff', 'toggle', true], ['Auto-assign work items', 'toggle', true], ['Lazy schema validation', 'toggle', true], ['Send outage notifications', 'toggle', false]] },
    { t: 'Access', rows: [['Default role', 'select', 'Agent'], ['Session timeout', 'select', '8 hours'], ['Row-level security', 'toggle', true]] },
  ];
  return (
    <div className="view-inner fade" style={{ maxWidth: 880 }}>
      <div className="crumbs"><span>{mod?.secLabel}</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{item.label}</span></div>
      <ViewHead icon={item.icon} title={item.label} sub="Tenant configuration · enforced by the kernel"
        actions={<><button className="btn btn-ghost btn-sm" onClick={() => window.gxGoStudio && window.gxGoStudio()}><Icon name="wand-2" size={14} style={{ color: 'var(--gx-gold)' }} />Open in Studio</button><button className="btn btn-primary btn-sm"><Icon name="check" size={14} />Save</button></>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {secs.map(s => (
          <div className="card" key={s.t}>
            <div className="card-head"><h3>{s.t}</h3></div>
            <div style={{ padding: '4px 18px 8px' }}>
              {s.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderBottom: i < s.rows.length - 1 ? '1px solid var(--gx-border-subtle)' : 'none' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{r[0]}</span>
                  {r[1] === 'toggle' ? <Toggle on={r[2]} /> : r[1] === 'select'
                    ? <select className="inp inp-sm" style={{ width: 240 }} defaultValue={r[2]}><option>{r[2]}</option></select>
                    : <input className="inp inp-sm" style={{ width: 240 }} defaultValue={r[2]} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { EntityPage, ModuleDashboard, MapView, CalendarView, SettingsPage, KpiStrip });
