// Hub for the page-structure vibe prototypes. Open /proto, click into each.
import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ProtoStyles, card } from './_shared'

type V = { to: string; n: string; name: string; tag: string; desc: string; accent: string }

const ON_BRAND: V[] = [
  { to: '/proto/deck', n: '1', name: 'Command Deck', tag: 'Ops cockpit + live right-rail', desc: 'Operator lives in it — real-time activity rail, a spotlight for what needs you, adaptive stage.', accent: 'var(--gx-cobalt)' },
  { to: '/proto/momentum', n: '2', name: 'Momentum', tag: 'Motion everywhere · max energy', desc: 'Animated counters, sparklines on every card and row, a "moving now" ticker, hover-lift.', accent: 'var(--gx-gold)' },
  { to: '/proto/editorial', n: '3', name: 'Editorial Stage', tag: 'Premium · spacious · big type', desc: 'A hero spotlight, generous whitespace, asymmetric cards, gold accents. Calm and high-end.', accent: 'var(--gx-info)' },
]

const OFF_BRAND: V[] = [
  { to: '/proto/aurora', n: '4', name: 'Aurora Glass', tag: 'Glassmorphism · aurora · glow', desc: 'Frosted translucent panels, aurora gradient field, soft glow. Spatial, dreamy, premium-modern.', accent: '#A78BFA' },
  { to: '/proto/neon', n: '5', name: 'Neon Grid', tag: 'Cyber-NOC · electric · mono', desc: 'Pure-black grid, neon accents, a live terminal feed. Loud, glowing, hacker-NOC energy.', accent: '#B6FF1A' },
  { to: '/proto/brutalist', n: '6', name: 'Brutalist', tag: 'Paper · huge type · hard edges', desc: 'Light paper, oversized type, thick black borders + offset shadows, one hot accent. Fearless.', accent: '#FF4D00' },
]

function Grid({ items }: { items: V[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--gx-space-7)' }}>
      {items.map((v) => (
        <Link key={v.to} to={v.to} className="proto-card proto-plain" style={{ ...card, padding: 'var(--gx-space-9)', display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-5)', borderTop: `3px solid ${v.accent}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-3xl)', fontWeight: 600, color: 'var(--gx-text-3)' }}>{v.n}</span>
            <ArrowRight size={18} style={{ color: v.accent }} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-lg)', fontWeight: 600, color: 'var(--gx-text-1)' }}>{v.name}</div>
            <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-gold)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 3 }}>{v.tag}</div>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)', lineHeight: 1.55 }}>{v.desc}</p>
        </Link>
      ))}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 'var(--gx-text-11)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--gx-text-3)', margin: '0 0 var(--gx-space-6)' }}>{children}</div>
}

export default function ProtoHome() {
  return (
    <div style={{ background: 'var(--gx-bg)', minHeight: '100%', padding: 'var(--gx-space-12)' }}>
      <ProtoStyles />
      <div className="proto-fade" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-3xl)', fontWeight: 600, color: 'var(--gx-text-1)', margin: 0, letterSpacing: '-.02em' }}>
          Page structure — 6 vibes
        </h1>
        <p style={{ fontSize: 'var(--gx-text-lg)', color: 'var(--gx-text-2)', marginTop: 'var(--gx-space-5)', maxWidth: 640, lineHeight: 1.5 }}>
          Same <b style={{ color: 'var(--gx-text-1)' }}>Customers</b> content, six souls. Pick one — or mix the best of any.
        </p>

        <div style={{ ...card, padding: 'var(--gx-space-9)', marginTop: 'var(--gx-space-12)', borderTop: '3px solid var(--gx-gold)', background: 'linear-gradient(135deg, var(--gx-gold-soft), transparent 55%)' }}>
          <div style={{ fontSize: 'var(--gx-text-11)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--gx-gold)' }}>★ Archetype 1 — Index · full shell + left nav</div>
          <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-2xl)', fontWeight: 600, color: 'var(--gx-text-1)', marginTop: 4 }}>Same Index, two skins</div>
          <p style={{ margin: '6px 0 var(--gx-space-7)', fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)', maxWidth: 600, lineHeight: 1.5 }}>The complete page — left nav + topbar + content in one mood. Pulse header · vital-sign KPIs · gold focal node · view-switch (table / cards / board) · selection + bulk bar · pagination. Interactive.</p>
          <div style={{ display: 'flex', gap: 'var(--gx-space-6)', flexWrap: 'wrap' }}>
            <Link to="/proto/index-live" className="proto-plain proto-card" style={{ ...card, padding: 'var(--gx-space-6) var(--gx-space-7)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', borderColor: 'var(--gx-interactive)', background: 'linear-gradient(135deg, var(--gx-interactive-soft), transparent 60%)' }}>
              <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-lg)', fontWeight: 600, color: 'var(--gx-text-1)' }}>▶ Live — real Customers</span>
              <ArrowRight size={16} style={{ color: 'var(--gx-interactive)' }} />
            </Link>
            <Link to="/proto/index" className="proto-plain proto-card" style={{ ...card, padding: 'var(--gx-space-6) var(--gx-space-7)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', borderColor: '#A78BFA' }}>
              <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-lg)', fontWeight: 600, color: 'var(--gx-text-1)' }}>Aurora Glass</span>
              <ArrowRight size={16} style={{ color: '#A78BFA' }} />
            </Link>
            <Link to="/proto/index-brand-x" className="proto-plain proto-card" style={{ ...card, padding: 'var(--gx-space-6) var(--gx-space-7)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', borderColor: 'var(--gx-gold)', background: 'linear-gradient(135deg, var(--gx-gold-soft), transparent 60%)' }}>
              <span style={{ fontFamily: 'var(--gx-font-display)', fontSize: 'var(--gx-text-lg)', fontWeight: 600, color: 'var(--gx-text-1)' }}>★ Your brand — lit up</span>
              <ArrowRight size={16} style={{ color: 'var(--gx-gold)' }} />
            </Link>
            <Link to="/proto/index-brand" className="proto-plain proto-card" style={{ ...card, padding: 'var(--gx-space-6) var(--gx-space-7)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)' }}>
              <span style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>Plain brand (ref)</span>
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 'var(--gx-space-12)' }}>
          <SectionLabel>Vibe explorations — Round 1 (on your Cobalt &amp; Gold brand)</SectionLabel>
          <Grid items={ON_BRAND} />
        </div>

        <div style={{ marginTop: 'var(--gx-space-12)' }}>
          <SectionLabel>Round 2 — off-brand &amp; beast (deliberately not your system)</SectionLabel>
          <Grid items={OFF_BRAND} />
        </div>
      </div>
    </div>
  )
}
