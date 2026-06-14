// ARCHETYPE 1 — INDEX · "Cobalt & Gold, lit up" (the beast brand version).
// Brand-TRUE (D18: cobalt=spine, azure=action, gold=signature/value, slate=neutrals) but pushed to its
// premium maximum: deep cobalt-gradient canvas, a faint HEXAGON / hive field, the logo's gold destination
// node made into a glowing gold hexagon, gold-glow value moments, azure interactive spark, big Space
// Grotesk numerals, purposeful motion. Spirit = the hive converging on one gold point of value.
import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  Home, Sparkles, GitBranch, Inbox, Receipt, Users, CreditCard, Server, Truck, LifeBuoy,
  Bell, Search, Plus, Zap, Table as TableIcon, LayoutGrid, Columns3, ArrowUpRight,
  MessageSquare, Pause, Download, X, ChevronLeft, ChevronRight, ArrowLeft, type LucideIcon,
} from 'lucide-react'
import { Sparkline, Counter, CUSTOMERS, fmtAMD, type Cust } from './_shared'

const HEX = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
const GOLD = 'var(--gx-gold)', GOLD3 = '#E2C589', AZ = 'var(--gx-interactive)'

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

const sc = (s: Cust['status']) => s === 'active' ? 'var(--gx-success)' : s === 'degraded' ? 'var(--gx-warning)' : s === 'critical' ? 'var(--gx-danger)' : 'var(--gx-text-3)'
const slabel = (s: Cust['status']) => s === 'active' ? 'Active' : s === 'degraded' ? 'Degraded' : s === 'critical' ? 'At risk' : 'Idle'

function HexOutline({ size, color, opacity, style }: { size: number; color: string; opacity: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ position: 'absolute', opacity, pointerEvents: 'none', ...style }}>
      <polygon points="50,2 94,26 94,74 50,98 6,74 6,26" fill="none" stroke={color} strokeWidth="1.1" />
    </svg>
  )
}

type View = 'table' | 'cards' | 'board'
type Filter = 'all' | 'active' | 'risk' | 'enterprise'

export default function IndexBrandBeast() {
  const [view, setView] = useState<View>('table')
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<Set<string>>(new Set())

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
    <div className="bx" style={{ position: 'fixed', inset: 0, zIndex: 1000, overflow: 'auto', display: 'flex' }}>
      <style>{`
        .bx{
          font-family:var(--gx-font-sans); color:var(--gx-text-1);
          background:
            radial-gradient(130% 80% at 50% -14%, #173458 0%, transparent 50%),
            radial-gradient(70% 55% at 100% 0%, rgba(197,160,89,.045), transparent 55%),
            linear-gradient(180deg, #0D1A2E, #0A1322 62%);
        }
        .bx-surface{background:var(--gx-surface);border:1px solid var(--gx-border);border-radius:var(--gx-radius-lg);
          box-shadow:var(--gx-shadow-sm), inset 0 1px 0 rgba(255,255,255,.05)}
        .bx-cell{transition:transform .16s ease, box-shadow .16s ease, background .16s ease, border-color .16s ease;border-radius:12px}
        .bx-cell:hover{transform:translateY(-2px);background:var(--gx-surface-2);box-shadow:var(--gx-shadow-md);border-color:var(--gx-border-strong)}
        .bx-nav{width:236px;flex-shrink:0;background:#0B1626;border-right:1px solid var(--gx-border);padding:16px 12px;display:flex;flex-direction:column;gap:3px;align-self:stretch}
        .bx-navsec{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--gx-text-3);padding:14px 12px 6px}
        .bx-item{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;
          color:var(--gx-text-2);background:transparent;border:none;width:100%;text-align:left;transition:all .15s ease;position:relative}
        .bx-item:hover{background:var(--gx-hover);color:var(--gx-text-1)}
        .bx-item.on{color:var(--gx-text-1);background:linear-gradient(90deg, rgba(197,160,89,.14), transparent 80%)}
        .bx-item.on::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:2px;background:linear-gradient(${GOLD3}, ${GOLD})}
        .bx-top{height:60px;display:flex;align-items:center;gap:14px;padding:0 24px;flex-shrink:0;background:var(--gx-topbar);border-bottom:1px solid var(--gx-border);backdrop-filter:blur(10px)}
        .bx-ticon{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;cursor:pointer;color:var(--gx-text-2);transition:background .15s ease}
        .bx-ticon:hover{background:var(--gx-hover);color:var(--gx-text-1)}
        .az{background:var(--gx-interactive);color:#fff;border:none;border-radius:9px;
          padding:10px 18px;font:600 13px var(--gx-font-sans);display:inline-flex;align-items:center;gap:8px;cursor:pointer;
          box-shadow:var(--gx-shadow-sm);transition:background .15s ease}
        .az:hover{background:var(--gx-interactive-hover)}
        .chip{border-radius:10px;padding:7px 14px;font:600 12px var(--gx-font-sans);cursor:pointer;background:var(--gx-surface);
          border:1px solid var(--gx-border);color:var(--gx-text-2);transition:all .15s ease}
        .chip:hover{background:var(--gx-surface-2);color:var(--gx-text-1)}
        .chip.on{background:var(--gx-interactive-soft);border-color:var(--gx-interactive);color:#7DD3FC}
        .vbtn{border:none;border-radius:8px;padding:7px 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;
          font:600 12px var(--gx-font-sans);background:transparent;color:var(--gx-text-3);transition:all .15s ease}
        .vbtn:hover{color:var(--gx-text-1);background:var(--gx-hover)}
        .vbtn.on{color:#fff;background:var(--gx-interactive);box-shadow:0 4px 12px rgba(14,165,233,.35)}
        .inp{border-radius:10px;height:38px;padding:0 12px 0 34px;font-size:13px;width:210px;background:var(--gx-surface);
          border:1px solid var(--gx-border);color:var(--gx-text-1)}
        .inp::placeholder{color:var(--gx-text-placeholder)}
        .inp:focus{outline:none;border-color:var(--gx-interactive);box-shadow:0 0 0 3px var(--gx-interactive-soft)}
        .cb{width:17px;height:17px;border-radius:5px;display:grid;place-items:center;cursor:pointer;flex-shrink:0;color:#fff;font-size:12px;font-weight:700;
          border:1.5px solid var(--gx-border-strong);background:var(--gx-surface);transition:all .15s ease}
        .cb.on{background:var(--gx-interactive);border-color:var(--gx-interactive)}
        .num{font-family:var(--gx-font-display);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
        @keyframes bx-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .bx-in{animation:bx-in .45s cubic-bezier(.2,0,0,1) both}
        .bx-quiet{filter:drop-shadow(0 4px 10px rgba(197,160,89,.20))}
      `}</style>

      {/* faint hexagon / hive field */}
      <HexOutline size={420} color={GOLD3} opacity={0.05} style={{ top: -120, right: -90 }} />
      <HexOutline size={300} color="#4E7FC4" opacity={0.05} style={{ bottom: 40, left: 180 }} />
      <HexOutline size={170} color={GOLD3} opacity={0.06} style={{ top: 320, right: 280 }} />
      <HexOutline size={110} color="#4E7FC4" opacity={0.06} style={{ top: 140, left: 300 }} />

      {/* ── LEFT NAV ──────────────────────────────────────────────── */}
      <aside className="bx-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 12px 8px' }}>
          <div style={{ width: 30, height: 34, clipPath: HEX, background: `linear-gradient(160deg, ${GOLD3}, ${GOLD})`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--gx-font-display)', fontWeight: 700, fontSize: 14, color: '#1A1405' }}>G</span>
          </div>
          <span style={{ fontFamily: 'var(--gx-font-display)', fontWeight: 600, fontSize: 19, color: 'var(--gx-text-1)' }}>GAA<span style={{ color: GOLD }}>hex</span></span>
        </div>
        {NAV.map((s) => (
          <div key={s.sec}>
            <div className="bx-navsec">{s.sec}</div>
            {s.items.map((it) => <button key={it.label} className={'bx-item' + (it.on ? ' on' : '')}><it.icon size={16} />{it.label}</button>)}
          </div>
        ))}
        <span style={{ flex: 1 }} />
        <Link to="/proto" className="bx-item" style={{ textDecoration: 'none', color: 'var(--gx-text-3)' }}><ArrowLeft size={16} />Back to /proto</Link>
      </aside>

      {/* ── MAIN ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <header className="bx-top">
          <span className="gx-eyebrow" style={{ color: GOLD, fontFamily: 'var(--gx-font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase' }}>Cobalt &amp; Gold · lit up</span>
          <span style={{ flex: 1 }} />
          <span className="bx-ticon"><Bell size={18} /></span>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--gx-cobalt)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, border: '1px solid var(--gx-border-strong)' }}>Գ</span>
        </header>

        <main className="bx-in" style={{ flex: 1, padding: 'clamp(18px,2.4vw,34px)', paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1160 }}>

          {/* pulse header */}
          <div className="bx-surface" style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ width: 44, height: 50, clipPath: HEX, background: `linear-gradient(165deg, ${GOLD3}, ${GOLD})`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Users size={20} color="#1A1405" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--gx-text-3)' }}>CRM · Customers</div>
              <h1 className="num" style={{ margin: '2px 0 0', fontSize: 27, fontWeight: 600, color: 'var(--gx-text-1)' }}>Customers</h1>
              <div style={{ marginTop: 3, fontSize: 13, color: 'var(--gx-text-2)' }}><b style={{ color: 'var(--gx-text-1)' }}>142</b> in the hive · <span style={{ color: GOLD3, fontWeight: 600 }}>7 need you today</span></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--gx-text-3)' }} />
                <input className="inp" placeholder="Որոնել…" />
              </div>
              <button className="az"><Plus size={15} />New customer</button>
            </div>
          </div>

          {/* vital signs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {[
              { l: 'Active', v: 142, c: 'var(--gx-chart-default)', up: '4%', s: [120, 128, 132, 136, 139, 142], gold: false },
              { l: 'MRR', v: 3.2, pre: '֏', suf: 'M', dec: 1, c: GOLD, up: '4%', s: [2.6, 2.8, 2.9, 3.0, 3.1, 3.2], gold: true },
              { l: 'Need you', v: 7, c: 'var(--gx-danger)', up: '2', s: [3, 4, 5, 6, 6, 7], gold: false },
              { l: 'Uptime', v: 99.8, suf: '%', dec: 1, c: 'var(--gx-interactive)', up: '0.2%', s: [99, 99.3, 99.5, 99.6, 99.7, 99.8], gold: false },
            ].map((k) => (
              <div key={k.l} className="bx-surface" style={{ padding: 18, position: 'relative', overflow: 'hidden' }}>
                {k.gold && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${GOLD3}, ${GOLD})` }} />}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--gx-text-3)' }}>{k.l}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, color: 'var(--gx-success-fg)' }}><ArrowUpRight size={12} />{k.up}</span>
                </div>
                <div className="num" style={{ fontSize: 30, fontWeight: 600, marginTop: 5, color: k.gold ? GOLD3 : 'var(--gx-text-1)' }}>
                  <Counter value={k.v} prefix={k.pre ?? ''} suffix={k.suf ?? ''} decimals={k.dec ?? 0} />
                </div>
                <div style={{ marginTop: 12 }}><Sparkline data={k.s} color={k.c} w={208} h={28} /></div>
              </div>
            ))}
          </div>

          {/* gold focal node — the destination hexagon */}
          <div className="bx-surface" style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 18, borderColor: 'rgba(197,160,89,.45)', background: 'linear-gradient(100deg, rgba(197,160,89,.12), var(--gx-surface) 50%)' }}>
            <div className="bx-quiet" style={{ width: 44, height: 50, clipPath: HEX, background: `linear-gradient(165deg, ${GOLD3}, ${GOLD})`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Zap size={20} color="#1A1405" />
            </div>
            <div style={{ flex: 1, fontSize: 14 }}>
              <span style={{ color: GOLD3, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.07em' }}>The one to save</span>
              <div style={{ marginTop: 2, color: 'var(--gx-text-1)' }}><b>Tigran Auto</b> — ֏38k overdue 9 days · optical Rx dropping. Everything points here.</div>
            </div>
            <button className="az">Open case</button>
          </div>

          {/* filters + view switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>{FILTERS.map((f) => <button key={f.k} className={'chip' + (filter === f.k ? ' on' : '')} onClick={() => setFilter(f.k)}>{f.label}</button>)}</div>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>{rows.length} of 142</span>
            <div className="bx-surface" style={{ display: 'inline-flex', padding: 4, gap: 2, borderRadius: 11 }}>{VIEWS.map((v) => <button key={v.k} className={'vbtn' + (view === v.k ? ' on' : '')} onClick={() => setView(v.k)}><v.icon size={14} />{v.label}</button>)}</div>
          </div>

          {/* body */}
          {view === 'table' && (
            <div className="bx-surface" style={{ padding: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '28px 1.7fr 1.2fr .9fr .8fr .7fr', alignItems: 'center', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--gx-text-3)' }}>
                <span className={'cb' + (allOn ? ' on' : '')} onClick={toggleAll}>{allOn && '✓'}</span>
                <span>Customer</span><span>Plan</span><span>Status</span><span style={{ textAlign: 'right' }}>MRR</span><span style={{ textAlign: 'right' }}>Last</span>
              </div>
              {rows.map((c) => (
                <div key={c.name} className="bx-cell" style={{ display: 'grid', gridTemplateColumns: '28px 1.7fr 1.2fr .9fr .8fr .7fr', alignItems: 'center', padding: '11px 16px', cursor: 'pointer', border: '1px solid transparent' }}>
                  <span className={'cb' + (sel.has(c.name) ? ' on' : '')} onClick={() => toggle(c.name)}>{sel.has(c.name) && '✓'}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ width: 28, height: 32, clipPath: HEX, background: 'var(--gx-surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0, color: 'var(--gx-text-2)' }}>{c.name.slice(0, 1)}</span>
                    <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--gx-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span><span style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>{c.city}{c.org ? ' · Enterprise' : ''}</span></span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--gx-text-2)' }}>{c.plan}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--gx-text-2)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(c.status) }} />{slabel(c.status)}</span>
                  <span className="num" style={{ textAlign: 'right', fontSize: 15, fontWeight: 600, color: 'var(--gx-text-1)' }}>{fmtAMD(c.mrr)}</span>
                  <span style={{ textAlign: 'right', fontSize: 11, color: 'var(--gx-text-3)' }}>{c.last}</span>
                </div>
              ))}
            </div>
          )}

          {view === 'cards' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(238px,1fr))', gap: 14 }}>
              {rows.map((c) => (
                <div key={c.name} className="bx-surface bx-cell" style={{ padding: 16, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{ width: 32, height: 36, clipPath: HEX, background: 'var(--gx-surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, color: 'var(--gx-text-2)' }}>{c.name.slice(0, 1)}</span>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gx-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div><div style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>{c.city}</div></div>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gx-text-2)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(c.status) }} />{slabel(c.status)}</span>
                    <span className="num" style={{ fontSize: 16, fontWeight: 600, color: GOLD3 }}>{fmtAMD(c.mrr)}</span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--gx-text-3)' }}>{c.plan}</div>
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
                  <div key={col} className="bx-surface" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 12px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: sc(col) }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gx-text-1)' }}>{title}</span><span style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>{items.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {items.map((c) => (
                        <div key={c.name} className="bx-cell" style={{ background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)', padding: 12, cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gx-text-1)' }}>{c.name}</span>
                            <span className="num" style={{ fontSize: 14, fontWeight: 600, color: GOLD3 }}>{fmtAMD(c.mrr)}</span>
                          </div>
                          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--gx-text-3)' }}>{c.plan} · {c.city}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--gx-text-3)' }}>
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
        <div className="bx-in" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 1200, background: 'var(--gx-elevated)', border: '1px solid var(--gx-border-strong)', borderRadius: 14, boxShadow: 'var(--gx-shadow-lg)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gx-text-1)' }}><span style={{ color: GOLD3 }}>{sel.size}</span> selected</span>
          <span style={{ width: 1, height: 22, background: 'var(--gx-border)' }} />
          {[{ i: MessageSquare, l: 'Message' }, { i: Pause, l: 'Suspend' }, { i: Download, l: 'Export' }].map((a) => (
            <button key={a.l} className="vbtn" style={{ color: 'var(--gx-text-2)' }}><a.i size={14} />{a.l}</button>
          ))}
          <button className="vbtn" onClick={() => setSel(new Set())} style={{ color: 'var(--gx-text-3)' }}><X size={14} />Clear</button>
        </div>
      )}
    </div>
  )
}
