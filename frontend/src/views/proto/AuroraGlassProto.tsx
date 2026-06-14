// VIBE 4 — "Aurora Glass": glassmorphism + aurora gradients + glow. A DELIBERATE break from the
// GAAhex "layered, not glassy / no decorative gradients" rule — sandboxed under /proto.
import { Plus, Search, Sparkles, ArrowUpRight } from 'lucide-react'
import { Sparkline, Counter, CUSTOMERS, fmtAMD } from './_shared'

const sc = (s: string) => s === 'active' ? '#34D399' : s === 'degraded' ? '#FBBF77' : s === 'critical' ? '#FB7185' : 'rgba(255,255,255,.5)'

export default function AuroraGlassProto() {
  return (
    <div className="aur-root" style={{ minHeight: '100%', position: 'relative', overflow: 'hidden', padding: 'clamp(20px,4vw,48px)' }}>
      <style>{`
        .aur-root{
          background:
            radial-gradient(60% 50% at 12% 8%, rgba(167,139,250,.35), transparent 60%),
            radial-gradient(50% 45% at 92% 18%, rgba(45,212,191,.28), transparent 60%),
            radial-gradient(55% 55% at 78% 96%, rgba(244,114,182,.26), transparent 60%),
            #0B0A1F;
          color:#fff; font-family:var(--gx-font-sans);
        }
        .aur-glass{
          background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14);
          border-radius:22px; backdrop-filter:blur(22px) saturate(140%); -webkit-backdrop-filter:blur(22px) saturate(140%);
          box-shadow:0 12px 40px rgba(5,4,20,.45), inset 0 1px 0 rgba(255,255,255,.12);
        }
        .aur-row{transition:background .2s ease, transform .2s ease, box-shadow .2s ease;border-radius:16px}
        .aur-row:hover{background:rgba(255,255,255,.08);transform:translateY(-2px);box-shadow:0 10px 30px rgba(167,139,250,.18)}
        .aur-btn{background:linear-gradient(135deg,#A78BFA,#7C6FF0);color:#fff;border:none;border-radius:14px;
          padding:10px 18px;font:600 13px var(--gx-font-sans);display:inline-flex;align-items:center;gap:8px;cursor:pointer;
          box-shadow:0 8px 24px rgba(124,111,240,.45);transition:transform .15s ease}
        .aur-btn:hover{transform:translateY(-1px)}
        .aur-inp{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:14px;height:40px;
          padding:0 12px 0 34px;color:#fff;font-size:13px;width:200px}
        .aur-inp::placeholder{color:rgba(255,255,255,.5)}
        @keyframes aur-float{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}
        .aur-dot{animation:aur-float 1.8s ease-in-out infinite}
        @keyframes aur-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        .aur-in{animation:aur-in .55s cubic-bezier(.2,0,0,1) both}
      `}</style>

      <div className="aur-in" style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Header */}
        <div className="aur-glass" style={{ padding: '20px 26px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#A78BFA,#2DD4BF)', boxShadow: '0 8px 24px rgba(167,139,250,.5)' }}>
            <Sparkles size={22} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)' }}>CRM · Customers</div>
            <h1 style={{ margin: '2px 0 0', fontFamily: 'var(--gx-font-display)', fontSize: 28, fontWeight: 600, color: '#fff' }}>Customers</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,.5)' }} />
              <input className="aur-inp" placeholder="Որոնել…" />
            </div>
            <button className="aur-btn"><Plus size={15} />New customer</button>
          </div>
        </div>

        {/* KPI glass cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18 }}>
          {[
            { l: 'Active', v: 142, c: '#34D399', s: [120, 128, 132, 136, 139, 142] },
            { l: 'MRR', v: 3.2, pre: '֏', suf: 'M', dec: 1, c: '#A78BFA', s: [2.6, 2.8, 2.9, 3.0, 3.1, 3.2] },
            { l: 'At risk', v: 7, c: '#FB7185', s: [3, 4, 5, 6, 6, 7] },
            { l: 'Uptime', v: 99.8, suf: '%', dec: 1, c: '#2DD4BF', s: [99, 99.3, 99.5, 99.6, 99.7, 99.8] },
          ].map((k) => (
            <div key={k.l} className="aur-glass" style={{ padding: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgba(255,255,255,.6)' }}>{k.l}</div>
              <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 32, fontWeight: 600, marginTop: 6 }}>
                <Counter value={k.v} prefix={k.pre ?? ''} suffix={k.suf ?? ''} decimals={k.dec ?? 0} />
              </div>
              <div style={{ marginTop: 14 }}><Sparkline data={k.s} color={k.c} w={210} h={32} /></div>
            </div>
          ))}
        </div>

        {/* Spotlight */}
        <div className="aur-glass" style={{ padding: '20px 26px', display: 'flex', alignItems: 'center', gap: 20, borderColor: 'rgba(251,113,133,.4)' }}>
          <div className="aur-dot" style={{ width: 12, height: 12, borderRadius: '50%', background: '#FB7185', boxShadow: '0 0 16px #FB7185' }} />
          <div style={{ flex: 1, fontSize: 14 }}>
            <b>Tigran Auto</b> needs you — ֏38k overdue 9 days · optical Rx dropping.
          </div>
          <button className="aur-btn" style={{ background: 'linear-gradient(135deg,#FB7185,#F472B6)', boxShadow: '0 8px 24px rgba(244,114,182,.45)' }}>Open case</button>
        </div>

        {/* Glass list */}
        <div className="aur-glass" style={{ padding: 14 }}>
          {CUSTOMERS.map((c) => (
            <div key={c.name} className="aur-row" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.1fr .8fr .8fr .8fr', alignItems: 'center', padding: '12px 16px', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>{c.name.slice(0, 1)}</span>
                <span><span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{c.name}</span><span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>{c.city}</span></span>
              </span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.72)' }}>{c.plan}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(255,255,255,.7)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(c.status), boxShadow: `0 0 10px ${sc(c.status)}` }} />{c.status}</span>
              <span><Sparkline data={c.spark} color={sc(c.status)} w={90} h={22} fill={false} /></span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--gx-font-display)', fontSize: 16, fontWeight: 600 }}>{fmtAMD(c.mrr)}</span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.45)', display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowUpRight size={13} /> VIBE 4 · Aurora Glass — glass + aurora + glow
        </div>
      </div>
    </div>
  )
}
