/* GAAhex Portal — interaction layer: toasts · record drawer · create modal ·
   row menu · confirm dialog · donut & line charts. All globally available. */

// ───────────────────────── TOASTS (vanilla, robust) ─────────────────────────
function gxToast(msg, type = 'success') {
  let host = document.getElementById('gx-toast-host');
  if (!host) { host = document.createElement('div'); host.id = 'gx-toast-host'; host.className = 'gx-toast-host'; document.body.appendChild(host); }
  const ic = { success: 'check-circle-2', danger: 'alert-circle', info: 'info', warning: 'triangle-alert' }[type] || 'info';
  const t = document.createElement('div');
  t.className = 'gx-toast ' + type;
  t.innerHTML = `<i data-lucide="${ic}"></i><span>${msg}</span><button aria-label="Dismiss"><i data-lucide="x"></i></button>`;
  host.appendChild(t);
  if (window.lucide) window.lucide.createIcons();
  const kill = () => { t.style.animation = 'gxtoastout .2s var(--gx-ease-in) forwards'; setTimeout(() => t.remove(), 200); };
  t.querySelector('button').onclick = kill;
  setTimeout(kill, 3200);
}

// ───────────────────────── ROW ACTION MENU ─────────────────────────
function RowMenu({ onView, onEdit, onDup, onDelete }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const act = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn && fn(); };
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} aria-label="Row actions"><Icon name="ellipsis" size={15} /></button>
      {open && (
        <div className="menu fade-fast" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4 }}>
          <button className="menu-item" onClick={act(onView)}><Icon name="panel-right-open" size={15} />Open record</button>
          <button className="menu-item" onClick={act(onEdit)}><Icon name="square-pen" size={15} />Edit</button>
          <button className="menu-item" onClick={act(onDup)}><Icon name="copy" size={15} />Duplicate</button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={act(onDelete)}><Icon name="trash-2" size={15} />Delete</button>
        </div>
      )}
    </span>
  );
}

// ───────────────────────── CONFIRM DIALOG ─────────────────────────
function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  return (
    <div className="gx-scrim" onClick={onClose}>
      <div className="gx-dialog fade" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 'var(--gx-radius-md)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: danger ? 'var(--gx-danger-soft)' : 'var(--gx-primary-soft)', color: danger ? 'var(--gx-danger)' : 'var(--gx-primary)' }}><Icon name={danger ? 'triangle-alert' : 'info'} size={19} /></span>
            <div><h3 style={{ margin: '2px 0 6px', fontSize: 15, fontWeight: 600 }}>{title}</h3><p style={{ margin: 0, fontSize: 13, color: 'var(--gx-text-2)', lineHeight: 1.5 }}>{body}</p></div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '12px 22px', borderTop: '1px solid var(--gx-border-subtle)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className={'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-primary')} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── NEW / EDIT RECORD MODAL ─────────────────────────
function inputFor(col, val, onChange) {
  const base = { className: 'inp inp-sm' + (col.t === 'money' || col.t === 'mono' || col.t === 'num' ? ' mono' : ''), value: val ?? '', onChange: e => onChange(e.target.value) };
  if (col.t === 'status') return <select {...base}><option>{val}</option><option>Open</option><option>In progress</option><option>Resolved</option><option>Active</option><option>Pending</option></select>;
  if (col.t === 'prio') return <select {...base}><option>Critical</option><option>High</option><option>Normal</option><option>Low</option></select>;
  if (col.t === 'progress') return <input type="number" min="0" max="100" {...base} />;
  return <input {...base} placeholder={col.l} />;
}
function RecordModal({ cfg, title, initial, onSave, onClose }) {
  const editable = cfg.columns.filter(c => c.k !== 'id');
  const [form, setForm] = React.useState(() => { const o = { ...(initial || {}) }; cfg.columns.forEach(c => { if (o[c.k] == null) o[c.k] = c.t === 'status' ? 'Open' : c.t === 'prio' ? 'Normal' : c.t === 'progress' ? 50 : ''; }); return o; });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="gx-scrim" onClick={onClose}>
      <div className="gx-dialog fade" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="gx-dialog-head"><span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span><span className="spacer" /><button className="tb-icon" onClick={onClose}><Icon name="x" size={16} /></button></div>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxHeight: '60vh', overflowY: 'auto' }}>
          {editable.map(c => (
            <label className="field" key={c.k} style={{ gridColumn: c.t === 'textarea' ? '1 / -1' : 'auto' }}>
              <span>{c.l}</span>
              {inputFor(c, form[c.k], v => set(c.k, v))}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--gx-border-subtle)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onSave(form); onClose(); }}><Icon name="check" size={14} />Save</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── RECORD DETAIL DRAWER ─────────────────────────
function RecordDrawer({ item, cfg, row, onClose, onEdit, onDelete, onStatus }) {
  const [tab, setTab] = React.useState('overview');
  const titleKey = cfg.columns.find(c => c.t === 'strong' || c.t === 'avatar' || c.t === 'id')?.k || cfg.columns[0].k;
  const idKey = cfg.columns.find(c => c.t === 'id')?.k;
  const statusKey = cfg.columns.find(c => c.t === 'status')?.k;
  const title = row[titleKey];
  const tabs = [['overview', 'Overview', 'layout-list'], ['activity', 'Activity', 'clock'], ['related', 'Related', 'link'], ['notes', 'Notes', 'message-square']];
  const acts = [
    ['Created', 'Gevorg V.', '3 days ago', 'plus'],
    ['Assigned to ' + (row.owner || 'Ani H.'), 'System', '2 days ago', 'user'],
    ['Status → ' + (row[statusKey] || 'In progress'), 'Narek M.', '1 day ago', 'arrow-right'],
    ['Comment added', 'Ani H.', '4h ago', 'message-square'],
    ['Field updated · amount', 'Gevorg V.', '1h ago', 'square-pen'],
  ];
  const [notes, setNotes] = React.useState([{ who: 'Narek M.', t: '2h ago', body: 'Customer confirmed the issue is resolved. Closing after monitoring.' }]);
  const [draft, setDraft] = React.useState('');
  return (
    <div className="gx-scrim right" onClick={onClose}>
      <div className="gx-drawer fade-slide" onClick={e => e.stopPropagation()}>
        <div className="drawer-head">
          <button className="tb-icon" onClick={onClose}><Icon name="x" size={18} /></button>
          <span className="spacer" />
          <button className="btn btn-secondary btn-sm" onClick={onEdit}><Icon name="square-pen" size={14} />Edit</button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onDelete}><Icon name="trash-2" size={15} /></button>
        </div>
        <div className="drawer-hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="avatar" style={{ width: 46, height: 46, fontSize: 16, borderRadius: 'var(--gx-radius-md)' }}>{initials(String(title))}</span>
            <div style={{ minWidth: 0 }}>
              {idKey && <div className="mono" style={{ fontSize: 11.5, color: 'var(--gx-link)' }}>{row[idKey]}</div>}
              <h2 style={{ margin: '2px 0 0', fontFamily: 'var(--gx-font-display)', fontSize: 20, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</h2>
            </div>
          </div>
          {statusKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <span className="hint" style={{ fontSize: 11 }}>Status</span>
              <select className="inp inp-sm" style={{ width: 'auto', height: 28 }} value={row[statusKey]} onChange={e => onStatus(e.target.value)}>
                {['Open', 'In progress', 'Blocked', 'Resolved', 'Active', 'Pending', 'Overdue', 'Paid'].map(s => <option key={s}>{s}</option>)}
              </select>
              {row.prio && <span className={'pill ' + PRIO_CLASS(row.prio)}>{row.prio}</span>}
            </div>
          )}
        </div>
        <div className="drawer-tabs">
          {tabs.map(t => <button key={t[0]} className={'drawer-tab' + (tab === t[0] ? ' on' : '')} onClick={() => setTab(t[0])}><Icon name={t[2]} size={14} />{t[1]}</button>)}
        </div>
        <div className="drawer-body">
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {cfg.columns.map(c => (
                <div key={c.k} className="kv">
                  <span className="kv-k">{c.l}</span>
                  <span className="kv-v"><Cell col={c} val={row[c.k]} /></span>
                </div>
              ))}
            </div>
          )}
          {tab === 'activity' && (
            <div className="timeline">
              {acts.map((a, i) => (
                <div key={i} className="tl-item">
                  <span className="tl-dot"><Icon name={a[3]} size={13} /></span>
                  <div><div style={{ fontSize: 13 }}>{a[0]}</div><div className="hint" style={{ fontSize: 11.5 }}>{a[1]} · {a[2]}</div></div>
                </div>
              ))}
            </div>
          )}
          {tab === 'related' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[['Invoices', 'receipt', [['INV-2240', '$1,240', 'Paid'], ['INV-2261', '$980', 'Pending']]], ['Work items', 'rows-3', [['WI-4821', 'Fiber drop', 'In progress'], ['WI-4790', 'Speed issue', 'Resolved']]], ['Devices', 'router', [['ont-yvn-0012', '10.42.7.193', 'Online']]]].map(g => (
                <div key={g[0]}>
                  <div className="lbl" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name={g[1]} size={13} />{g[0]}</div>
                  <div className="card" style={{ overflow: 'hidden' }}>
                    {g[2].map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: i < g[2].length - 1 ? '1px solid var(--gx-border-subtle)' : 'none' }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--gx-link)' }}>{r[0]}</span>
                        <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{r[1]}</span>
                        <span className={'pill ' + STATUS_CLASS(r[2])} style={{ marginLeft: 'auto' }}>{r[2]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'notes' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input className="inp inp-sm" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a note…" onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { setNotes(n => [{ who: 'You', t: 'now', body: draft }, ...n]); setDraft(''); gxToast('Note added'); } }} />
                <button className="btn btn-primary btn-sm" onClick={() => { if (draft.trim()) { setNotes(n => [{ who: 'You', t: 'now', body: draft }, ...n]); setDraft(''); gxToast('Note added'); } }}>Post</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {notes.map((n, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10 }}>
                    <span className="avatar" style={{ width: 28, height: 28, fontSize: 10 }}>{initials(n.who)}</span>
                    <div style={{ flex: 1 }}><div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span style={{ fontSize: 12.5, fontWeight: 600 }}>{n.who}</span><span className="hint" style={{ fontSize: 11 }}>{n.t}</span></div><div style={{ fontSize: 13, color: 'var(--gx-text-2)', marginTop: 3, lineHeight: 1.5 }}>{n.body}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── DONUT + LINE CHARTS ─────────────────────────
function Donut({ data, size = 150 }) {
  const total = data.reduce((s, d) => s + d[1], 0);
  let acc = 0; const r = size / 2 - 14; const c = size / 2; const circ = 2 * Math.PI * r;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {data.map((d, i) => { const frac = d[1] / total; const dash = frac * circ; const el = <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={d[2]} strokeWidth="14" strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc * circ} />; acc += frac; return el; })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: d[2] }} /><span style={{ flex: 1 }}>{d[0]}</span>
            <span className="mono tnum" style={{ color: 'var(--gx-text-2)' }}>{Math.round(d[1] / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function LineChart({ series, height = 170 }) {
  const W = 480, H = height, pad = 8;
  const max = Math.max(...series.flatMap(s => s.pts)) * 1.1;
  const x = (i, n) => pad + i * (W - pad * 2) / (n - 1);
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75, 1].map((g, i) => <line key={i} x1={pad} x2={W - pad} y1={H - pad - g * (H - pad * 2)} y2={H - pad - g * (H - pad * 2)} stroke="var(--gx-border-subtle)" strokeWidth="1" />)}
      {series.map((s, si) => {
        const pts = s.pts.map((v, i) => `${x(i, s.pts.length)},${y(v)}`).join(' ');
        const area = `${pad},${H - pad} ${pts} ${W - pad},${H - pad}`;
        return <g key={si}>{s.fill && <polygon points={area} fill={s.color} opacity="0.10" />}<polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>;
      })}
    </svg>
  );
}

Object.assign(window, { gxToast, RowMenu, ConfirmDialog, RecordModal, RecordDrawer, Donut, LineChart });
