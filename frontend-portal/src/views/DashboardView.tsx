import { useEffect, useState } from 'react'
import { api, type PortalSummary } from '../api'

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      boxShadow: 'var(--shadow)',
    }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color: accent ? 'var(--accent)' : 'var(--text)',
        lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  )
}

function fmt(luma: number) {
  const drams = luma / 100
  return drams.toLocaleString('hy-AM', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ֏'
}

export default function DashboardView() {
  const [summary, setSummary] = useState<PortalSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.summary().then(setSummary).catch(err => setError(err.message))
  }, [])

  if (error) {
    return (
      <div style={{ padding: 24, color: 'var(--danger)' }}>
        Failed to load summary: {error}
      </div>
    )
  }

  if (!summary) {
    return (
      <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading...</div>
    )
  }

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>
        Dashboard
      </h1>
      <p style={{ color: 'var(--text-3)', marginBottom: 28, fontSize: 13 }}>
        Welcome back, {summary.customer.name ?? summary.customer.email}
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 16,
        marginBottom: 32,
      }}>
        <StatCard label="Balance due" value={fmt(summary.balance_due_luma)} accent={summary.balance_due_luma > 0} />
        <StatCard label="Open invoices" value={summary.open_invoices_count} />
        <StatCard label="Open tickets" value={summary.open_tickets_count} />
        <StatCard label="Active services" value={summary.active_services_count} />
      </div>
    </div>
  )
}
