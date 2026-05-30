/* Sidebar + TopBar */

function Sidebar({ collapsed, activeId, onNav }) {
  const [open, setOpen] = React.useState(() => {
    const s = {}; NAV.forEach(n => s[n.id] = !!n.open); return s;
  });
  const toggle = (id) => setOpen(o => ({ ...o, [id]: !o[id] }));
  return (
    <aside className="sb">
      <div className="sb-head">
        <img src="../../assets/logo/GAAex-logo-reversed.svg" alt="GAAex" className="wm" />
        <img src="../../assets/logo/GAAex-mark.svg" alt="GAAex" style={{ height: 26, display: collapsed ? 'block' : 'none' }} />
      </div>
      <div className="sb-scroll">
        {NAV.map(sec => (
          <div className="sb-sec" key={sec.id}>
            <button className={'sb-sec-btn' + (open[sec.id] ? ' open' : '')} onClick={() => toggle(sec.id)}>
              <Icon name={sec.icon} size={16} />
              <span>{sec.label}</span>
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
        <button className="sb-item" style={{ paddingLeft: 10 }} onClick={() => onNav({ id:'adm-studio', label:'Studio', kind:'studio', icon:'wand-2' })}>
          <span className="ic"><Icon name="wand-2" size={15} /></span>
          <span>Studio</span>
          <span className="pill pill-gold" style={{ marginLeft:'auto', height:18 }}>config</span>
        </button>
      </div>
    </aside>
  );
}

function TopBar({ onToggleSidebar, onCommand, theme, onTheme, title }) {
  return (
    <header className="tb">
      <button className="tb-icon" onClick={onToggleSidebar} aria-label="Toggle sidebar"><Icon name="panel-left" size={18} /></button>
      <button className="tb-search" onClick={onCommand}>
        <Icon name="search" size={15} />
        <span style={{ fontSize: 13 }}>Search or run a command…</span>
        <span className="kbd">⌘K</span>
      </button>
      <span className="spacer" />
      <button className="btn btn-primary btn-sm"><Icon name="plus" size={14} />Create</button>
      <button className="tb-icon" onClick={onTheme} aria-label="Theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button>
      <button className="tb-icon" aria-label="Help"><Icon name="circle-help" size={18} /></button>
      <button className="tb-icon" aria-label="Notifications"><Icon name="bell" size={18} /><span className="ndot" /></button>
      <div className="tenant">
        <span className="avatar" style={{ width:22, height:22, fontSize:10, borderRadius:6, background:'linear-gradient(135deg,var(--gold-400),var(--gold-700))', color:'#2A1E07' }}>YN</span>
        <span style={{ fontSize:12.5, fontWeight:600 }}>Yerevan Net</span>
        <Icon name="chevron-down" size={14} style={{ color:'var(--gx-text-3)' }} />
      </div>
      <div className="avatar" title="Gevorg">GV</div>
    </header>
  );
}

Object.assign(window, { Sidebar, TopBar });
