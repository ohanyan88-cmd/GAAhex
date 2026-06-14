// Shared mock data + motion helpers for the page-structure prototypes (Gev 2026-06-13).
// Brand-token only. These are throwaway demos to pick a page-structure vibe — not production.
import { useEffect, useState, type CSSProperties } from 'react'

export type Cust = {
  name: string
  org?: boolean
  plan: string
  status: 'active' | 'degraded' | 'critical' | 'neutral'
  mrr: number
  city: string
  spark: number[]
  last: string
}

export const CUSTOMERS: Cust[] = [
  { name: 'Davit Group',          org: true,  plan: 'Enterprise 2Gbps', status: 'active',   mrr: 210000, city: 'Երևան',   spark: [28, 30, 29, 31, 33, 34, 36], last: '2 ր' },
  { name: 'Tumo Center',          org: true,  plan: 'Enterprise 1Gbps', status: 'active',   mrr: 148000, city: 'Երևան',   spark: [12, 14, 13, 16, 18, 17, 19], last: '6 ր' },
  { name: 'Erebuni IT Solutions', org: true,  plan: 'Business 500Mbps', status: 'degraded', mrr: 64000,  city: 'Երևան',   spark: [20, 19, 18, 16, 15, 14, 13], last: '24 ր' },
  { name: 'Tigran Auto',          org: true,  plan: 'Business 300Mbps', status: 'critical', mrr: 38000,  city: 'Աբովյան',  spark: [18, 16, 12, 9, 7, 5, 4],     last: '1 ժ' },
  { name: 'Հակոբյան Արամ',                    plan: 'Home 300Mbps',     status: 'active',   mrr: 12000,  city: 'Գյումրի',  spark: [8, 9, 9, 10, 11, 12, 12],    last: '1 ժ' },
  { name: 'Ավագյան Նարեկ',                    plan: 'Home 300Mbps',     status: 'active',   mrr: 12000,  city: 'Երևան',   spark: [10, 11, 11, 12, 12, 13, 13], last: '2 ժ' },
  { name: 'Սարգսյան Լիլիթ',                   plan: 'Home 100Mbps',     status: 'active',   mrr: 8000,   city: 'Վանաձոր',  spark: [5, 6, 6, 7, 7, 8, 8],        last: '3 ժ' },
  { name: 'Մարտիրոսյան Գոռ',                  plan: 'Home 100Mbps',     status: 'neutral',  mrr: 8000,   city: 'Արմավիր',  spark: [8, 8, 7, 7, 6, 6, 6],        last: '4 ժ' },
]

export const ACTIVITY: { who: string; what: string; kind: 'success' | 'info' | 'danger' | 'warning'; time: string }[] = [
  { who: 'Հակոբյան Արամ', what: 'վճարեց ֏12,000', kind: 'success', time: '2ր' },
  { who: 'Սարգսյան Լիլիթ', what: 'միացավ — online', kind: 'info', time: '6ր' },
  { who: 'Ticket #1042', what: 'escalated → NOC', kind: 'danger', time: '12ր' },
  { who: 'Tigran Auto', what: 'optical Rx ↓ −27dBm', kind: 'warning', time: '18ր' },
  { who: 'Նոր lead', what: 'Aren Tech · 500Mbps', kind: 'info', time: '24ր' },
  { who: 'Davit Group', what: 'upgrade → 2Gbps', kind: 'success', time: '40ր' },
]

export const TICKER: string[] = [
  'Արամ վճարեց ֏12k', 'Լիլիթ online', '#1042 escalated', 'Tigran Auto Rx ↓',
  'Նոր lead՝ Aren Tech', 'Davit Group → 2Gbps', '18 նոր այս ամիս', 'Churn 1.8% ▼',
]

export function fmtAMD(n: number): string {
  if (n >= 1_000_000) return '֏' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '֏' + Math.round(n / 1000) + 'k'
  return '֏' + n
}

export function statusColor(s: Cust['status']): string {
  return s === 'active' ? 'var(--gx-success)'
    : s === 'degraded' ? 'var(--gx-warning)'
    : s === 'critical' ? 'var(--gx-danger)'
    : 'var(--gx-text-3)'
}

/** Inline-SVG sparkline. Colour comes from a brand token passed by the caller. */
export function Sparkline({ data, color = 'var(--gx-info)', w = 72, h = 22, fill = true, strokeW = 1.6 }: {
  data: number[]; color?: string; w?: number; h?: number; fill?: boolean; strokeW?: number
}) {
  const max = Math.max(...data), min = Math.min(...data), span = (max - min) || 1
  const pts = data
    .map((d, i) => `${(i / (data.length - 1)) * w},${h - ((d - min) / span) * (h - 4) - 2}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden style={{ display: 'block' }}>
      {fill && <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity={0.13} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Number that rolls up from 0 → value on mount (eased). */
export function Counter({ value, prefix = '', suffix = '', decimals = 0, dur = 950 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number; dur?: number
}) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * p)
      setN(value * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, dur])
  return <>{prefix}{n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}{suffix}</>
}

export const card: CSSProperties = {
  background: 'var(--gx-surface)',
  border: '1px solid var(--gx-border)',
  borderRadius: 'var(--gx-radius-lg)',
}

/** Keyframes + a few hover/motion helper classes, injected once per page. */
export function ProtoStyles() {
  return (
    <style>{`
      @keyframes proto-pulse  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.78)} }
      @keyframes proto-breathe{ 0%,100%{opacity:.5} 50%{opacity:1} }
      @keyframes proto-rise   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
      @keyframes proto-ticker { from{transform:translateX(0)} to{transform:translateX(-50%)} }
      .proto-lift{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background .18s ease}
      .proto-lift:hover{transform:translateY(-2px);box-shadow:var(--gx-shadow-md);border-color:var(--gx-gold)!important;background:var(--gx-surface-2)}
      .proto-card{transition:transform .2s ease,box-shadow .2s ease}
      .proto-card:hover{transform:translateY(-3px);box-shadow:var(--gx-shadow-lg)}
      .proto-dot{animation:proto-pulse 1.6s ease-in-out infinite}
      .proto-breathe{animation:proto-breathe 2.6s ease-in-out infinite}
      .proto-fade{animation:proto-rise .5s ease both}
      .proto-tickwrap{overflow:hidden;position:relative;mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
      .proto-ticktrack{display:inline-flex;gap:36px;white-space:nowrap;animation:proto-ticker 26s linear infinite;will-change:transform}
      a.proto-plain{text-decoration:none;color:inherit}
    `}</style>
  )
}
