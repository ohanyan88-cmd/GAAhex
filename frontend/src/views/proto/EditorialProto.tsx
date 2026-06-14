// VIBE 3 — "Editorial Stage": spacious, premium, big type, a hero spotlight + asymmetric cards.
// Lives via typography, whitespace, and gold accents rather than dense motion.
import { Plus, ArrowUpRight, Sparkles } from 'lucide-react'
import { Button } from '../../primitives/Button'
import { ProtoStyles, Sparkline, Counter, CUSTOMERS, fmtAMD, statusColor, card } from './_shared'

export default function EditorialProto() {
  const top = [...CUSTOMERS].sort((a, b) => b.mrr - a.mrr).slice(0, 5)
  return (
    <div style={{ background: 'var(--gx-bg)', minHeight: '100%', padding: 'var(--gx-space-12) var(--gx-space-12)' }}>
      <ProtoStyles />
      <div className="proto-fade" style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-12)' }}>

        {/* Masthead */}
        <div>
          <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>CRM · Customers</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--gx-space-7)', marginTop: 'var(--gx-space-5)' }}>
            <div>
              <h1 style={{ margin: 0, fontFamily: 'var(--gx-font-display)', fontSize: 44, fontWeight: 600, letterSpacing: '-.03em', color: 'var(--gx-text-1)', lineHeight: 1.05 }}>Customers</h1>
              <p style={{ margin: '10px 0 0', fontSize: 'var(--gx-text-lg)', color: 'var(--gx-text-2)' }}>
                <b style={{ color: 'var(--gx-text-1)' }}>142</b> active. <span style={{ color: 'var(--gx-gold)' }}>7 need you today.</span>
              </p>
            </div>
            <Button variant="gold" size="lg" leftIcon={Plus}>New customer</Button>
          </div>
        </div>

        {/* Hero spotlight */}
        <div className="proto-card" style={{
          ...card, borderColor: 'var(--gx-gold)', borderRadius: 'var(--gx-radius-xl)',
          background: 'linear-gradient(135deg, var(--gx-gold-soft), transparent 60%)',
          padding: 'var(--gx-space-12)', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 'var(--gx-space-12)', alignItems: 'center',
        }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--gx-gold)' }}>
              <Sparkles size={14} /> This month
            </div>
            <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 56, fontWeight: 600, letterSpacing: '-.03em', color: 'var(--gx-text-1)', lineHeight: 1, marginTop: 'var(--gx-space-5)' }}>
              <Counter value={3.2} prefix="֏" suffix="M" decimals={1} dur={1100} />
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 'var(--gx-text-lg)', color: 'var(--gx-text-2)', maxWidth: 420, lineHeight: 1.5 }}>
              Recurring revenue, up <span style={{ color: 'var(--gx-success-fg)' }}>4% MoM</span>. 18 new customers, 2 enterprise upgrades. Strongest month this quarter.
            </p>
          </div>
          <div style={{ marginRight: -8 }}>
            <Sparkline data={[2.4, 2.5, 2.6, 2.7, 2.7, 2.9, 3.0, 3.1, 3.2]} color="var(--gx-gold)" w={360} h={120} strokeW={2.2} />
          </div>
        </div>

        {/* Calm KPI band */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--gx-space-9)' }}>
          {[
            { l: 'ARPU', v: 22400, p: '֏', up: true, d: '3%' },
            { l: 'New this month', v: 18, up: true, d: '6' },
            { l: 'Churn', v: 1.8, s: '%', dec: 1, up: false, d: '0.3%' },
            { l: 'NPS', v: 64, up: true, d: '5' },
          ].map((k) => (
            <div key={k.l} style={{ borderLeft: '2px solid var(--gx-border)', paddingLeft: 'var(--gx-space-6)' }}>
              <div style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--gx-text-3)' }}>{k.l}</div>
              <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-3xl)', fontWeight: 600, color: 'var(--gx-text-1)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                <Counter value={k.v} prefix={k.p ?? ''} suffix={k.s ?? ''} decimals={k.dec ?? 0} />
              </div>
              <div style={{ fontSize: 'var(--gx-text-11)', color: k.up ? 'var(--gx-success-fg)' : 'var(--gx-text-3)', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
                <ArrowUpRight size={12} />{k.d} vs last month
              </div>
            </div>
          ))}
        </div>

        {/* Asymmetric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--gx-space-9)', alignItems: 'start' }}>
          {/* Top accounts */}
          <div style={{ ...card, padding: 'var(--gx-space-9)' }}>
            <h3 style={{ margin: '0 0 var(--gx-space-7)', fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-lg)', fontWeight: 600, color: 'var(--gx-text-1)' }}>Top accounts</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-6)' }}>
              {top.map((c, i) => (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)' }}>
                  <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-lg)', fontWeight: 600, color: 'var(--gx-text-3)', width: 22 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--gx-text-13)', fontWeight: 500, color: 'var(--gx-text-1)' }}>{c.name}</span>
                    <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{c.plan} · {c.city}</span>
                  </span>
                  <Sparkline data={c.spark} color={statusColor(c.status)} w={80} h={22} fill={false} />
                  <span style={{ width: 64, textAlign: 'right', fontSize: 'var(--gx-text-13)', fontWeight: 600, color: 'var(--gx-text-1)', fontVariantNumeric: 'tabular-nums' }}>{fmtAMD(c.mrr)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Insight card */}
          <div style={{ ...card, padding: 'var(--gx-space-9)', background: 'var(--gx-surface-2)' }}>
            <div style={{ fontSize: 'var(--gx-text-11)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--gx-gold)' }}>Insight</div>
            <p style={{ margin: '12px 0 0', fontSize: 'var(--gx-text-lg)', color: 'var(--gx-text-1)', lineHeight: 1.5, fontFamily: 'var(--gx-font-display)', fontWeight: 500 }}>
              Enterprise accounts are <span style={{ color: 'var(--gx-gold)' }}>3.1×</span> stickier than home plans — and drive 71% of MRR.
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)', lineHeight: 1.6 }}>
              Tigran Auto is the one enterprise at risk this week. A save here protects ֏38k/mo.
            </p>
            <div style={{ marginTop: 'var(--gx-space-7)' }}>
              <Button variant="secondary">See the play →</Button>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
          VIBE 3 · Editorial Stage — premium &amp; spacious, lives via type + asymmetry
        </div>
      </div>
    </div>
  )
}
