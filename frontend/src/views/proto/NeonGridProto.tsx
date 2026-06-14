// VIBE 5 — "Neon Grid": pure-black cyber-NOC, electric neon, mono-terminal energy. A DELIBERATE
// break from the GAAhex "calm premium / serious bank" tone — loud, glowing, hacker-NOC. /proto only.
import { Plus, Search, Activity } from 'lucide-react'
import { Sparkline, Counter, CUSTOMERS, ACTIVITY, fmtAMD } from './_shared'

const LIME = '#B6FF1A', CYAN = '#00E5FF', MAG = '#FF2EC4', AMBER = '#FFB000', RED = '#FF4D5E'
const sc = (s: string) => s === 'active' ? LIME : s === 'degraded' ? AMBER : s === 'critical' ? RED : '#5A6B6B'
const kc: Record<string, string> = { success: LIME, info: CYAN, danger: RED, warning: AMBER }

export default function NeonGridProto() {
  return (
    <div className="neo-root" style={{ minHeight: '100%', padding: 'clamp(16px,3vw,36px)' }}>
      <style>{`
        .neo-root{
          background:
            linear-gradient(rgba(0,229,255,.05) 1px, transparent 1px) 0 0/100% 32px,
            linear-gradient(90deg, rgba(0,229,255,.05) 1px, transparent 1px) 0 0/32px 100%,
            #05060A;
          color:#CFE9E4; font-family:var(--gx-font-mono);
        }
        .neo-panel{background:rgba(8,12,16,.86);border:1px solid rgba(0,229,255,.22);border-radius:4px;
          box-shadow:0 0 0 1px rgba(0,229,255,.04), 0 8px 30px rgba(0,0,0,.6)}
        .neo-row{transition:background .15s ease, box-shadow .15s ease, border-color .15s ease;border-left:2px solid transparent}
        .neo-row:hover{background:rgba(0,229,255,.05);border-left-color:${LIME};box-shadow:inset 0 0 24px rgba(182,255,26,.06)}
        .neo-btn{background:transparent;color:${LIME};border:1px solid ${LIME};border-radius:3px;padding:9px 16px;
          font:600 12px var(--gx-font-mono);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
          display:inline-flex;align-items:center;gap:7px;box-shadow:0 0 14px rgba(182,255,26,.25);transition:all .15s ease}
        .neo-btn:hover{background:${LIME};color:#05060A;box-shadow:0 0 22px rgba(182,255,26,.6)}
        .neo-inp{background:rgba(0,0,0,.5);border:1px solid rgba(0,229,255,.25);border-radius:3px;height:38px;
          padding:0 10px 0 32px;color:${CYAN};font:13px var(--gx-font-mono);width:190px}
        .neo-inp::placeholder{color:rgba(0,229,255,.4)}
        @keyframes neo-blink{0%,100%{opacity:1}50%{opacity:.25}}
        .neo-blink{animation:neo-blink 1.1s steps(2) infinite}
        .neo-glow{text-shadow:0 0 12px currentColor}
        @keyframes neo-scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
      `}</style>

      <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header */}
        <div className="neo-panel" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: CYAN, fontSize: 18 }} className="neo-glow">◤</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: '.2em', color: 'rgba(0,229,255,.55)' }}>NOC // CRM // CUSTOMERS</div>
            <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '.02em' }}>CUSTOMERS</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: LIME, fontSize: 12 }} className="neo-glow">
            <span className="neo-blink" style={{ width: 8, height: 8, borderRadius: '50%', background: LIME, boxShadow: `0 0 10px ${LIME}` }} /> ONLINE · 142
          </span>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: CYAN }} />
            <input className="neo-inp" placeholder="grep…" />
          </div>
          <button className="neo-btn"><Plus size={13} />New</button>
        </div>

        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {[
            { l: 'ACTIVE', v: 142, c: LIME, s: [120, 128, 132, 136, 139, 142] },
            { l: 'MRR', v: 3.2, pre: '֏', suf: 'M', dec: 1, c: CYAN, s: [2.6, 2.8, 2.9, 3.0, 3.1, 3.2] },
            { l: 'AT_RISK', v: 7, c: RED, s: [3, 4, 5, 6, 6, 7] },
            { l: 'UPTIME', v: 99.8, suf: '%', dec: 1, c: MAG, s: [99, 99.3, 99.5, 99.6, 99.7, 99.8] },
          ].map((k) => (
            <div key={k.l} className="neo-panel" style={{ padding: 16, borderColor: `${k.c}55` }}>
              <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'rgba(207,233,228,.55)' }}>{k.l}</div>
              <div className="neo-glow" style={{ fontFamily: 'var(--gx-font-mono)', fontSize: 30, fontWeight: 600, color: k.c, marginTop: 4 }}>
                <Counter value={k.v} prefix={k.pre ?? ''} suffix={k.suf ?? ''} decimals={k.dec ?? 0} />
              </div>
              <div style={{ marginTop: 12 }}><Sparkline data={k.s} color={k.c} w={200} h={30} fill={false} strokeW={1.8} /></div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }}>
          {/* Data table */}
          <div className="neo-panel" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.2fr .8fr .9fr', padding: '11px 16px', fontSize: 10, letterSpacing: '.1em', color: 'rgba(0,229,255,.6)', borderBottom: '1px solid rgba(0,229,255,.18)' }}>
              <span>SUBSCRIBER</span><span>PLAN</span><span>STATE</span><span style={{ textAlign: 'right' }}>MRR</span>
            </div>
            {CUSTOMERS.map((c) => (
              <div key={c.name} className="neo-row" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.2fr .8fr .9fr', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(0,229,255,.08)', cursor: 'pointer' }}>
                <span style={{ fontSize: 13, color: '#fff' }}>{c.name}<span style={{ color: 'rgba(207,233,228,.4)', marginLeft: 8, fontSize: 11 }}>{c.city}</span></span>
                <span style={{ fontSize: 12, color: 'rgba(207,233,228,.7)' }}>{c.plan}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: sc(c.status) }} className="neo-glow"><span style={{ width: 6, height: 6, borderRadius: '50%', background: sc(c.status), boxShadow: `0 0 8px ${sc(c.status)}` }} />{c.status.toUpperCase()}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: '#fff' }}>{fmtAMD(c.mrr)}</span>
              </div>
            ))}
          </div>

          {/* Terminal log */}
          <div className="neo-panel" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: CYAN, fontSize: 11, letterSpacing: '.12em' }}>
              <Activity size={13} className="neo-blink" /> LIVE_FEED
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ACTIVITY.map((a, i) => (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: kc[a.kind] }}>&gt;</span>{' '}
                  <span style={{ color: '#fff' }}>{a.who}</span>{' '}
                  <span style={{ color: 'rgba(207,233,228,.7)' }}>{a.what}</span>
                  <span style={{ color: 'rgba(207,233,228,.35)', marginLeft: 6 }}>[{a.time}]</span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: LIME }} className="neo-glow">&gt; <span className="neo-blink">_</span></div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 10, letterSpacing: '.1em', color: 'rgba(0,229,255,.5)' }}>
          VIBE 5 · NEON GRID — cyber-NOC, electric &amp; glowing
        </div>
      </div>
    </div>
  )
}
