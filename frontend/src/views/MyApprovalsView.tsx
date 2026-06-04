// MyApprovalsView — Workspace → My Approvals.
//
// Real data from GET /api/approvals (status=PENDING). Each row shows the parked
// transition (entity · record · from → to) plus Approve / Reject buttons that POST
// to /api/approvals/{id}/approve|reject (mutations live in backend/app/routers/
// approvals.py).
//
// Doctrine: no mock fallbacks. 0 results → empty state. 403 → PermissionDenied.
// Network error → ErrorBanner. Mutations refresh the list on success.

import { Button } from '../primitives'
import { useEffect, useState } from 'react'
import { EmptyState, PermissionDenied, SkeletonRows, ErrorBanner } from '../components/States'
import {
  CheckIcon, CloseIcon, InboxIcon, ArrowRightIcon,
} from '../components/icons'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { humanizeEntity } from '../lib/humanize'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

type Approval = {
  id: string
  entity_key: string
  record_id: string
  from_status: string
  to_status: string
  status: string
  requested_by: string | null
  approver_user_id: string | null
  note: string | null
  decided_at: string | null
  created_at: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: Approval[] }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

export default function MyApprovalsView({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setState({ kind: 'loading' })
    try {
      const r = await fetch(`${BASE}/api/approvals?status=PENDING`, { headers: authH(token) })
      if (r.status === 403) { setState({ kind: 'forbidden' }); return }
      if (!r.ok) { setState({ kind: 'error', message: 'Failed to load approvals' }); return }
      const data = await r.json()
      setState({ kind: 'ok', items: Array.isArray(data) ? data : [] })
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message })
    }
  }

  useEffect(() => { load() }, [token])

  async function decide(id: string, decision: 'approve' | 'reject') {
    if (busy) return
    setBusy(id)
    try {
      const r = await fetch(`${BASE}/api/approvals/${id}/${decision}`, {
        method: 'POST',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Error' }))
        throw new Error(err.detail || `Failed to ${decision}`)
      }
      toast.success(decision === 'approve' ? 'Approved' : 'Rejected')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const items = state.kind === 'ok' ? state.items : []

  const kpis: KPISpec[] = state.kind === 'ok'
    ? [{ label: 'Pending', value: items.length, subtitle: 'awaiting decision', warning: items.length > 0 }]
    : []

  if (state.kind === 'forbidden') return <PermissionDenied />

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'My Approvals']}
      icon={<CheckIcon size={18} />}
      title="My Approvals"
      subtitle={state.kind === 'ok' ? `${items.length} pending` : 'Pending approvals requiring your action'}
      kpis={kpis}
    >
      {state.kind === 'error' ? (
        <ErrorBanner message={state.message} onRetry={load} />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {state.kind === 'loading' ? (
            <div style={{ padding: 14 }}>
              <SkeletonRows rows={5} />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<InboxIcon size={40} />}
              title="No approvals waiting"
              message="Pending transitions that need your decision will appear here."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Record</th>
                    <th>Transition</th>
                    <th>Requested</th>
                    <th className="actions-col" style={{ textAlign: 'right' }}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td style={{ color: 'var(--gx-text-2)' }}>{humanizeEntity(a.entity_key)}</td>
                      <td className="mono" style={{ color: 'var(--gx-link)' }}>
                        {a.record_id.slice(0, 8)}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="pill pill-neutral">{a.from_status}</span>
                          <ArrowRightIcon size={12} />
                          <span className="pill pill-info">{a.to_status}</span>
                        </span>
                      </td>
                      <td style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                        {timeAgo(a.created_at)}
                      </td>
                      <td className="actions-col" style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <Button variant="primary" size="sm"
            disabled={busy === a.id}
                            onClick={() => decide(a.id, 'approve')}
                            title="Approve this transition"
                          >
                            <CheckIcon size={12} /> Approve
                          </Button>
                          <Button variant="ghost" size="sm"
            disabled={busy === a.id}
                            onClick={() => decide(a.id, 'reject')}
                            title="Reject this transition"
                            style={{ color: 'var(--gx-danger-fg)' }}
                          >
                            <CloseIcon size={12} /> Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}
