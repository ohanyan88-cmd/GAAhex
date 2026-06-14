// ARCHETYPE 1 — INDEX, FULL SHELL (left nav + topbar + content), themed.
// One component, two skins: theme='aurora' (Aurora Glass) | theme='brand' (Cobalt & Gold).
// Full-viewport (covers the host app chrome) so the left nav is in the same mood — the complete page.
// Spirit unchanged: the hive — cells in space, one purpose, gold marks the value.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Home, Sparkles, GitBranch, Inbox, Receipt, Users, CreditCard, Server, Truck, LifeBuoy,
  Bell, Search, Plus, Zap, Table as TableIcon, LayoutGrid, Columns3,
  MessageSquare, Pause, Download, X, ChevronLeft, ChevronRight, ArrowLeft, type LucideIcon,
} from 'lucide-react'
import { Sparkline, Counter, CUSTOMERS, fmtAMD, type Cust } from './_shared'

const ROWS: Cust[] = [
  ...CUSTOMERS,
  { name: 'Aren Tech', org: true, plan: 'Business 500Mbps', status: 'active', mrr: 64000, city: 'Երևան', spark: [40, 42, 44, 46, 48, 50, 52], last: '5 ժ' },
  { name: 'Vega Logistics', org: true, plan: 'Enterprise 1Gbps', status: 'degraded', mrr: 120000, city: 'Աբովյան', spark: [60, 58, 55, 52, 50, 49, 48], last: '5 ժ' },
  { name: 'SkyNet Cafe', org: true, plan: 'Business 300Mbps', status: 'active', mrr: 38000, city: 'Երևան', spark: [20, 22, 23, 25, 26, 27, 28], last: '6 ժ' },
  { name: 'Հովհաննիսյան Մարո', plan: 'Home 200Mbps', status: 'active', mrr: 10000, city: 'Գյումրի', spark: [7, 8, 8, 9, 9, 10, 10], last: '7 ժ' },
  { name: 'Պետրոսյան Դավիթ', plan: 'Home 100Mbps', status: 'critical', mrr: 8000, city: 'Վանաձոր', spark: [9, 8, 7, 6, 5, 4, 3], last: '8 ժ' },
  { name: 'Գրիգորյան Անի', plan: 'Home 300Mbps', status: 'neutral', mrr: 12000, city: 'Արմավիր', spark: [12, 11, 11, 10, 10, 9, 9], last: '1 օր' },
]

const NAV: { sec: string; items: { label: string; icon: LucideIcon; on?: boolean }[] }[] = [
  { sec: 'Home', items: [{ label: 'Workspace', icon: Home }, { label: 'Ask Me', icon: Sparkles }] },
  { sec: 'CRM', items: [{ label: 'Pipeline', icon: GitBranch }, { label: 'Leads', icon: Inbox }, { label: 'Orders', icon: Receipt }, { label: 'Customers', icon: Users, on: true }] },
  { sec: 'Billing & Revenue', items: [{ label: 'Invoices', icon: Receipt }, { label: 'Payments', icon: CreditCard }] },
  { sec: 'Tech & NOC', items: [{ label: 'NMS', icon: Server }, { label: 'Install Board', icon: Truck }, { label: 'Tickets', icon: LifeBuoy }] },
]

type View = 'table' | 'cards' | 'board'
type Filter = 'all' | 'active' | 'risk' | 'enterprise'

export default function IndexShell({ theme = 'aurora' }: { theme?: 'aurora' | 'brand' }) {
  const isA = theme === 'aurora'
  const [view, setView] = useState<View>('table')
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<Set<string>>(new Set())

  const GOLD = isA ? '#E2C589' : 'var(--gx-gold)'
  const TXT1 = isA ? '#fff' : 'var(--gx-text-1)'
  const MUT = isA ? 'rgba(255,255,255,.5)' : 'var(--gx-text-3)'
  const MUT2 = isA ? 'rgba(255,255,255,.72)' : 'var(--gx-text-2)'
  const K = isA
    ? { teal: '#2DD4BF', vio: '#A78BFA', pink: '#F472B6' }
    : { teal: 'var(--gx-interactive)', vio: '#8B6FD6', pink: 'var(--gx-danger)' }
  const sc = (s: Cust['status']) => isA
    ? (s === 'active' ? '#34D399' : s === 'degraded' ? '#FBBF77' : s === 'critical' ? '#FB7185' : 'rgba(255,255,255,.45)')
    : (s === 'active' ? 'var(--gx-success)' : s === 'degraded' ? 'var(--gx-warning)' : s === 'critical' ? 'var(--gx-danger)' : 'var(--gx-text-3)')
  const slabel = (s: Cust['status']) => s === 'active' ? 'Active' : s === 'degraded' ? 'Degraded' : s === 'critical' ? 'At risk' : 'Idle'
  const dotShadow = (c: string) => isA ? `0 0 9px ${c}` : 'none'

  const rows = useMemo(() => ROWS.filter((c) =>
    filter === 'all' ? true : filter === 'active' ? c.status === 'active'
      : filter === 'risk' ? (c.status === 'critical' || c.status === 'degraded') : !!c.org,
  ), [filter])
  const toggle = (n: string) => setSel((p) => { const x = new Set(p); x.has(n) ? x.delete(n) : x.add(n); return x })
  const allOn = rows.length > 0 && rows.every((c) => sel.has(c.name))
  const toggleAll = () => setSel((p) => { const x = new Set(p); if (allOn) rows.forEach((c) => x.delete(c.name)); else rows.forEach((c) => x.add(c.name)); return x })

  const FILTERS: { k: Filter; label: string }[] = [{ k: 'all', label: 'All' }, { k: 'active', label: 'Active' }, { k: 'risk', label: 'At risk' }, { k: 'enterprise', label: 'Enterprise' }]
  const VIEWS: { k: View; icon: LucideIcon; label: string }[] = [{ k: 'table', icon: TableIcon, label: 'Table' }, { k: 'cards', icon: LayoutGrid, label: 'Cards' }, { k: 'board', icon: Columns3, label: 'Board' }]

  return (
    <div className={'sh theme-' + theme} style={{ position: 'fixed', inset: 0, zIndex: 1000, overflow: 'auto', display: 'flex' }}>
      <style>{`
        .sh{font-family:var(--gx-font-sans)}
        .theme-aurora{background:radial-gradient(54% 46% at 8% 4%,rgba(167,139,250,.28),transparent 60%),radial-gradient(46% 40% at 96% 12%,rgba(45,212,191,.22),transparent 60%),radial-gradient(50% 50% at 84% 98%,rgba(244,114,182,.20),transparent 60%),#0B0A1F;color:#fff}
        .theme-brand{background:var(--gx-bg);color:var(--gx-text-1)}
        /* nav */
        .nav{width:236px;flex-shrink:0;padding:16px 12px;display:flex;flex-direction:column;gap:3px;align-self:stretch}
        .theme-aurora .nav{background:rgba(255,255,255,.04);border-right:1px solid rgba(255,255,255,.10);backdrop-filter:blur(20px)}
        .theme-brand .nav{background:var(--gx-sidebar);border-right:1px solid var(--gx-border)}
        .navsec{font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:14px 12px 6px}
        .theme-aurora .navsec{color:rgba(255,255,255,.4)} .theme-brand .navsec{color:var(--gx-text-3)}
        .navitem{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:11px;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s ease;border:none;background:transparent;width:100%;text-align:left}
        .theme-aurora .navitem{color:rgba(255,255,255,.62)} .theme-aurora .navitem:hover{background:rgba(255,255,255,.07);color:#fff}
        .theme-aurora .navitem.on{background:rgba(226,197,137,.15);color:#E2C589;box-shadow:inset 3px 0 0 #E2C589}
        .theme-brand .navitem{color:var(--gx-text-2)} .theme-brand .navitem:hover{background:var(--gx-hover);color:var(--gx-text-1)}
        .theme-brand .navitem.on{background:var(--gx-selected);color:var(--gx-text-1);box-shadow:inset 3px 0 0 var(--gx-gold)}
        /* topbar */
        .top{height:58px;display:flex;align-items:center;gap:14px;padding:0 22px;flex-shrink:0}
        .theme-aurora .top{background:rgba(11,10,31,.55);border-bottom:1px solid rgba(255,255,255,.08);backdrop-filter:blur(18px)}
        .theme-brand .top{background:var(--gx-topbar);border-bottom:1px solid var(--gx-border);backdrop-filter:blur(8px)}
        .ticon{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;cursor:pointer;transition:background .15s ease}
        .theme-aurora .ticon{color:rgba(255,255,255,.7)} .theme-aurora .ticon:hover{background:rgba(255,255,255,.08)}
        .theme-brand .ticon{color:var(--gx-text-2)} .theme-brand .ticon:hover{background:var(--gx-hover)}
        /* glass / surface cell */
        .gl{border-radius:18px}
        .theme-aurora .gl{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(22px) saturate(140%);box-shadow:0 14px 44px rgba(5,4,20,.40),inset 0 1px 0 rgba(255,255,255,.10)}
        .theme-brand .gl{background:var(--gx-surface);border:1px solid var(--gx-border);box-shadow:var(--gx-shadow-sm);border-radius:var(--gx-radius-lg)}
        .cell{transition:background .18s ease,transform .18s ease,box-shadow .18s ease,border-color .18s ease;border-radius:14px}
        .theme-aurora .cell:hover{background:rgba(255,255,255,.08);transform:translateY(-2px);box-shadow:0 12px 30px rgba(167,139,250,.16)}
        .theme-brand .cell:hover{background:var(--gx-surface-2);box-shadow:var(--gx-shadow-md)}
        /* primary button — aurora gold / brand azure */
        .gbtn{border:none;border-radius:12px;padding:10px 18px;font:700 13px var(--gx-font-sans);display:inline-flex;align-items:center;gap:8px;cursor:pointer;transition:transform .15s ease}
        .gbtn:hover{transform:translateY(-1px)}
        .theme-aurora .gbtn{background:linear-gradient(135deg,#E2C589,#C99A45);color:#1A1405;box-shadow:0 8px 22px rgba(197,160,89,.4)}
        .theme-brand .gbtn{background:var(--gx-interactive);color:#fff;box-shadow:var(--gx-shadow-sm)}
        .chip{border-radius:11px;padding:7px 14px;font:600 12px var(--gx-font-sans);cursor:pointer;transition:all .15s ease}
        .theme-aurora .chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.72)} .theme-aurora .chip:hover{background:rgba(255,255,255,.1)}
        .theme-aurora .chip.on{background:rgba(226,197,137,.16);border-color:#E2C589;color:#E2C589}
        .theme-brand .chip{background:var(--gx-surface);border:1px solid var(--gx-border);color:var(--gx-text-2)} .theme-brand .chip:hover{background:var(--gx-hover)}
        .theme-brand .chip.on{background:var(--gx-interactive-soft);border-color:var(--gx-interactive);color:var(--gx-interactive)}
        .vbtn{border:none;border-radius:9px;padding:7px 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font:600 12px var(--gx-font-sans);background:transparent;transition:all .15s ease}
        .theme-aurora .vbtn{color:rgba(255,255,255,.55)} .theme-aurora .vbtn:hover{color:#fff;background:rgba(255,255,255,.06)} .theme-aurora .vbtn.on{color:#1A1405;background:#E2C589}
        .theme-brand .vbtn{color:var(--gx-text-3)} .theme-brand .vbtn:hover{color:var(--gx-text-1);background:var(--gx-hover)} .theme-brand .vbtn.on{color:#fff;background:var(--gx-interactive)}
        .inp{border-radius:12px;height:38px;padding:0 12px 0 34px;font-size:13px;width:210px}
        .theme-aurora .inp{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);color:#fff} .theme-aurora .inp::placeholder{color:rgba(255,255,255,.5)}
        .theme-brand .inp{background:var(--gx-surface);border:1px solid var(--gx-border);color:var(--gx-text-1)} .theme-brand .inp::placeholder{color:var(--gx-text-placeholder)}
        .cb{width:17px;height:17px;border-radius:5px;display:grid;place-items:center;cursor:pointer;flex-shrink:0;transition:all .15s ease;font-size:12px;font-weight:700}
        .theme-aurora .cb{border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.04);color:#1A1405} .theme-aurora .cb.on{background:#E2C589;border-color:#E2C589}
        .theme-brand .cb{border:1.5px solid var(--gx-border-strong);background:var(--gx-surface);color:#fff} .theme-brand .cb.on{background:var(--gx-interactive);border-color:var(--gx-interactive)}
        @keyframes sh-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .sh-in{animation:sh-in .45s cubic-bezier(.2,0,0,1) both}
        @keyframes sh-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}}
        .sh-pulse{animation:sh-pulse 1.7s ease-in-out infinite}
      `}</style>

      {/* ── LEFT NAV ──────────────────────────────────────────────── */}
      <aside className="nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 6px' }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: isA ? 'linear-gradient(135deg,#E2C589,#A78BFA)' : 'var(--gx-cobalt)', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--gx-font-display)', fontWeight: 700, fontSize: 15, color: isA ? '#1A1405' : '#fff' }}>G</span>
          </div>
          <span style={{ fontFamily: 'var(--gx-font-display)', fontWeight: 600, fontSize: 18, color: TXT1 }}>GAA<span style={{ color: GOLD }}>hex</span></span>
        </div>
        {NAV.map((s) => (
          <div key={s.sec}>
            <div className="navsec">{s.sec}</div>
            {s.items.map((it) => (
              <button key={it.label} className={'navitem' + (it.on ? ' on' : '')}>
                <it.icon size={16} />{it.label}
              </button>
            ))}
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <Link to="/proto" className="navitem" style={{ textDecoration: 'none', color: MUT }}><ArrowLeft size={16} />Back to /proto</Link>
      </aside>

      {/* ── MAIN ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* topbar */}
        <header className="top">
          <span style={{ fontSize: 12, color: MUT }}>
            {isA ? 'Aurora Glass' : 'Cobalt & Gold (your brand)'} · Index archetype
          </span>
          <span style={{ flex: 1 }} />
          <span className="ticon"><Bell size={18} /></span>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: isA ? 'rgba(255,255,255,.12)' : 'var(--gx-cobalt)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>Գ</span>
        </header>

        {/* content */}
        <main className="sh-in" style={{ flex: 1, padding: 'clamp(18px,2.4vw,32px)', paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1160 }}>

          {/* pulse header */}
          <div className="gl" style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', background: isA ? 'linear-gradient(135deg,#E2C589,#A78BFA)' : 'var(--gx-gold-soft)', border: isA ? 'none' : '1px solid var(--gx-gold)', flexShrink: 0 }}>
              <Users size={21} color={isA ? '#1A1405' : 'var(--gx-gold)'} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: MUT }}>CRM · Customers</div>
              <h1 style={{ margin: '2px 0 0', fontFamily: 'var(--gx-font-display)', fontSize: 26, fontWeight: 600, color: TXT1 }}>Customers</h1>
              <div style={{ marginTop: 3, fontSize: 13, color: MUT2 }}><b style={{ color: TXT1 }}>142</b> in the hive · <span style={{ color: GOLD, fontWeight: 600 }}>7 need you today</span></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: MUT }} />
                <input className="inp" placeholder="Որոնել…" />
              </div>
              <button className="gbtn"><Plus size={15} />New customer</button>
            </div>
          </div>

          {/* vital signs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {[
              { l: 'Active', v: 142, c: K.teal, s: [120, 128, 132, 136, 139, 142], gold: false },
              { l: 'MRR', v: 3.2, pre: '֏', suf: 'M', dec: 1, c: GOLD, s: [2.6, 2.8, 2.9, 3.0, 3.1, 3.2], gold: true },
              { l: 'Need you', v: 7, c: K.pink, s: [3, 4, 5, 6, 6, 7], gold: false },
              { l: 'Uptime', v: 99.8, suf: '%', dec: 1, c: K.vio, s: [99, 99.3, 99.5, 99.6, 99.7, 99.8], gold: false },
            ].map((k) => (
              <div key={k.l} className="gl" style={{ padding: 18 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: MUT }}>{k.l}</div>
                <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 29, fontWeight: 600, marginTop: 5, color: k.gold ? GOLD : TXT1 }}>
                  <Counter value={k.v} prefix={k.pre ?? ''} suffix={k.suf ?? ''} decimals={k.dec ?? 0} />
                </div>
                <div style={{ marginTop: 12 }}><Sparkline data={k.s} color={k.c} w={208} h={28} /></div>
              </div>
            ))}
          </div>

          {/* gold focal node */}
          <div className="gl" style={{ padding: '15px 22px', display: 'flex', alignItems: 'center', gap: 16, borderColor: isA ? 'rgba(226,197,137,.5)' : 'var(--gx-gold)', background: isA ? 'linear-gradient(135deg,rgba(226,197,137,.14),rgba(255,255,255,.04) 55%)' : 'var(--gx-gold-soft)' }}>
            <div className="sh-pulse" style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', background: GOLD, color: '#1A1405', flexShrink: 0 }}><Zap size={19} /></div>
            <div style={{ flex: 1, fontSize: 14, color: TXT1 }}>
              <span style={{ color: GOLD, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em' }}>Needs you</span>
              <div style={{ marginTop: 2 }}><b>Tigran Auto</b> — ֏38k overdue 9 days · optical Rx dropping. Save before churn.</div>
            </div>
            <button className="gbtn">Open case</button>
          </div>

          {/* filters + view switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>{FILTERS.map((f) => <button key={f.k} className={'chip' + (filter === f.k ? ' on' : '')} onClick={() => setFilter(f.k)}>{f.label}</button>)}</div>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: MUT }}>{rows.length} of 142</span>
            <div className="gl" style={{ display: 'inline-flex', padding: 4, borderRadius: 12, gap: 2 }}>{VIEWS.map((v) => <button key={v.k} className={'vbtn' + (view === v.k ? ' on' : '')} onClick={() => setView(v.k)}><v.icon size={14} />{v.label}</button>)}</div>
          </div>

          {/* body */}
          {view === 'table' && (
            <div className="gl" style={{ padding: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '28px 1.7fr 1.2fr .9fr .8fr .7fr', alignItems: 'center', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: MUT }}>
                <span className={'cb' + (allOn ? ' on' : '')} onClick={toggleAll}>{allOn && '✓'}</span>
                <span>Customer</span><span>Plan</span><span>Status</span><span style={{ textAlign: 'right' }}>MRR</span><span style={{ textAlign: 'right' }}>Last</span>
              </div>
              {rows.map((c) => (
                <div key={c.name} className="cell" style={{ display: 'grid', gridTemplateColumns: '28px 1.7fr 1.2fr .9fr .8fr .7fr', alignItems: 'center', padding: '11px 16px', cursor: 'pointer' }}>
                  <span className={'cb' + (sel.has(c.name) ? ' on' : '')} onClick={() => toggle(c.name)}>{sel.has(c.name) && '✓'}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ width: 30, height: 30, borderRadius: '50%', background: isA ? 'rgba(255,255,255,.1)' : 'var(--gx-surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0, color: MUT2 }}>{c.name.slice(0, 1)}</span>
                    <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: TXT1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span><span style={{ fontSize: 11, color: MUT }}>{c.city}{c.org ? ' · Enterprise' : ''}</span></span>
                  </span>
                  <span style={{ fontSize: 13, color: MUT2 }}>{c.plan}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: MUT2 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(c.status), boxShadow: dotShadow(sc(c.status)) }} />{slabel(c.status)}</span>
                  <span style={{ textAlign: 'right', fontFamily: 'var(--gx-font-display)', fontSize: 15, fontWeight: 600, color: TXT1 }}>{fmtAMD(c.mrr)}</span>
                  <span style={{ textAlign: 'right', fontSize: 11, color: MUT }}>{c.last}</span>
                </div>
              ))}
            </div>
          )}

          {view === 'cards' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(238px,1fr))', gap: 14 }}>
              {rows.map((c) => (
                <div key={c.name} className="gl cell" style={{ padding: 16, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{ width: 36, height: 36, borderRadius: '50%', background: isA ? 'rgba(255,255,255,.1)' : 'var(--gx-surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, color: MUT2 }}>{c.name.slice(0, 1)}</span>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, color: TXT1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div><div style={{ fontSize: 11, color: MUT }}>{c.city}</div></div>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUT2 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(c.status), boxShadow: dotShadow(sc(c.status)) }} />{slabel(c.status)}</span>
                    <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 16, fontWeight: 600, color: GOLD }}>{fmtAMD(c.mrr)}</span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: MUT }}>{c.plan}</div>
                  <div style={{ marginTop: 8 }}><Sparkline data={c.spark} color={sc(c.status)} w={206} h={26} /></div>
                </div>
              ))}
            </div>
          )}

          {view === 'board' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, alignItems: 'start' }}>
              {(['active', 'degraded', 'critical'] as Cust['status'][]).map((col) => {
                const items = rows.filter((c) => col === 'critical' ? (c.status === 'critical' || c.status === 'neutral') : c.status === col)
                const title = col === 'active' ? 'Active' : col === 'degraded' ? 'Watch' : 'At risk'
                return (
                  <div key={col} className="gl" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 12px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: sc(col), boxShadow: dotShadow(sc(col)) }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: TXT1 }}>{title}</span><span style={{ fontSize: 11, color: MUT }}>{items.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {items.map((c) => (
                        <div key={c.name} className="cell" style={{ background: isA ? 'rgba(255,255,255,.05)' : 'var(--gx-surface-2)', border: isA ? '1px solid rgba(255,255,255,.1)' : '1px solid var(--gx-border)', padding: 12, cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: TXT1 }}>{c.name}</span>
                            <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 14, fontWeight: 600, color: GOLD }}>{fmtAMD(c.mrr)}</span>
                          </div>
                          <div style={{ marginTop: 5, fontSize: 11, color: MUT }}>{c.plan} · {c.city}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: MUT }}>
            <span>Showing 1–{rows.length} of 142</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="chip" style={{ padding: '6px 10px' }}><ChevronLeft size={14} /></button>
              <button className="chip on" style={{ padding: '6px 12px' }}>1</button>
              <button className="chip" style={{ padding: '6px 12px' }}>2</button>
              <button className="chip" style={{ padding: '6px 10px' }}><ChevronRight size={14} /></button>
            </div>
          </div>
        </main>
      </div>

      {/* bulk bar */}
      {sel.size > 0 && (
        <div className="gl sh-in" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 1200, boxShadow: '0 18px 50px rgba(5,4,20,.55)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: TXT1 }}><span style={{ color: GOLD }}>{sel.size}</span> selected</span>
          <span style={{ width: 1, height: 22, background: isA ? 'rgba(255,255,255,.16)' : 'var(--gx-border)' }} />
          {[{ i: MessageSquare, l: 'Message' }, { i: Pause, l: 'Suspend' }, { i: Download, l: 'Export' }].map((a) => (
            <button key={a.l} className="vbtn" style={{ color: MUT2 }}><a.i size={14} />{a.l}</button>
          ))}
          <button className="vbtn" onClick={() => setSel(new Set())} style={{ color: MUT }}><X size={14} />Clear</button>
        </div>
      )}
    </div>
  )
}
