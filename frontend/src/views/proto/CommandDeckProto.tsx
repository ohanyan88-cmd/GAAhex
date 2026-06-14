// VIBE 1 — "Command Deck": dense operational cockpit + a live right-rail that moves.
import { Users, Search, Plus, Zap, ArrowUpRight } from 'lucide-react'
import { Button } from '../../primitives/Button'
import { KPITile } from '../../primitives/KPITile'
import { StatusPill } from '../../primitives/StatusPill'
import { ProtoStyles, Sparkline, Counter, CUSTOMERS, ACTIVITY, fmtAMD, card } from './_shared'

const dotKind: Record<string, string> = {
  success: 'var(--gx-success)', info: 'var(--gx-info)', danger: 'var(--gx-danger)', warning: 'var(--gx-warning)',
}

export default function CommandDeckProto() {
  return (
    <div style={{ background: 'var(--gx-bg)', minHeight: '100%', padding: 'var(--gx-space-7)' }}>
      <ProtoStyles />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 'var(--gx-space-7)', alignItems: 'start' }}>

        {/* ── MAIN ───────────────────────────────────────────────── */}
        <div className="proto-fade" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-6)' }}>

          {/* Pulse Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--gx-space-5)' }}>
            <div style={{
              width: 44, height: 44, borderRadius: 'var(--gx-radius-md)', display: 'grid', placeItems: 'center',
              background: 'var(--gx-gold-soft)', color: 'var(--gx-gold)', border: '1px solid var(--gx-gold)', flexShrink: 0,
            }}>
              <Users size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', letterSpacing: '.04em' }}>CRM › Customers</div>
              <h1 style={{ margin: '2px 0 0', fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-2xl)', fontWeight: 600, color: 'var(--gx-text-1)' }}>Customers</h1>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)', fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)', flexWrap: 'wrap' }}>
                <span className="proto-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gx-success)' }} />
                <span><b style={{ color: 'var(--gx-text-1)' }}>142</b> active</span>
                <span style={{ color: 'var(--gx-text-3)' }}>·</span>
                <span style={{ color: 'var(--gx-danger-fg)' }}><b>7</b> at risk</span>
                <span style={{ color: 'var(--gx-text-3)' }}>·</span>
                <span><b style={{ color: 'var(--gx-text-1)' }}>֏3.2M</b> MRR</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--gx-success-fg)' }}><ArrowUpRight size={14} />4%</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--gx-space-4)', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gx-text-3)' }} />
                <input placeholder="Որոնել…" style={{
                  height: 36, paddingLeft: 32, paddingRight: 12, width: 200, fontSize: 'var(--gx-text-13)',
                  background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', color: 'var(--gx-text-1)',
                }} />
              </div>
              <Button variant="gold" leftIcon={Plus}>New customer</Button>
            </div>
          </div>

          {/* Vital Signs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--gx-space-5)' }}>
            <KPITile label="Active" value="142" delta="4%" deltaPositive chart={<Sparkline data={[120, 125, 128, 132, 136, 139, 142]} color="var(--gx-success)" />} />
            <KPITile label="At risk" value="7" warning delta="2" deltaPositive={false} chart={<Sparkline data={[3, 4, 4, 5, 6, 6, 7]} color="var(--gx-warning)" />} />
            <KPITile label="MRR" value="֏3.2M" delta="4%" deltaPositive chart={<Sparkline data={[2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2]} color="var(--gx-gold)" />} />
            <KPITile label="Churn" value="1.8%" muted delta="0.3%" deltaPositive={false} chart={<Sparkline data={[2.4, 2.3, 2.2, 2.1, 2.0, 1.9, 1.8]} color="var(--gx-info)" />} />
          </div>

          {/* Spotlight */}
          <div className="proto-card" style={{
            ...card, borderColor: 'var(--gx-gold)', background: 'linear-gradient(180deg, var(--gx-gold-soft), transparent)',
            padding: 'var(--gx-space-6) var(--gx-space-7)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-6)',
          }}>
            <div className="proto-breathe" style={{ width: 40, height: 40, borderRadius: 'var(--gx-radius-md)', display: 'grid', placeItems: 'center', background: 'var(--gx-gold)', color: 'var(--gx-bg)', flexShrink: 0 }}>
              <Zap size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--gx-text-11)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--gx-gold)' }}>Needs you now</div>
              <div style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-1)', marginTop: 3 }}>
                <b>Tigran Auto</b> — ֏38k overdue 9 days · optical Rx dropping (−27&nbsp;dBm). Suspend or call?
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--gx-space-4)' }}>
              <Button variant="gold">Open</Button>
              <Button variant="secondary">Snooze</Button>
            </div>
          </div>

          {/* The Stage — table */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.2fr .9fr .8fr .7fr', padding: 'var(--gx-space-5) var(--gx-space-7)', fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--gx-text-3)', borderBottom: '1px solid var(--gx-border)' }}>
              <span>Customer</span><span>Plan</span><span>Status</span><span style={{ textAlign: 'right' }}>MRR</span><span style={{ textAlign: 'right' }}>Last</span>
            </div>
            {CUSTOMERS.map((c) => (
              <div key={c.name} className="proto-lift" style={{
                display: 'grid', gridTemplateColumns: '1.6fr 1.2fr .9fr .8fr .7fr', alignItems: 'center',
                padding: 'var(--gx-space-5) var(--gx-space-7)', borderBottom: '1px solid var(--gx-border-subtle)', cursor: 'pointer',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)', minWidth: 0 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 'var(--gx-radius-sm)', background: 'var(--gx-surface-2)', color: 'var(--gx-text-2)', display: 'grid', placeItems: 'center', fontSize: 'var(--gx-text-11)', fontWeight: 700, flexShrink: 0 }}>{c.name.slice(0, 1)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                    <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{c.city}</span>
                  </span>
                </span>
                <span style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>{c.plan}</span>
                <span><StatusPill variant={c.status} size="sm" /></span>
                <span style={{ textAlign: 'right', fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-1)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtAMD(c.mrr)}</span>
                <span style={{ textAlign: 'right', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{c.last}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── LIVE RAIL ──────────────────────────────────────────── */}
        <aside className="proto-fade" style={{ ...card, padding: 'var(--gx-space-6)', position: 'sticky', top: 'var(--gx-space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)', marginBottom: 'var(--gx-space-6)' }}>
            <span className="proto-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gx-success)' }} />
            <span style={{ fontSize: 'var(--gx-text-11)', fontWeight: 700, letterSpacing: '.08em', color: 'var(--gx-text-1)' }}>LIVE</span>
            <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>· 3 online</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-5)' }}>
            {ACTIVITY.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--gx-space-4)', alignItems: 'flex-start' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotKind[a.kind], marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)', lineHeight: 1.4 }}>
                    <b style={{ color: 'var(--gx-text-1)' }}>{a.who}</b> {a.what}
                  </div>
                </div>
                <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', flexShrink: 0 }}>{a.time}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--gx-space-6)', paddingTop: 'var(--gx-space-5)', borderTop: '1px solid var(--gx-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex' }}>
              {['Ա', 'Գ', 'Լ'].map((x, i) => (
                <span key={i} style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--gx-cobalt)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, border: '2px solid var(--gx-surface)', marginLeft: i ? -8 : 0 }}>{x}</span>
              ))}
            </div>
            <Button variant="ghost" size="sm" leftIcon={Plus}>Note</Button>
          </div>
        </aside>
      </div>

      <div style={{ marginTop: 'var(--gx-space-7)', textAlign: 'center', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
        VIBE 1 · Command Deck — <Counter value={142} suffix=" active" /> · dense ops cockpit, lives via the right rail
      </div>
    </div>
  )
}
