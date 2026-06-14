// VIBE 6 — "Brutalist": paper-light, oversized type, hard 3px black borders + offset solid shadows,
// one hot accent. A DELIBERATE break from the GAAhex dark-first / hairline-border / restrained look.
// Sandboxed under /proto.
import { Plus, ArrowUpRight } from 'lucide-react'
import { Sparkline, Counter, CUSTOMERS, TICKER, fmtAMD } from './_shared'

const INK = '#141210', PAPER = '#F2EEE3', HOT = '#FF4D00', ACID = '#1A56FF'
const sc = (s: string) => s === 'active' ? '#108A4A' : s === 'degraded' ? '#B5650A' : s === 'critical' ? '#D32F2F' : '#6B675E'

export default function BrutalistProto() {
  return (
    <div className="brut-root" style={{ minHeight: '100%', padding: 'clamp(20px,4vw,52px)' }}>
      <style>{`
        .brut-root{background:${PAPER};color:${INK};font-family:var(--gx-font-sans)}
        .brut-box{background:#fff;border:3px solid ${INK};border-radius:0;box-shadow:6px 6px 0 ${INK}}
        .brut-row{border:3px solid ${INK};background:#fff;transition:transform .12s ease, box-shadow .12s ease}
        .brut-row:hover{transform:translate(-3px,-3px);box-shadow:6px 6px 0 ${HOT}}
        .brut-btn{background:${HOT};color:#fff;border:3px solid ${INK};border-radius:0;padding:11px 20px;
          font:700 14px var(--gx-font-display);cursor:pointer;box-shadow:4px 4px 0 ${INK};display:inline-flex;align-items:center;gap:8px;
          transition:transform .1s ease, box-shadow .1s ease}
        .brut-btn:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 ${INK}}
        @keyframes brut-marq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        .brut-marq{display:inline-flex;gap:40px;white-space:nowrap;animation:brut-marq 24s linear infinite}
      `}</style>

      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Masthead */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: HOT }}>CRM / CUSTOMERS</div>
            <h1 style={{ margin: '4px 0 0', fontFamily: 'var(--gx-font-display)', fontSize: 'clamp(48px,8vw,86px)', fontWeight: 700, letterSpacing: '-.04em', lineHeight: .92, color: INK }}>CUSTOMERS</h1>
          </div>
          <button className="brut-btn"><Plus size={16} />NEW CUSTOMER</button>
        </div>

        {/* Marquee ticker */}
        <div style={{ background: INK, color: PAPER, padding: '10px 0', overflow: 'hidden', border: `3px solid ${INK}` }}>
          <div className="brut-marq" style={{ fontFamily: 'var(--gx-font-mono)', fontSize: 13, fontWeight: 600, letterSpacing: '.04em' }}>
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i}><span style={{ color: HOT }}>★</span> {t.toUpperCase()}</span>
            ))}
          </div>
        </div>

        {/* Hero number block */}
        <div className="brut-box" style={{ padding: 'clamp(24px,4vw,44px)', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 32, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: INK, opacity: .6 }}>MRR · this month</div>
            <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'clamp(56px,9vw,96px)', fontWeight: 700, letterSpacing: '-.04em', lineHeight: .9, color: INK }}>
              <Counter value={3.2} prefix="֏" suffix="M" decimals={1} dur={1100} />
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, background: '#108A4A', color: '#fff', padding: '4px 10px', fontWeight: 700, fontSize: 13 }}>
              <ArrowUpRight size={15} /> +4% MoM
            </div>
          </div>
          <div><Sparkline data={[2.4, 2.5, 2.6, 2.7, 2.7, 2.9, 3.0, 3.1, 3.2]} color={HOT} w={360} h={130} strokeW={3} fill={false} /></div>
        </div>

        {/* KPI blocks */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18 }}>
          {[
            { l: 'ACTIVE', v: 142, d: '+4%', acc: INK },
            { l: 'AT RISK', v: 7, d: '+2', acc: HOT },
            { l: 'NEW', v: 18, d: '+6', acc: ACID },
            { l: 'CHURN %', v: 1.8, dec: 1, d: '−0.3', acc: INK },
          ].map((k) => (
            <div key={k.l} className="brut-box" style={{ padding: 20, boxShadow: `6px 6px 0 ${k.acc}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em' }}>{k.l}</div>
              <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1, marginTop: 8 }}>
                <Counter value={k.v} decimals={k.dec ?? 0} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: k.acc, marginTop: 6 }}>{k.d}</div>
            </div>
          ))}
        </div>

        {/* Brutalist rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {CUSTOMERS.map((c) => (
            <div key={c.name} className="brut-row" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.1fr .8fr 1fr', alignItems: 'center', padding: '16px 22px', cursor: 'pointer' }}>
              <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.01em' }}>{c.name}<span style={{ fontFamily: 'var(--gx-font-sans)', fontSize: 12, fontWeight: 500, marginLeft: 10, opacity: .55 }}>{c.city}</span></span>
              <span style={{ fontFamily: 'var(--gx-font-mono)', fontSize: 13, fontWeight: 600 }}>{c.plan}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: sc(c.status) }}><span style={{ width: 10, height: 10, background: sc(c.status), border: `2px solid ${INK}` }} />{c.status}</span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--gx-font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}>{fmtAMD(c.mrr)}</span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: INK, opacity: .55 }}>
          VIBE 6 · BRUTALIST — paper, huge type, hard edges
        </div>
      </div>
    </div>
  )
}
