// NetworkInventoryView — shared UI primitives (tab, toolbar, field, load shell wrapper).
import { DetailTab, LoadShell as _CanonicalLoadShell } from '../../primitives'
import type { LoadState } from '../../primitives'
import { PackageIcon } from '../../components/icons'

// TB-1 — local NiTab delegates to the canonical `DetailTab` primitive.
export function NiTab({ active, onClick, icon, label, sub }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub: string
}) {
  return (
    <DetailTab active={active} onSelect={onClick} icon={icon} subtitle={sub}>
      {label}
    </DetailTab>
  )
}

// Filter select chrome — matches the FilterSelect pattern from RevenueAssuranceView.
export function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
      <span>{label}</span>
      <select
        className="inp inp-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 'var(--gx-text-sm)' }}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

// Common toolbar row above each tab's table — filters / search / refresh / primary.
export function TabToolbar({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-4)', alignItems: 'center',
      marginBottom: 'var(--gx-space-5)',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-3)', alignItems: 'center' }}>{left}</div>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  )
}

// T-P2-3 — `LoadShell` now lives in `primitives/LoadShell.tsx`. The local
// thin-shim below keeps the NOC-specific unavailable copy ("…once Phase NOC.C
// ships") without forcing every other caller of the canonical to know about
// that one-off message.
export function LoadShell<T>(props: {
  state: LoadState<T>
  emptyTitle: string
  emptyMessage: string
  onRetry: () => void
  children: (items: T[]) => React.ReactNode
}) {
  return (
    <_CanonicalLoadShell
      {...props}
      unavailableTitle="NOC inventory endpoints not yet available"
      unavailableMessage="This page will populate once Phase NOC.C ships."
      unavailableIcon={<PackageIcon size={36} />}
    />
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
      <span style={{ fontSize: 'var(--gx-text-sm)', fontWeight: 'var(--gx-weight-medium)', color: 'var(--gx-text-2)' }}>{label}</span>
      {children}
    </label>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--gx-text-11)', fontWeight: 'var(--gx-weight-semibold)', textTransform: 'uppercase',
      color: 'var(--gx-text-3)', letterSpacing: '0.06em',
      marginBottom: 'var(--gx-space-3)',
    }}>{children}</div>
  )
}

export function KvGrid({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 'var(--gx-space-3)', columnGap: 'var(--gx-space-8)' }}>
      {rows.map(([k, v], i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>{k}</span>
          <span style={{ fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>{v}</span>
        </span>
      ))}
    </div>
  )
}
