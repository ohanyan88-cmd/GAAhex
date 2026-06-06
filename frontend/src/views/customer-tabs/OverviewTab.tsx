// OverviewTab — canonical Object Detail tab #1 (file 10).
// Summary card with key customer fields. Reads data from props — does NOT re-fetch
// the customer profile (the parent CustomerView already owns the /360 payload and
// passes the relevant slice down so this tab paints instantly on activation).

import type { ReactNode } from 'react'
import { fmtDate } from '../../lib/time'

type Profile = {
  id: string
  status?: string | null
  name?: string
  title?: string
  [k: string]: any
}


// Render a single labeled cell in the summary grid. Hide-if-missing: returns null
// when the value is empty so the grid doesn't carry dead em-dashes for absent fields.
function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '' || value === '—') return null
  return (
    <div>
      <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--gx-space-2)' }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--gx-text-13)' }}>{value}</div>
    </div>
  )
}

export default function OverviewTab({ customerId, profile }: { customerId: string; profile?: Profile | null }) {
  // Fall back to a minimal display when the parent hasn't passed the profile slice yet
  // (skeleton / not-loaded path). We never re-fetch here — overview piggybacks on /360.
  if (!profile) {
    return (
      <div className="card" style={{ padding: 'var(--gx-space-7)' }} aria-busy="true">
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-7)', width: '40%', marginBottom: 'var(--gx-space-5)' }} />
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '80%', marginBottom: 'var(--gx-space-4)' }} />
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '60%' }} />
      </div>
    )
  }
  const name = profile.name ?? profile.title ?? customerId.slice(0, 8)
  return (
    <div className="card" style={{ padding: 'var(--gx-space-8)' }}>
      <div style={{ marginBottom: 'var(--gx-space-7)' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
        <div className="muted mono" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-1)' }}>{profile.id}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--gx-space-7)' }}>
        <Field label="Status" value={profile.status ?? '—'} />
        <Field label="Type" value={profile.type ?? profile.customer_type ?? null} />
        <Field label="Segment" value={profile.segment ?? null} />
        <Field label="Email" value={profile.email
          ? <a href={`mailto:${profile.email}`} style={{ color: 'var(--gx-link)' }}>{profile.email}</a>
          : null} />
        <Field label="Phone" value={profile.phone
          ? <a href={`tel:${profile.phone}`} style={{ color: 'var(--gx-link)' }}>{profile.phone}</a>
          : null} />
        <Field label="Created" value={profile.created_at ? <span className="mono">{fmtDate(profile.created_at)}</span> : null} />
        <Field label="Updated" value={profile.updated_at ? <span className="mono">{fmtDate(profile.updated_at)}</span> : null} />
        <Field label="Owner" value={profile.owner_node_id ? <span className="mono">{String(profile.owner_node_id).slice(0, 8)}</span> : null} />
      </div>
    </div>
  )
}
