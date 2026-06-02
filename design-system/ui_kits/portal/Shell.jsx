/* Sidebar + TopBar */

function Sidebar({ collapsed, activeId, onNav }) {
  const [open, setOpen] = React.useState(() => {
    const s = {}; NAV.forEach(n => s[n.id] = !!n.open); return s;
  });
  const toggle = (id) => setOpen(o => ({ ...o, [id]: !o[id] }));
  return (
    <aside className="sb">
      <div className="sb-head">
        <img src="../../assets/logo/GAAhex-logo-reversed.svg" alt="GAAhex" className="wm" />
        <img src="../../assets/logo/GAAhex-mark.svg" alt="GAAhex" style={{ height: 26, display: collapsed ? 'block' : 'none' }} />
      </div>
      <div className="sb-scroll">
        {NAV.map(sec => (
          <div className="sb-sec" key={sec.id}>
            <button className={'sb-sec-btn' + (open[sec.id] ? ' open' : '')} onClick={() => toggle(sec.id)}>
              <Icon name={sec.icon} size={16} />
              <span>{sec.label}</span>
              {sec.admin && <Icon name="lock" size={11} style={{ color:'var(--gx-text-3)', marginLeft:4 }} />}
              <Icon name="chevron-right" size={14} className="chev" />
            </button>
            {open[sec.id] && (
              <div className="sb-items">
                {sec.items.map(it => (
                  <button key={it.id} className={'sb-item' + (activeId === it.id ? ' on' : '')} onClick={() => onNav(it)}>
                    <span className="ic"><Icon name={it.icon} size={15} /></span>
                    <span>{it.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="sb-foot">
        <button className="sb-item" style={{ paddingLeft: 10 }} onClick={() => onNav({ id:'studio-overview', label:'Studio', kind:'studio', icon:'wand-2' })}>
          <span className="ic"><Icon name="wand-2" size={15} /></span>
          <span>Studio</span>
          <span className="pill pill-gold" style={{ marginLeft:'auto', height:18 }}>config</span>
        </button>
      </div>
    </aside>
  );
}

function OrgIdentity() {
  const DEFAULT = { name: 'Yerevan Net', logo: null };
  const [org, setOrg] = React.useState(() => {
    try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem('gx-org') || '{}') }; } catch (e) { return DEFAULT; }
  });
  const [open, setOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState(org.name);
  const [draftLogo, setDraftLogo] = React.useState(org.logo);
  const ref = React.useRef(null);
  const fileRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const ini = (n) => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const openEditor = () => { setDraftName(org.name); setDraftLogo(org.logo); setOpen(true); };
  const save = () => {
    const next = { name: draftName.trim() || 'Company', logo: draftLogo };
    setOrg(next);
    try { localStorage.setItem('gx-org', JSON.stringify(next)); } catch (e) {}
    setOpen(false);
    if (window.gxToast) window.gxToast('Company identity updated');
  };
  const pickLogo = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setDraftLogo(r.result);
    r.readAsDataURL(f);
  };

  return (
    <div className="org-wrap" ref={ref}>
      <button className="org" onClick={openEditor} title="Edit company name & logo">
        {org.logo
          ? <img className="org-badge" src={org.logo} alt="" />
          : <span className="org-badge">{ini(org.name)}</span>}
        <span className="org-name">{org.name}</span>
        <Icon name="pencil" size={12} className="org-edit" style={{ color: 'var(--gx-text-3)' }} />
      </button>
      {open && (
        <div className="menu fade-fast org-pop" onClick={e => e.stopPropagation()}>
          <div className="lbl" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '2px 4px 10px' }}>Company identity</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            {draftLogo
              ? <img src={draftLogo} alt="" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              : <span style={{ width: 46, height: 46, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#2A1E07', background: 'linear-gradient(135deg,var(--gold-400),var(--gold-700))' }}>{ini(draftName)}</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="upload" size={13} />Upload logo</button>
              {draftLogo && <button className="btn btn-ghost btn-sm" onClick={() => setDraftLogo(null)} style={{ color: 'var(--gx-text-3)' }}><Icon name="x" size={13} />Remove logo</button>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
          </div>
          <label className="field" style={{ marginBottom: 14 }}>
            <span>Company name</span>
            <input className="inp inp-sm" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Company name" autoFocus onKeyDown={e => { if (e.key === 'Enter') save(); }} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save}><Icon name="check" size={13} />Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const SEED = [
    { id: 1, icon: 'triangle-alert', tone: 'var(--gx-danger)', title: 'Outage escalated', body: 'TK-4826 moved to Tier 2 — Yerevan POP-3', t: '14m ago', read: false },
    { id: 2, icon: 'check-circle-2', tone: 'var(--gx-success)', title: 'Ticket resolved', body: 'Narek M. closed TK-4822', t: '2h ago', read: false },
    { id: 3, icon: 'server', tone: 'var(--gx-info)', title: 'Line provisioned', body: '10.42.7.193 is now live', t: '3h ago', read: false },
    { id: 4, icon: 'receipt', tone: 'var(--gx-gold)', title: 'Invoices generated', body: '1,204 invoices issued for May', t: '5h ago', read: true },
    { id: 5, icon: 'wand-2', tone: 'var(--gx-text-2)', title: 'Entity created', body: 'Gevorg V. added “Opportunities” in Studio', t: 'Yesterday', read: true },
  ];
  const [items, setItems] = React.useState(SEED);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const unread = items.filter(i => !i.read).length;
  const markAll = () => setItems(it => it.map(i => ({ ...i, read: true })));
  const clear = () => { setItems([]); if (window.gxToast) window.gxToast('Notifications cleared'); };
  const toggleOne = (id) => setItems(it => it.map(i => i.id === id ? { ...i, read: true } : i));

  return (
    <div className="notif-wrap" ref={ref}>
      <button className={'tb-icon' + (open ? ' on' : '')} aria-label="Notifications" onClick={() => setOpen(o => !o)}>
        <Icon name="bell" size={18} />{unread > 0 && <span className="ndot" />}
      </button>
      {open && (
        <div className="menu fade-fast notif-pop" onClick={e => e.stopPropagation()}>
          <div className="notif-head">
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Notifications</span>
            {unread > 0 && <span className="badge" style={{ marginLeft: 8 }}>{unread}</span>}
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={markAll} disabled={unread === 0}>Mark all read</button>
          </div>
          <div className="notif-list">
            {items.length === 0 && (
              <div className="stub" style={{ padding: '36px 20px' }}>
                <div className="si" style={{ width: 44, height: 44 }}><Icon name="bell-off" size={20} /></div>
                <div style={{ fontSize: 13, color: 'var(--gx-text-2)' }}>You’re all caught up</div>
              </div>
            )}
            {items.map(n => (
              <button key={n.id} className={'notif-item' + (n.read ? '' : ' unread')} onClick={() => toggleOne(n.id)}>
                <span className="notif-ic" style={{ color: n.tone }}><Icon name={n.icon} size={16} /></span>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{n.title}</span>
                    {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gx-primary)', marginLeft: 'auto', flexShrink: 0 }} />}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--gx-text-2)', marginTop: 2, lineHeight: 1.4 }}>{n.body}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--gx-text-3)', marginTop: 3 }}>{n.t}</span>
                </span>
              </button>
            ))}
          </div>
          {items.length > 0 && (
            <div className="notif-foot">
              <button className="btn btn-ghost btn-sm" onClick={clear} style={{ color: 'var(--gx-text-3)' }}><Icon name="trash-2" size={13} />Clear all</button>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>View all<Icon name="arrow-right" size={13} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu({ theme, onTheme }) {
  const USER = { name: 'Gevorg Vardanyan', role: 'Administrator', email: 'gevorg@yerevan.isp', initials: 'GV' };
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState('menu'); // menu | profile
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setView('menu'); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const close = () => { setOpen(false); setView('menu'); };
  const act = (label) => { close(); if (window.gxToast) window.gxToast(label); };
  const signOut = () => { close(); try { localStorage.removeItem('gx-authed'); } catch (e) {} if (window.gxSignOut) window.gxSignOut(); };

  return (
    <div className="user-wrap" ref={ref}>
      <button className={'userchip' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} title="Account">
        <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{USER.initials}</div>
        <div className="userchip-meta">
          <span className="userchip-name">{USER.name}</span>
          <span className="userchip-role">{USER.role}</span>
        </div>
        <Icon name="chevron-down" size={14} style={{ color: 'var(--gx-text-3)' }} />
      </button>
      {open && (
        <div className="menu fade-fast user-pop" onClick={e => e.stopPropagation()}>
          {view === 'menu' ? (
            <>
              <div className="user-card">
                <div className="avatar" style={{ width: 42, height: 42, fontSize: 15 }}>{USER.initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{USER.name}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--gx-text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{USER.email}</div>
                </div>
              </div>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => setView('profile')}><Icon name="user" size={15} />My profile</button>
              <button className="menu-item" onClick={() => act('Opening account settings')}><Icon name="settings" size={15} />Account settings</button>
              <button className="menu-item" onClick={() => act('Opening preferences')}><Icon name="sliders-horizontal" size={15} />Preferences</button>
              <button className="menu-item" onClick={() => { onTheme(); }}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
              <button className="menu-item" onClick={() => act('Opening keyboard shortcuts')}><Icon name="keyboard" size={15} />Keyboard shortcuts</button>
              <div className="menu-sep" />
              <button className="menu-item danger" onClick={signOut}><Icon name="log-out" size={15} />Sign out</button>
            </>
          ) : (
            <>
              <div className="user-pop-head">
                <button className="tb-icon" style={{ width: 28, height: 28 }} onClick={() => setView('menu')}><Icon name="chevron-left" size={16} /></button>
                <span style={{ fontWeight: 600, fontSize: 13 }}>My profile</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0 14px' }}>
                <div className="avatar" style={{ width: 56, height: 56, fontSize: 20 }}>{USER.initials}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{USER.name}</div>
                <span className="pill pill-gold">{USER.role}</span>
              </div>
              <div className="kv" style={{ padding: '9px 0' }}><span className="kv-k" style={{ width: 70 }}>Email</span><span className="kv-v mono" style={{ fontSize: 12 }}>{USER.email}</span></div>
              <div className="kv" style={{ padding: '9px 0' }}><span className="kv-k" style={{ width: 70 }}>Team</span><span className="kv-v">Network Operations</span></div>
              <div className="kv" style={{ padding: '9px 0' }}><span className="kv-k" style={{ width: 70 }}>Status</span><span className="kv-v"><span className="pill pill-success"><span className="d" style={{ background: 'var(--gx-online)' }} />Active</span></span></div>
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 12 }} onClick={() => act('Edit profile')}><Icon name="square-pen" size={13} />Edit profile</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TopBar({ onToggleSidebar, onCommand, theme, onTheme, title }) {
  return (
    <header className="tb">
      <button className="tb-icon" onClick={onToggleSidebar} aria-label="Toggle sidebar"><Icon name="panel-left" size={18} /></button>
      <OrgIdentity />
      <span className="spacer" />
      <NotificationBell />
      <UserMenu theme={theme} onTheme={onTheme} />
    </header>
  );
}

Object.assign(window, { Sidebar, TopBar, OrgIdentity, NotificationBell, UserMenu });
