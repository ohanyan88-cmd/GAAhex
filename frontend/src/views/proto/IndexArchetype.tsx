// ARCHETYPE 1 — INDEX (list / collection). The most-repeated page; every entity sits on it.
// Skin = Aurora Glass. Spirit = the hive: many cells doing real work, all converging on ONE purpose,
// gold marks the value / the one that needs you. Cells live in space (glow + elevation), NOT lines.
// Real anatomy: pulse header · vital-sign KPIs · gold focal node · filters + view-switch
// (table / cards / board) · selection + bulk bar · pagination. Interactive. /proto only until promoted.
import { useMemo, useState } from 'react'
import {
  Users, Search, Plus, Zap, Table as TableIcon, LayoutGrid, Columns3,
  MessageSquare, Pause, Download, X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Sparkline, Counter, CUSTOMERS, fmtAMD, type Cust } from './_shared'

const GOLD = '#E2C589', VIOLET = '#A78BFA', TEAL = '#2DD4BF', PINK = '#F472B6'
const sc = (s: Cust['status']) => s === 'active' ? '#34D399' : s === 'degraded' ? '#FBBF77' : s === 'critical' ? '#FB7185' : 'rgba(255,255,255,.45)'
const slabel = (s: Cust['status']) => s === 'active' ? 'Active' : s === 'degraded' ? 'Degraded' : s === 'critical' ? 'At risk' : 'Idle'

// A fuller hive for the list / board.
const ROWS: Cust[] = [
  ...CUSTOMERS,
  { name: 'Aren Tech', org: true, plan: 'Business 500Mbps', status: 'active', mrr: 64000, city: 'Երևան', spark: [40, 42, 44, 46, 48, 50, 52], last: '5 ժ' },
  { name: 'Vega Logistics', org: true, plan: 'Enterprise 1Gbps', status: 'degraded', mrr: 120000, city: 'Աբովյան', spark: [60, 58, 55, 52, 50, 49, 48], last: '5 ժ' },
  { name: 'SkyNet Cafe', org: true, plan: 'Business 300Mbps', status: 'active', mrr: 38000, city: 'Երևան', spark: [20, 22, 23, 25, 26, 27, 28], last: '6 ժ' },
  { name: 'Հովհաննիսյան Մարո', plan: 'Home 200Mbps', status: 'active', mrr: 10000, city: 'Գյումրի', spark: [7, 8, 8, 9, 9, 10, 10], last: '7 ժ' },
  { name: 'Պետրոսյան Դավիթ', plan: 'Home 100Mbps', status: 'critical', mrr: 8000, city: 'Վանաձոր', spark: [9, 8, 7, 6, 5, 4, 3], last: '8 ժ' },
  { name: 'Գրիգորյան Անի', plan: 'Home 300Mbps', status: 'neutral', mrr: 12000, city: 'Արմավիր', spark: [12, 11, 11, 10, 10, 9, 9], last: '1 օր' },
]

type View = 'table' | 'cards' | 'board'
type Filter = 'all' | 'active' | 'risk' | 'enterprise'

export default function IndexArchetype() {
  const [view, setView] = useState<View>('table')
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<Set<string>>(new Set())

  const rows = useMemo(() => ROWS.filter((c) =>
    filter === 'all' ? true
      : filter === 'active' ? c.status === 'active'
      : filter === 'risk' ? (c.status === 'critical' || c.status === 'degraded')
      : !!c.org,
  ), [filter])

  const toggle = (n: string) => setSel((p) => { const x = new Set(p); x.has(n) ? x.delete(n) : x.add(n); return x })
  const allOn = rows.length > 0 && rows.every((c) => sel.has(c.name))
  const toggleAll = () => setSel((p) => { const x = new Set(p); if (allOn) rows.forEach((c) => x.delete(c.name)); else rows.forEach((c) => x.add(c.name)); return x })

  const FILTERS: { k: Filter; label: string }[] = [
    { k: 'all', label: 'All' }, { k: 'active', label: 'Active' }, { k: 'risk', label: 'At risk' }, { k: 'enterprise', label: 'Enterprise' },
  ]
  const VIEWS: { k: View; icon: typeof TableIcon; label: string }[] = [
    { k: 'table', icon: TableIcon, label: 'Table' }, { k: 'cards', icon: LayoutGrid, label: 'Cards' }, { k: 'board', icon: Columns3, label: 'Board' },
  ]

  return (
    <div className="idx-root" style={{ minHeight: '100%', position: 'relative', padding: 'clamp(20px,3vw,40px)', paddingBottom: 96 }}>
      <style>{`
        .idx-root{
          background:
            radial-gradient(56% 48% at 10% 6%, rgba(167,139,250,.30), transparent 60%),
            radial-gradient(48% 42% at 94% 14%, rgba(45,212,191,.24), transparent 60%),
            radial-gradient(52% 52% at 82% 98%, rgba(244,114,182,.22), transparent 60%),
            #0B0A1F;
          color:#fff; font-family:var(--gx-font-sans);
        }
        .gl{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.13);border-radius:20px;
          backdrop-filter:blur(22px) saturate(140%);-webkit-backdrop-filter:blur(22px) saturate(140%);
          box-shadow:0 14px 44px rgba(5,4,20,.42), inset 0 1px 0 rgba(255,255,255,.10)}
        .cell{transition:background .18s ease, transform .18s ease, box-shadow .18s ease, border-color .18s ease;border-radius:16px}
        .cell:hover{background:rgba(255,255,255,.08);transform:translateY(-2px);box-shadow:0 12px 32px rgba(167,139,250,.16)}
        .gbtn{background:linear-gradient(135deg, ${GOLD}, #C99A45);color:#1A1405;border:none;border-radius:13px;
          padding:10px 18px;font:700 13px var(--gx-font-sans);display:inline-flex;align-items:center;gap:8px;cursor:pointer;
          box-shadow:0 8px 22px rgba(197,160,89,.4);transition:transform .15s ease}
        .gbtn:hover{transform:translateY(-1px)}
        .chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.72);
          border-radius:11px;padding:7px 14px;font:600 12px var(--gx-font-sans);cursor:pointer;transition:all .15s ease}
        .chip:hover{background:rgba(255,255,255,.1)}
        .chip.on{background:rgba(226,197,137,.16);border-color:${GOLD};color:${GOLD}}
        .vbtn{background:transparent;border:none;color:rgba(255,255,255,.55);border-radius:9px;padding:7px 11px;cursor:pointer;
          display:inline-flex;align-items:center;gap:6px;font:600 12px var(--gx-font-sans);transition:all .15s ease}
        .vbtn:hover{color:#fff;background:rgba(255,255,255,.06)}
        .vbtn.on{color:#0B0A1F;background:${GOLD}}
        .inp{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:13px;height:40px;
          padding:0 12px 0 34px;color:#fff;font-size:13px;width:200px}
        .inp::placeholder{color:rgba(255,255,255,.5)}
        .cb{width:17px;height:17px;border-radius:5px;border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.04);
          display:grid;place-items:center;cursor:pointer;flex-shrink:0;transition:all .15s ease}
        .cb.on{background:${GOLD};border-color:${GOLD}}
        @keyframes idx-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .idx-in{animation:idx-in .5s cubic-bezier(.2,0,0,1) both}
        @keyframes idx-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}}
        .idx-pulse{animation:idx-pulse 1.7s ease-in-out infinite}
      `}</style>

      <div className="idx-in" style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ── Pulse header — identity + the ONE purpose ────────────── */}
        <div className="gl" style={{ padding: '20px 26px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ width: 48, height: 48, borderRadius: 15, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${GOLD}, ${VIOLET})`, boxShadow: '0 8px 22px rgba(167,139,250,.45)', flexShrink: 0 }}>
            <Users size={22} color="#1A1405" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' }}>CRM · Customers</div>
            <h1 style={{ margin: '2px 0 0', fontFamily: 'var(--gx-font-display)', fontSize: 28, fontWeight: 600 }}>Customers</h1>
            <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,.66)' }}>
              <b style={{ color: '#fff' }}>142</b> in the hive · <span style={{ color: GOLD, fontWeight: 600 }}>7 need you today</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,.5)' }} />
              <input className="inp" placeholder="Որոնել…" />
            </div>
            <button className="gbtn"><Plus size={15} />New customer</button>
          </div>
        </div>

        {/* ── Vital signs — the hive's KPIs ────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
          {[
            { l: 'Active', v: 142, c: TEAL, s: [120, 128, 132, 136, 139, 142] },
            { l: 'MRR', v: 3.2, pre: '֏', suf: 'M', dec: 1, c: GOLD, s: [2.6, 2.8, 2.9, 3.0, 3.1, 3.2] },
            { l: 'Need you', v: 7, c: PINK, s: [3, 4, 5, 6, 6, 7] },
            { l: 'Uptime', v: 99.8, suf: '%', dec: 1, c: VIOLET, s: [99, 99.3, 99.5, 99.6, 99.7, 99.8] },
          ].map((k) => (
            <div key={k.l} className="gl" style={{ padding: 18 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.07em', color: 'rgba(255,255,255,.58)' }}>{k.l}</div>
              <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 30, fontWeight: 600, marginTop: 5, color: k.c === GOLD ? GOLD : '#fff' }}>
                <Counter value={k.v} prefix={k.pre ?? ''} suffix={k.suf ?? ''} decimals={k.dec ?? 0} />
              </div>
              <div style={{ marginTop: 12 }}><Sparkline data={k.s} color={k.c} w={210} h={30} /></div>
            </div>
          ))}
        </div>

        {/* ── Gold focal node — the one the hive converges on ──────── */}
        <div className="gl" style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 18, borderColor: 'rgba(226,197,137,.5)', background: 'linear-gradient(135deg, rgba(226,197,137,.14), rgba(255,255,255,.04) 55%)' }}>
          <div className="idx-pulse" style={{ width: 40, height: 40, borderRadius: 13, display: 'grid', placeItems: 'center', background: GOLD, color: '#1A1405', flexShrink: 0, boxShadow: `0 0 22px rgba(226,197,137,.5)` }}>
            <Zap size={20} />
          </div>
          <div style={{ flex: 1, fontSize: 14 }}>
            <span style={{ color: GOLD, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em' }}>Needs you</span>
            <div style={{ marginTop: 2 }}><b>Tigran Auto</b> — ֏38k overdue 9 days · optical Rx dropping. Save before churn.</div>
          </div>
          <button className="gbtn">Open case</button>
        </div>

        {/* ── Filters + view switch ────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {FILTERS.map((f) => (
              <button key={f.k} className={'chip' + (filter === f.k ? ' on' : '')} onClick={() => setFilter(f.k)}>{f.label}</button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{rows.length} of 142</span>
          <div className="gl" style={{ display: 'inline-flex', padding: 4, borderRadius: 13, gap: 2 }}>
            {VIEWS.map((v) => (
              <button key={v.k} className={'vbtn' + (view === v.k ? ' on' : '')} onClick={() => setView(v.k)}><v.icon size={14} />{v.label}</button>
            ))}
          </div>
        </div>

        {/* ── Body — the cells, switchable ─────────────────────────── */}
        {view === 'table' && (
          <div className="gl" style={{ padding: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '28px 1.7fr 1.2fr .9fr .8fr .7fr', alignItems: 'center', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'rgba(255,255,255,.45)' }}>
              <span className={'cb' + (allOn ? ' on' : '')} onClick={toggleAll}>{allOn && '✓'}</span>
              <span>Customer</span><span>Plan</span><span>Status</span><span style={{ textAlign: 'right' }}>MRR</span><span style={{ textAlign: 'right' }}>Last</span>
            </div>
            {rows.map((c) => (
              <div key={c.name} className="cell" style={{ display: 'grid', gridTemplateColumns: '28px 1.7fr 1.2fr .9fr .8fr .7fr', alignItems: 'center', padding: '11px 16px', cursor: 'pointer' }}>
                <span className={'cb' + (sel.has(c.name) ? ' on' : '')} onClick={() => toggle(c.name)} style={{ color: '#1A1405', fontSize: 12, fontWeight: 700 }}>{sel.has(c.name) && '✓'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{c.name.slice(0, 1)}</span>
                  <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span><span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>{c.city}{c.org ? ' · Enterprise' : ''}</span></span>
                </span>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,.72)' }}>{c.plan}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(255,255,255,.78)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(c.status), boxShadow: `0 0 9px ${sc(c.status)}` }} />{slabel(c.status)}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--gx-font-display)', fontSize: 15, fontWeight: 600 }}>{fmtAMD(c.mrr)}</span>
                <span style={{ textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,.45)' }}>{c.last}</span>
              </div>
            ))}
          </div>
        )}

        {view === 'cards' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
            {rows.map((c) => (
              <div key={c.name} className="gl cell" style={{ padding: 16, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>{c.name.slice(0, 1)}</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>{c.city}</div></div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: sc(c.status) }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(c.status), boxShadow: `0 0 9px ${sc(c.status)}` }} />{slabel(c.status)}</span>
                  <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 16, fontWeight: 600, color: GOLD }}>{fmtAMD(c.mrr)}</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{c.plan}</div>
                <div style={{ marginTop: 8 }}><Sparkline data={c.spark} color={sc(c.status)} w={208} h={26} /></div>
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
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sc(col), boxShadow: `0 0 10px ${sc(col)}` }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)' }}>{items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {items.map((c) => (
                      <div key={c.name} className="cell" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', padding: 12, cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                          <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 14, fontWeight: 600, color: GOLD }}>{fmtAMD(c.mrr)}</span>
                        </div>
                        <div style={{ marginTop: 5, fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{c.plan} · {c.city}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Pagination ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,.5)' }}>
          <span>Showing 1–{rows.length} of 142</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="chip" style={{ padding: '6px 10px' }}><ChevronLeft size={14} /></button>
            <button className="chip on" style={{ padding: '6px 12px' }}>1</button>
            <button className="chip" style={{ padding: '6px 12px' }}>2</button>
            <button className="chip" style={{ padding: '6px 12px' }}>…</button>
            <button className="chip" style={{ padding: '6px 12px' }}>18</button>
            <button className="chip" style={{ padding: '6px 10px' }}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* ── Bulk bar — appears when cells are selected ────────────── */}
      {sel.size > 0 && (
        <div className="gl idx-in" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 50, boxShadow: '0 18px 50px rgba(5,4,20,.6)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}><span style={{ color: GOLD }}>{sel.size}</span> selected</span>
          <span style={{ width: 1, height: 22, background: 'rgba(255,255,255,.16)' }} />
          {[{ i: MessageSquare, l: 'Message' }, { i: Pause, l: 'Suspend' }, { i: Download, l: 'Export' }].map((a) => (
            <button key={a.l} className="vbtn" style={{ color: 'rgba(255,255,255,.85)' }}><a.i size={14} />{a.l}</button>
          ))}
          <button className="vbtn" onClick={() => setSel(new Set())} style={{ color: 'rgba(255,255,255,.55)' }}><X size={14} />Clear</button>
        </div>
      )}
    </div>
  )
}
