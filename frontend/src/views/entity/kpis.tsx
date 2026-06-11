import type { ReactNode } from 'react'
import {
  UserIcon, PhoneIcon, MapIcon, GlobeIcon, BriefcaseIcon,
  BuildingIcon, PaperclipIcon, InfoIcon,
} from '../../components/icons'
import { Spark } from '../../components/charts/Spark'
import type { KPISpec } from '../../page-shell'
import type { Def, Row } from './types'
import { startOfWeekMonday, fmtDay } from './types'

// Icon for each form section header — keyword-matched with a sensible fallback.
export function sectionIcon(section: string): ReactNode {
  const s = section.toLowerCase()
  if (s.includes('identity') || s.includes('type') || s.includes('personal')) return <UserIcon size={14} aria-hidden />
  if (s.includes('contact')) return <PhoneIcon size={14} aria-hidden />
  if (s.includes('address')) return <MapIcon size={14} aria-hidden />
  if (s.includes('service') || s.includes('interest')) return <GlobeIcon size={14} aria-hidden />
  if (s.includes('sales')) return <BriefcaseIcon size={14} aria-hidden />
  if (s.includes('company') || s.includes('business')) return <BuildingIcon size={14} aria-hidden />
  if (s.includes('note') || s.includes('attach') || s.includes('document')) return <PaperclipIcon size={14} aria-hidden />
  return <InfoIcon size={14} aria-hidden />
}

// Generic KPI bar: total count + first 3 status counts.
export function deriveEntityKPIs(def: Def, rows: Row[], total: number | null): KPISpec[] {
  const count = total ?? rows.length
  const kpis: KPISpec[] = [
    { label: 'Total', value: count },
  ]
  const statuses = def.statuses ?? []
  if (statuses.length > 0) {
    const shown = statuses.slice(0, 3)
    for (const s of shown) {
      const c = rows.filter((r) => r.status === s.key).length
      kpis.push({ label: s.label, value: c, muted: c === 0 })
    }
  }
  return kpis
}

// Leads cockpit KPIs — New · Qualified · Contract Signed · Total, reset each Monday.
export function deriveLeadsWeeklyKPIs(rows: Row[]): KPISpec[] {
  const monday = startOfWeekMonday()
  const weekStart = monday.getTime()
  const prevStart = weekStart - 7 * 86_400_000
  const weekEnd = new Date(monday)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const at = (r: Row) => Date.parse((r as { created_at?: string }).created_at ?? '')
  const thisWk = rows.filter((r) => { const t = at(r); return !Number.isNaN(t) && t >= weekStart })
  const lastWk = rows.filter((r) => { const t = at(r); return !Number.isNaN(t) && t >= prevStart && t < weekStart })
  const cnt = (set: Row[], s: string) => set.filter((r) => r.status === s).length

  const wow = (now: number, prev: number): Partial<KPISpec> => {
    if (prev === 0) return now > 0 ? { delta: `+${now}`, deltaPositive: true, deltaBase: 'WoW' } : {}
    const pct = Math.round(((now - prev) / prev) * 100)
    return { delta: `${pct >= 0 ? '+' : ''}${pct}%`, deltaPositive: pct >= 0, deltaBase: 'WoW' }
  }
  const total = thisWk.length
  const rate = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  // SST commercial stages — the legacy NEW/QUALIFIED/CONVERTED keys were deleted 2026-06-11.
  const newN = cnt(thisWk, 'lead')
  const qualN = cnt(thisWk, 'validated_lead')
  const signN = cnt(thisWk, 'contract_signed')

  const daySeries = (pred: (r: Row) => boolean): number[] => {
    const buckets = [0, 0, 0, 0, 0, 0, 0]
    rows.forEach((r) => {
      const t = at(r)
      if (Number.isNaN(t) || t < weekStart) return
      const idx = Math.floor((t - weekStart) / 86_400_000)
      if (idx >= 0 && idx < 7 && pred(r)) buckets[idx] += 1
    })
    return buckets
  }

  return [
    { label: 'New', value: newN, ...wow(newN, cnt(lastWk, 'lead')),
      chart: <Spark values={daySeries((r) => r.status === 'lead')} color="var(--gx-primary)" height={18} strokeWidth={1} /> },
    { label: 'Qualified', value: qualN, ...wow(qualN, cnt(lastWk, 'validated_lead')),
      progress: rate(qualN), progressVariant: 'gold', progressLabel: `${rate(qualN)}%` },
    { label: 'Contract Signed', value: signN, ...wow(signN, cnt(lastWk, 'contract_signed')),
      progress: rate(signN), progressVariant: 'success', progressLabel: `${rate(signN)}%` },
    { label: 'Total', value: total, ...wow(total, lastWk.length),
      cornerNote: `${fmtDay(monday)} – ${fmtDay(weekEnd)}`,
      chart: <Spark values={daySeries(() => true)} color="var(--gx-interactive)" height={18} strokeWidth={1} /> },
  ]
}
