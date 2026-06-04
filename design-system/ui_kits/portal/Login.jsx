/* GAAhex — Login + Command Palette */

function Login({ onLogin }) {
  const [email, setEmail] = React.useState('admin@yerevan.isp');
  const [pw, setPw] = React.useState('••••••••••');
  return (
    <div className="login-wrap">
      <div className="login-brand">
        <img src="../../assets/logo/GAAhex-logo-reversed.svg" alt="GAAhex" style={{ height: 34, position:'relative', zIndex:1 }} />
        <div style={{ position:'relative', zIndex:1 }}>
          <div className="gx-eyebrow" style={{ marginBottom: 14 }}>THE OPERATING SYSTEM FOR ISPs</div>
          <h1 style={{ fontFamily:'var(--gx-font-display)', fontSize: 40, fontWeight: 600, lineHeight: 1.08, letterSpacing:'-.03em', margin:0, maxWidth: 420 }}>
            Every department.<br/>Every role.<br/><span style={{ color:'var(--gx-gold)' }}>One system.</span>
          </h1>
          <p style={{ color:'var(--gx-text-2)', fontSize: 14, marginTop: 18, maxWidth: 380, lineHeight: 1.6 }}>
            CRM, billing, network, field ops, finance &amp; more — rendered from configuration, built in Studio.
          </p>
        </div>
        <div style={{ display:'flex', gap: 22, position:'relative', zIndex:1 }}>
          {[['18','modules'],['99.98%','uptime'],['0','hardcoded screens']].map(s => (
            <div key={s[1]}><div style={{ fontFamily:'var(--gx-font-display)', fontSize: 22, fontWeight: 600, color:'#fff' }}>{s[0]}</div><div style={{ fontSize: 11, color:'var(--gx-text-3)' }}>{s[1]}</div></div>
          ))}
        </div>
      </div>
      <div className="login-card">
        <form className="login-form fade" onSubmit={e => { e.preventDefault(); onLogin(); }}>
          <h2 style={{ fontFamily:'var(--gx-font-display)', fontSize: 24, fontWeight: 600, margin:'0 0 6px', letterSpacing:'-.02em' }}>Sign in</h2>
          <p className="hint" style={{ margin:'0 0 24px' }}>Welcome back. Use your tenant credentials.</p>
          <label className="field" style={{ marginBottom: 14 }}><span>Email</span><input className="inp" value={email} onChange={e=>setEmail(e.target.value)} /></label>
          <label className="field" style={{ marginBottom: 8 }}><span>Password</span><input className="inp" type="password" value={pw} onChange={e=>setPw(e.target.value)} /></label>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'10px 0 22px' }}>
            <label style={{ display:'flex', gap:7, alignItems:'center', fontSize:12.5, color:'var(--gx-text-2)' }}><input type="checkbox" defaultChecked /> Remember me</label>
            <a className="btn-link" style={{ fontSize: 12.5 }}>Forgot password?</a>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width:'100%' }} type="submit"><Icon name="log-in" size={16} />Sign in</button>
          <div style={{ display:'flex', alignItems:'center', gap:12, margin:'22px 0' }}><div style={{ flex:1, height:1, background:'var(--gx-border)' }} /><span className="hint" style={{ fontSize: 11 }}>or</span><div style={{ flex:1, height:1, background:'var(--gx-border)' }} /></div>
          <button className="btn btn-secondary btn-lg" style={{ width:'100%' }} type="button"><Icon name="shield" size={16} />Continue with SSO</button>
        </form>
      </div>
    </div>
  );
}

function CommandPalette({ open, onClose, onNav }) {
  const [q, setQ] = React.useState('');
  const all = React.useMemo(() => {
    const out = [];
    NAV.forEach(s => s.items.forEach(it => out.push({ ...it, sec: s.label })));
    return out;
  }, []);
  const results = all.filter(r => (r.label + ' ' + r.sec).toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  React.useEffect(() => {
    if (!open) setQ('');
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'var(--gx-overlay)', backdropFilter:'blur(4px)', zIndex:'var(--gx-z-modal)', display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:'12vh' }}>
      <div className="fade" onClick={e=>e.stopPropagation()} style={{ width: 560, maxWidth:'92vw', background:'var(--gx-elevated)', border:'1px solid var(--gx-border-strong)', borderRadius:'var(--gx-radius-xl)', boxShadow:'var(--gx-shadow-xl)', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid var(--gx-border-subtle)' }}>
          <Icon name="search" size={18} style={{ color:'var(--gx-text-3)' }} />
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pages, records, actions…" style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--gx-text-1)', fontSize:15, fontFamily:'var(--gx-font-sans)' }} />
          <span className="kbd" style={{ fontFamily:'var(--gx-font-mono)', fontSize:10, background:'var(--gx-surface-2)', border:'1px solid var(--gx-border)', borderRadius:4, padding:'2px 6px', color:'var(--gx-text-3)' }}>ESC</span>
        </div>
        <div style={{ padding: 8, maxHeight: 340, overflowY:'auto' }}>
          <div className="lbl" style={{ padding:'8px 10px 4px', fontSize:10, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--gx-text-3)' }}>Navigate</div>
          {results.map(r => (
            <button key={r.id} onClick={() => { onNav(r); onClose(); }} style={{ width:'100%', display:'flex', alignItems:'center', gap:11, padding:'9px 10px', border:'none', background:'none', color:'var(--gx-text-1)', cursor:'pointer', borderRadius:'var(--gx-radius-md)', fontSize:13, fontFamily:'var(--gx-font-sans)', textAlign:'left' }} onMouseEnter={e=>e.currentTarget.style.background='var(--gx-hover)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
              <Icon name={r.icon} size={16} style={{ color:'var(--gx-text-3)' }} />
              <span>{r.label}</span>
              <span style={{ marginLeft:'auto', fontSize:11, color:'var(--gx-text-3)' }}>{r.sec}</span>
            </button>
          ))}
          {results.length === 0 && <div className="hint" style={{ padding:'18px 10px', textAlign:'center' }}>No matches.</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Login, CommandPalette });
