// VIBE 2 — "Momentum": motion everywhere. Animated counters, sparklines, a live ticker,
// hover-lift rows. Maximum "full of life".
import { Users, Search, Plus, ArrowUpRight, ArrowDownRight, Activity } from 'lucide-react'
import { Button } from '../../primitives/Button'
import { ProtoStyles, Sparkline, Counter, CUSTOMERS, TICKER, statusColor, card } from './_shared'

type Metric = { label: string; value: number; prefix?: string; suffix?: string; decimals?: number; up: boolean; delta: string; spark: number[]; color: string }

const METRICS: Metric[] = [
  { label: 'Active customers', value: 142, up: true, delta: '4%', spark: [120, 125, 128, 132, 136, 139, 142], color: 'var(--gx-success)' },
  { label: 'MRR', value: 3.2, prefix: '֏', suffix: 'M', decimals: 1, up: true, delta: '4%', spark: [2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2], color: 'var(--gx-gold)' },
  { label: 'At risk', value: 7, up: false, delta: '2', spark: [3, 4, 4, 5, 6, 6, 7], color: 'var(--gx-danger)' },
  { label: 'Uptime', value: 99.8, suffix: '%', decimals: 1, up: true, delta: '0.2%', spark: [98.9, 99.1, 99.2, 99.5, 99.6, 99.7, 99.8], color: 'var(--gx-info)' },
]

export default function MomentumProto() {
  return (
    <div style={{ background: 'var(--gx-bg)', minHeight: '100%', padding: 'var(--gx-space-7)' }}>
      <ProtoStyles />
      <div className="proto-fade" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-6)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 'var(--gx-radius-md)', display: 'grid', placeItems: 'center', background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', color: 'var(--gx-gold)' }}>
            <Users size={19} />
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-2xl)', fontWeight: 600, color: 'var(--gx-text-1)' }}>Customers</h1>
          <span style={{ color: 'var(--gx-success)', display: 'inline-flex', alignItems: 'center' }}><Sparkline data={[3, 5, 4, 7, 6, 9, 8, 11]} color="var(--gx-success)" w={56} h={18} fill={false} /></span>
          <span style={{ flex: 1 }} />
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gx-text-3)' }} />
            <input placeholder="Որոնել…" style={{ height: 36, paddingLeft: 32, paddingRight: 12, width: 190, fontSize: 'var(--gx-text-13)', background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', color: 'var(--gx-text-1)' }} />
          </div>
          <Button variant="gold" leftIcon={Plus}>New customer</Button>
        </div>

        {/* Animated metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--gx-space-5)' }}>
          {METRICS.map((m) => (
            <div key={m.label} className="proto-card" style={{ ...card, padding: 'var(--gx-space-6)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--gx-text-3)' }}>{m.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--gx-space-3)', marginTop: 6 }}>
                <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-3xl)', fontWeight: 600, color: 'var(--gx-text-1)', fontVariantNumeric: 'tabular-nums' }}>
                  <Counter value={m.value} prefix={m.prefix} suffix={m.suffix} decimals={m.decimals ?? 0} />
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 'var(--gx-text-11)', fontWeight: 600, color: m.up ? 'var(--gx-success-fg)' : 'var(--gx-danger-fg)' }}>
                  {m.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{m.delta}
                </span>
              </div>
              <div style={{ marginTop: 'var(--gx-space-5)', marginLeft: -2, marginRight: -2 }}>
                <Sparkline data={m.spark} color={m.color} w={220} h={34} />
              </div>
            </div>
          ))}
        </div>

        {/* Live ticker */}
        <div style={{ ...card, padding: 'var(--gx-space-4) var(--gx-space-6)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-6)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--gx-gold)', flexShrink: 0 }}>
            <Activity size={14} className="proto-breathe" /> Moving now
          </span>
          <div className="proto-tickwrap" style={{ flex: 1 }}>
            <div className="proto-ticktrack">
              {[...TICKER, ...TICKER].map((t, i) => (
                <span key={i} style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>
                  <span style={{ color: 'var(--gx-gold)', marginRight: 8 }}>•</span>{t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Momentum rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
          {CUSTOMERS.map((c) => (
            <div key={c.name} className="proto-lift" style={{
              ...card, display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr .8fr', alignItems: 'center',
              padding: 'var(--gx-space-5) var(--gx-space-7)', cursor: 'pointer',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)', minWidth: 0 }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--gx-surface-2)', color: 'var(--gx-text-2)', display: 'grid', placeItems: 'center', fontSize: 'var(--gx-text-11)', fontWeight: 700, flexShrink: 0 }}>{c.name.slice(0, 1)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{c.plan} · {c.city}</span>
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(c.status) }} />
                <span style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>{c.status === 'active' ? 'Active' : c.status === 'degraded' ? 'Degraded' : c.status === 'critical' ? 'Critical' : 'Idle'}</span>
              </span>
              <span><Sparkline data={c.spark} color={statusColor(c.status)} w={120} h={26} /></span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-lg)', fontWeight: 600, color: 'var(--gx-text-1)', fontVariantNumeric: 'tabular-nums' }}>
                <Counter value={c.mrr} prefix="֏" />
              </span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginTop: 'var(--gx-space-3)' }}>
          VIBE 2 · Momentum — max energy, lives via constant motion + sparklines
        </div>
      </div>
    </div>
  )
}
