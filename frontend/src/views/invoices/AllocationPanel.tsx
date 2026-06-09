// ── Phase A.3 allocation panel ────────────────────────────────────────────────
// Renders live outstanding snapshot + allocations list + admin-gated Allocate action.
// All amount values from these endpoints arrive as decimal STRINGS in major units; we
// convert to luma at the boundary so money() stays the only display formatter.
import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { money } from '../../lib/money'
import { timeAgo } from '../../lib/time'
import { Button } from '../../primitives'
import { EmptyState, ErrorBanner } from '../../components/States'
import { ReceiptIcon } from '../../components/icons'
import { decStrToLuma, type Outstanding, type Allocation } from './types'
import { AllocateModal } from './AllocateModal'

// DF-6 — NOT the canonical (which is `moneyDecStr`). This wrapper does a
// decimal-string → luma conversion first, then formats as luma.
function moneyDecToLumaFmt(s: string | null | undefined): string {
  return money(decStrToLuma(s))
}

export function AllocationPanel({ token, invoiceId, canAllocate, onChanged }: {
  token: string
  invoiceId: string
  canAllocate: boolean
  /** Called after a successful allocate — parent should re-fetch invoice (status may flip to PAID). */
  onChanged: () => void
}) {
  const [out, setOut] = useState<Outstanding | null>(null)
  const [allocs, setAllocs] = useState<Allocation[] | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  async function load() {
    setErr(''); setForbidden(false); setUnavailable(false)
    const [oRes, aRes] = await Promise.all([
      bget<Outstanding>(token, `/api/invoices/${invoiceId}/outstanding`),
      bget<Allocation[]>(token, `/api/invoices/${invoiceId}/allocations`),
    ])
    if (oRes.status === 403 || aRes.status === 403) { setForbidden(true); return }
    if (oRes.status === 404 || aRes.status === 404) { setUnavailable(true); return }
    if (!oRes.ok || !aRes.ok) { setErr('Failed to load allocation data'); return }
    setOut(oRes.data)
    setAllocs(Array.isArray(aRes.data) ? aRes.data : [])
  }

  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [token, invoiceId])

  // Refresh both A.3 reads + bubble to parent (so the parent invoice row's status can flip).
  async function refresh() { await load(); onChanged() }

  if (forbidden) {
    return (
      <div className="card" style={{ marginTop: 'var(--gx-space-7)', padding: 'var(--gx-space-5)', borderColor: 'var(--gx-danger)' }}>
        <strong>Allocations not available</strong>
        <p className="muted" style={{ margin: 'var(--gx-space-3) 0 0' }}>
          You don't have permission to view allocation details for this invoice.
        </p>
      </div>
    )
  }
  if (unavailable) {
    return (
      <div style={{ marginTop: 'var(--gx-space-12)' }}>
        <EmptyState
          icon={<ReceiptIcon size={28} />}
          title="Allocation endpoints not yet available"
          message="This invoice's allocation tracking will appear here once the Phase A.3 endpoints are live."
        />
      </div>
    )
  }
  if (err) {
    return (
      <div style={{ marginTop: 'var(--gx-space-12)' }}>
        <ErrorBanner message={err} onRetry={load} />
      </div>
    )
  }
  if (!out || allocs === null) {
    return <p className="muted" style={{ marginTop: 'var(--gx-space-12)' }}>Loading allocations…</p>
  }

  const totalNum = parseFloat(out.total) || 0
  const outNum = parseFloat(out.outstanding) || 0
  // Color: green if fully settled, red if fully unpaid, amber in between.
  const outColor = outNum <= 0
    ? 'var(--gx-success)'
    : outNum >= totalNum
      ? 'var(--gx-danger)'
      : 'var(--gx-warning)'

  return (
    <div style={{ marginTop: 'var(--gx-space-12)' }}>
      <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--gx-space-5)' }}>
        Outstanding &amp; allocations
      </div>

      <div className="card" style={{ padding: 'var(--gx-space-5)', marginBottom: 'var(--gx-space-8)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--gx-space-5)', alignItems: 'end' }}>
          <div>
            <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase' }}>Total</div>
            <div className="num mono" style={{ fontSize: 'var(--gx-text-md)' }}>{moneyDecToLumaFmt(out.total)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase' }}>Paid</div>
            <div className="num mono" style={{ fontSize: 'var(--gx-text-md)' }}>{moneyDecToLumaFmt(out.paid)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase' }}>Credited</div>
            <div className="num mono" style={{ fontSize: 'var(--gx-text-md)' }}>{moneyDecToLumaFmt(out.credited)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase' }}>Outstanding</div>
            <div className="num mono" style={{ fontSize: 'var(--gx-text-lg)', fontWeight: 'var(--gx-weight-bold)', color: outColor }}>
              {moneyDecToLumaFmt(out.outstanding)}
            </div>
          </div>
        </div>
        {out.computed_at && (
          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-5)' }}>
            Last computed {timeAgo(out.computed_at)}
          </div>
        )}
        {canAllocate && outNum > 0 && (
          <div style={{ marginTop: 'var(--gx-space-7)', display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" size="sm"
            onClick={() => setOpen(true)}>
              Allocate payment
            </Button>
          </div>
        )}
      </div>

      {allocs.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No allocations applied yet.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Applied</th>
              <th>Payment</th>
              <th className="num">Amount (֏)</th>
            </tr>
          </thead>
          <tbody>
            {allocs.map(a => (
              <tr key={a.id}>
                <td className="mono" title={a.applied_at ?? ''}>{a.applied_at ? timeAgo(a.applied_at) : '—'}</td>
                <td className="mono" title={a.payment_id}>{a.payment_id.slice(0, 8)}</td>
                <td className="num">{moneyDecToLumaFmt(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <AllocateModal
          token={token}
          invoiceId={invoiceId}
          outstanding={out.outstanding}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); refresh() }}
        />
      )}
    </div>
  )
}
